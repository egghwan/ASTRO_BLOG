---
title: "[CNN 가속기 만들기 #2] 양자화 — 부동소수점 없이 추론하기"
description: float32로 학습된 ResNet-8을 INT8 정수 연산만으로 추론하는 방법을 다룬다. scale과 zero-point의 의미부터, BatchNorm을 가중치에 녹이는 folding, 나눗셈 없이 스케일을 맞추는 (acc × M) >> shift requantization, 그리고 RTL 검증의 기준이 될 golden model을 PyTorch로 만드는 것까지.
---

[1편](./part1-workload-analysis.md)에서 ResNet-8을 해부해 "무엇을 계산해야 하는지"를 확정했다. 이번 편은 "그 계산을 **어떤 숫자 형식으로** 할 것인가"다.

PyTorch로 학습한 신경망의 가중치와 중간값은 전부 **float32(32비트 부동소수점)** 다. 그런데 우리는 이 네트워크를 부동소수점 유닛 없이, **8비트 정수(INT8)의 곱셈과 덧셈, 그리고 시프트만으로** 추론할 것이다. 이 변환 과정이 **양자화(quantization)** 이고, 하드웨어를 한 줄 짜기 전에 반드시 먼저 끝내야 하는 작업이다. 이유는 단순하다 — **RTL이 무엇을 계산해야 하는지는 양자화가 정의하기 때문이다.** 양자화된 정수 연산의 결과가 곧 RTL 시뮬레이션이 맞춰야 할 정답(golden)이 된다.

:::note[이 글에서 다루는 것]
- 왜 INT8인가 — 하드웨어 비용 관점의 근거
- 양자화의 기본 수식: scale, zero-point, 그리고 우리가 **대칭(symmetric) 양자화**를 고르는 이유
- BatchNorm folding — BN을 하드웨어에서 소멸시키는 수식 유도
- INT8 × INT8 = INT32 누산 — **누산기 비트폭을 직접 계산해 정하기**
- Requantization — 나눗셈 없이 `(acc × M0) >> shift` 로 스케일 맞추기
- 잔차 덧셈(residual add)을 양자화 세계에서 처리하는 법
- Calibration — activation의 scale을 데이터로 정하는 법
- PyTorch golden model — 레이어별 중간값을 덤프해 RTL 검증의 기준 만들기
:::

## 0. 왜 INT8인가 — 하드웨어의 언어로

float32 곱셈기와 INT8 곱셈기는 하드웨어 비용이 차원이 다르다. float32 하나를 처리하려면 지수 정렬, 가수 곱셈, 정규화, 반올림 로직이 전부 필요해서, 같은 실리콘 면적에 INT8 MAC을 넣으면 **수 배에서 수십 배 더 많이** 넣을 수 있고 에너지 소모도 훨씬 적다. FPGA에서는 더 직접적이다 — Xilinx의 **DSP48 슬라이스(FPGA에 하드 매크로로 박혀 있는 곱셈-누산 전용 블록, 27×18비트 곱셈기 내장)** 는 정수 연산 유닛이라 INT8이 자연스러운 손님이고, 심지어 곱셈기 하나에 INT8 곱셈 **두 개를 패킹**하는 테크닉도 있다(5편에서 다룬다).

정확도는 어떨까. 다행히 이미지 분류 CNN은 양자화에 상당히 둔감하다. 학습을 다시 하지 않고 변환만 하는 **PTQ(Post-Training Quantization, 학습 후 양자화)** 만으로도 INT8에서 정확도 손실을 보통 1%p 이내로 막을 수 있다는 것이 널리 재현된 결과다. 손실이 크면 양자화를 감안해 재학습하는 QAT(Quantization-Aware Training)라는 다음 단계가 있지만, 이 시리즈는 PTQ로 시작한다 — 파이프라인이 단순하고, 우리 목적(하드웨어 설계)에는 충분하다.

## 1. 양자화의 기본 수식 — 실수를 정수에 매핑하기

양자화의 본질은 **실수 구간을 정수 눈금에 대응시키는 것**이다. 실수 `r`을 8비트 정수 `q`로 표현하는 표준 수식은 이렇다.

```
r ≈ s × (q − z)

s (scale)      : 정수 눈금 1칸이 실수로 얼마인지 (양의 실수)
z (zero-point) : 실수 0.0에 대응하는 정수값
q              : INT8 정수, 범위 [−128, 127]
```

예를 들어 `s = 0.05, z = 0`이면, 정수 `q = 40`은 실수 `40 × 0.05 = 2.0`을 뜻한다. 표현 가능한 실수 범위는 `[−128×0.05, 127×0.05] = [−6.4, 6.35]`이고, 그 밖의 값은 경계로 잘린다(saturation). 반대 방향 변환(실수 → 정수)은 `q = clamp(round(r/s) + z, −128, 127)`이다.

여기서 첫 번째 설계 결정이 나온다. **zero-point를 쓸 것인가(비대칭) 말 것인가(대칭)?**

:::tip[설계 결정 ① — 전부 대칭(symmetric, z = 0) 양자화로 간다]
z ≠ 0인 비대칭 양자화는 표현 범위를 데이터 분포에 더 딱 맞출 수 있다. 특히 ReLU를 지난 activation은 전부 0 이상이라, 비대칭으로 하면 음수 쪽 눈금을 버리지 않아 유효 해상도가 2배가 된다. 하지만 대가가 있다. 두 값의 곱을 전개해 보면:

```
r_x · r_w = s_x s_w (q_x − z_x)(q_w − z_w)
          = s_x s_w ( q_x·q_w − q_x·z_w − q_w·z_x + z_x·z_w )
```

z가 0이 아니면 곱셈마다 **교차항 3개**가 따라붙는다. 하드웨어로는 MAC 옆에 보정 누산기와 사전계산 로직이 추가된다는 뜻이다. z = 0이면 `r_x · r_w = s_x s_w · q_x q_w` — 정수 곱 하나로 끝난다. 이 시리즈는 **단순한 데이터패스**가 최우선이므로 weight와 activation 모두 대칭으로 간다. ReLU 이후 범위를 절반 버리는 손실은 감수하고, 정확도가 부족하면 그때 재검토한다. 이런 "일단 단순하게, 근거를 남기고" 방식이 개인 프로젝트를 완주시키는 요령이다.
:::

두 번째 결정은 **scale을 얼마나 잘게 둘 것인가**다.

:::tip[설계 결정 ② — weight는 per-channel, activation은 per-tensor]
- **weight**: 출력 채널마다 분포가 크게 다르므로, **출력 채널별로 scale을 따로** 둔다(per-channel). 채널 수만큼 scale이 생기지만, 뒤에서 보듯 하드웨어 비용은 "채널별 상수 테이블 하나"에 불과하다. PTQ 정확도를 지키는 가장 가성비 좋은 선택으로 알려져 있다.
- **activation**: 텐서(레이어 출력) 전체에 scale 하나(per-tensor). activation을 채널별로 나누면 다음 레이어의 누산이 꼬이기 때문에 이쪽은 per-tensor가 표준이다.
:::

## 2. BatchNorm folding — BN을 소멸시키기

1편에서 예고한 트릭이다. 학습된 네트워크에서 conv 뒤의 BatchNorm은 추론 시 채널 `c`마다 고정 상수의 1차식으로 굳는다.

```
BN(x) = γ_c · (x − μ_c) / √(σ²_c + ε) + β_c
```

여기서 `μ, σ²`는 학습 중 집계된 채널별 평균/분산(고정값), `γ, β`는 학습된 파라미터(고정값), `ε`은 0나눗셈 방지용 작은 수다. 전부 상수이므로 `BN(x) = a_c · x + b_c` 꼴이고, conv의 출력 `x = Σ w·i + bias`에 이걸 합성하면:

```
BN(conv(i)) = a_c · (Σ w·i + bias) + b_c
            = Σ (a_c · w) · i + (a_c · bias + b_c)
              └── 새 가중치 w′ ──┘  └──── 새 bias b′ ────┘

w′ = w × γ_c / √(σ²_c + ε)
b′ = (bias − μ_c) × γ_c / √(σ²_c + ε) + β_c
```

즉 **BN은 conv 가중치와 bias를 채널별로 재계산하는 것으로 완전히 흡수된다.** 이 folding을 float 단계에서 먼저 수행한 뒤 양자화하므로, 하드웨어에는 BN이라는 개념 자체가 존재하지 않는다. PyTorch 코드는 이렇다.

```python
import torch

@torch.no_grad()
def fold_bn(conv, bn):
    """conv 뒤에 붙은 bn을 conv의 weight/bias에 흡수. 반환: (w', b')"""
    a = bn.weight / torch.sqrt(bn.running_var + bn.eps)     # 채널별 a_c
    w_f = conv.weight * a.reshape(-1, 1, 1, 1)              # w' = w · a_c
    bias = conv.bias if conv.bias is not None else torch.zeros_like(bn.running_mean)
    b_f = (bias - bn.running_mean) * a + bn.bias            # b'
    return w_f, b_f
```

이후 이 글의 모든 수식과 코드에서 "가중치"는 folding이 끝난 `w′, b′`를 가리킨다.

## 3. INT8 곱셈과 INT32 누산 — 비트폭을 계산으로 정하기

이제 합성곱 본체를 정수로 쓴다. 대칭 양자화 덕에 수식이 깨끗하다. 입력 activation의 scale을 `s_x`, 출력 채널 `c`의 weight scale을 `s_w[c]`라 하면:

```
실수 누산값 = Σ (s_x · q_x) · (s_w[c] · q_w)  =  s_x · s_w[c] · Σ q_x · q_w
                                                              └─ 순수 정수 MAC ─┘
```

하드웨어가 할 일은 `Σ q_x·q_w` — **INT8 × INT8 곱을 계속 더하는 것**뿐이다. 그런데 이 누산값은 몇 비트짜리 레지스터에 담아야 할까? 감으로 "32비트면 되겠지" 하지 말고 계산하자. INT8 × INT8 곱 하나의 최대 절대값은 `127 × 127 = 16,129`이고(−128을 쓰면 128×128이지만, weight를 [−127,127]로 클립해 대칭을 유지하는 관례를 따른다), 그런 곱을 "탭 수(= K×K×C_in)"만큼 더한다. 1편의 표에서 탭 수가 가장 큰 레이어는 conv7(3×3×64 = 576탭)이다.

| 레이어 | 탭 수 | 최악 |누산값| | 필요 비트 |
|---|---:|---:|---:|
| conv1 | 27 | 435,483 | 2^18.7 → 20비트 |
| conv2/3 | 144 | 2,322,576 | 2^21.1 → 23비트 |
| conv5 | 288 | 4,645,152 | 2^22.1 → 24비트 |
| **conv7** | **576** | **9,290,304** | **2^23.1 → 25비트** (부호 포함) |

bias를 더할 여유까지 감안해도 **26비트면 수학적으로 절대 오버플로하지 않는다.** 그래도 이 시리즈는 누산기를 **INT32**로 잡는다 — DSP48의 누산 경로가 원래 넓고(48비트), 32비트는 소프트웨어 golden model(numpy int32)과 맞추기도 편하기 때문이다. 다만 "26비트면 충분하다"는 이 계산은 남겨둘 가치가 있다. ASIC으로 갈 때(11편 이후의 확장) 누산기 폭은 곧 면적과 전력이라, 그때 이 표가 바로 최적화 근거가 된다.

## 4. Requantization — 나눗셈 없이 스케일 맞추기

문제의 핵심 구간이다. INT32 누산값 `acc`는 실수로 `s_x · s_w[c] · acc`를 뜻한다. 그런데 다음 레이어는 입력이 **다음 레이어의 scale `s_y`로 양자화된 INT8**이길 기대한다. 그러니 레이어 경계마다 이 변환이 필요하다.

```
q_y = round( acc × s_x · s_w[c] / s_y )  를  [−128, 127]로 clamp
             └────── M[c] ──────┘
```

`M[c] = s_x·s_w[c]/s_y`는 컴파일 타임에 미리 계산되는 **채널별 실수 상수**다(보통 1보다 훨씬 작다). 문제는 하드웨어에 실수 곱셈도 나눗셈도 없다는 것. 해법은 M을 **고정소수점으로 근사**하는 것이다.

```
M ≈ M0 / 2^n      (M0: 정수, n: 시프트량)

q_y = clamp( (acc × M0  +  2^(n−1)) >> n ,  −128, 127 )
                          └─ 반올림용 0.5 ─┘
```

`2^(n−1)`을 더하고 시프트하는 것은 "0.5를 더하고 버림" — 즉 **반올림**을 정수로 구현한 것이다. 이 한 줄이 하드웨어 양자화 유닛(6편)의 전부다: **곱셈 1회, 덧셈 1회, 시프트 1회, 클램프 1회.**

실제 숫자로 감을 잡아 보자. `s_x = 0.05, s_w = 0.003, s_y = 0.08`이면 `M = 0.001875`다. `n = 16`으로 잡으면 `M0 = round(0.001875 × 65536) = 123`, 근사값은 `123/65536 = 0.00187683` — 상대오차 0.098%. 누산값 `acc = 12345`를 넣어 보면 실수식은 `12345 × 0.001875 = 23.15`, 정수식은 `(12345×123 + 32768) >> 16 = 23`. 일치한다.

:::note[M0의 비트폭과 n을 고르는 법]
M은 레이어/채널마다 크기가 제각각이라, n을 전역 고정하면 어떤 M은 M0가 너무 작아져(위 예시처럼 123 정도) 근사 오차가 커진다. 표준 처방은 **M을 `M0 × 2^−n` 꼴로 정규화하되 M0가 항상 [2^14, 2^15) 같은 넓은 구간에 오도록 n을 채널별로 함께 저장**하는 것이다(부동소수점의 가수-지수 분해와 같은 아이디어). 그러면 M0는 15~16비트 정수로 통일되고 상대오차는 항상 2^−15 수준 이하로 억제된다. 하드웨어 비용은 "채널별 (M0, n) 테이블" — 어차피 per-channel weight scale 때문에 필요했던 그 테이블이다. 설계 결정 ②의 비용이 여기서 정산되는 셈이다.
:::

ReLU는 어디로 갔을까? clamp의 **하한을 0으로 바꾸면 그게 ReLU다.** `clamp(x, 0, 127)`은 "음수를 0으로 자르고(ReLU) INT8 상한으로 포화"를 동시에 수행한다. 레이어 descriptor에 "ReLU 유무" 플래그 하나를 두고 clamp 하한을 −128/0 중에서 고르게 하면 끝이다. 활성화 함수가 회로에서 MUX 입력 하나로 구현되는 순간이다.

## 5. 잔차 덧셈 — 스케일이 다른 두 텐서를 더하기

양자화 세계의 복병은 residual add다. float 세계에서는 그냥 더하면 되지만, 양자화 세계에서 두 텐서는 **서로 다른 scale을 가진 정수**라서 그대로 더하면 안 된다. `s_a·q_a + s_b·q_b ≠ s?·(q_a+q_b)` — 눈금이 다른 두 자를 눈금 수만 더한 꼴이 되기 때문이다.

해법은 requantization을 이미 갖고 있으니 간단하다. **두 브랜치를 각각 블록 출력 scale `s_out`으로 requantize한 뒤 더한다.**

```
본선(conv 경로):  acc_main ──(×M0_main >> n_main)──> q_main (s_out 기준 INT8)
지선(shortcut) :  q_sc     ──(×M0_sc   >> n_sc  )──> q_sc′  (s_out 기준 INT8)
                                                        │
q_out = clamp( q_main + q_sc′ , −128, 127 )  ← 같은 눈금이 됐으니 이제 더해도 된다
```

INT8 둘의 합은 9비트까지 커질 수 있으므로 덧셈 뒤 반드시 한 번 더 clamp한다. shortcut이 identity인 Block1은 지선의 requant가 `s_in → s_out` 스케일 변환 한 번이고, shortcut이 1×1 conv인 Block2/3은 그 conv의 출력이 애초에 `s_out`으로 requantize되도록 M을 잡으면 지선 쪽 추가 연산이 없다. 이 구조가 6편에서 만들 양자화/활성화 유닛의 add 경로 스펙이 된다.

## 6. Calibration — activation scale을 데이터로 정하기

weight의 scale은 쉽다. 가중치는 눈앞에 있는 고정된 숫자들이니 `s_w[c] = max|w_c| / 127`로 채널별 최대절대값에서 바로 나온다. 문제는 **activation** — 레이어 출력값의 범위는 입력 이미지에 따라 달라지므로, **대표 데이터를 실제로 흘려보며 관측**해야 한다. 이 과정이 calibration이다.

방법은 단순하다. 학습 데이터에서 수백 장(우리는 CIFAR-10 train에서 512장)을 뽑아 float 네트워크에 통과시키면서 각 레이어 출력의 분포를 기록하고, 그 분포로부터 scale을 정한다. 이때 "최대값을 그대로 쓸 것인가"가 함정이다.

:::tip[max-abs가 아니라 percentile을 쓰는 이유]
`s = max|x|/127`(max-abs)은 단 하나의 극단적 outlier가 scale 전체를 지배하게 만든다. 예컨대 값의 99.99%가 [−3, 3]에 있는데 outlier 하나가 20이면, scale이 20/127로 잡혀 정작 대부분의 값이 전체 256눈금 중 40눈금 안에 뭉개진다. 그래서 **99.9 percentile의 절대값**을 상한으로 쓰는 절충이 표준적이다 — outlier 0.1%는 포화로 잘리는 대신, 나머지 99.9%의 해상도를 지킨다. 우리도 이 방식을 쓴다.
:::

```python
import numpy as np

class ActObserver:
    """레이어 출력에 붙여 절대값 분포를 수집하고 percentile 기반 scale을 낸다."""
    def __init__(self):
        self.samples = []
    def observe(self, x: torch.Tensor):
        self.samples.append(x.detach().abs().flatten().cpu().numpy())
    def scale(self, pct=99.9):
        allv = np.concatenate(self.samples)
        return float(np.percentile(allv, pct)) / 127.0
```

## 7. Golden model — RTL이 맞춰야 할 정답 만들기

이제 전 재료를 조립한다. 목표는 두 개다.

1. **정확도 확인**: INT8 정수 추론이 float 대비 정확도를 얼마나 잃는지 측정
2. **golden 덤프**: RTL 시뮬레이션이 **비트 단위로 일치해야 할** 레이어별 중간값을 파일로 저장

두 번째가 이 편의 진짜 산출물이다. 여기서 절대 어겨서는 안 되는 원칙이 하나 있다.

:::tip[golden model의 제1원칙 — 하드웨어가 할 연산을 "정확히 그대로" 한다]
golden model은 float로 계산하고 마지막에 양자화하는 근사 시뮬레이션이 아니다. **하드웨어가 수행할 정수 연산 순서를 소프트웨어로 한 줄 한 줄 재현**해야 한다. 곱셈은 int64로 안전하게, 누산은 int32로, requant는 `(acc·M0 + 2^(n−1)) >> n`을 문자 그대로. 이렇게 해야 9편에서 "RTL 출력 == golden 출력"이라는 **bit-exact 검증**이 성립한다. float 연산이 한 군데라도 섞이면, RTL과 1~2 어긋나는 값이 나올 때 그것이 RTL 버그인지 golden의 반올림 차이인지 구분할 수 없게 된다 — 검증의 기준 자체가 흔들리는 것이다.
:::

핵심 함수는 이렇다. 프레임워크의 conv를 쓰지 않고 정수 연산을 직접 쓴다(느리지만, 기준이므로 명료함이 속도보다 중요하다. 실제로는 `torch.nn.functional.conv2d`에 int32 텐서를 태워 수십 배 빠르게 할 수 있고, 그 등가성만 별도 확인하면 된다).

```python
def conv2d_int8(q_in, q_w, bias_i32, M0, n, stride, relu):
    """
    q_in    : int8  [C_in, H, W]      입력 activation (양자화 완료)
    q_w     : int8  [C_out, C_in, K, K] 가중치 (BN folding + 양자화 완료)
    bias_i32: int32 [C_out]           bias를 s_x·s_w[c] 눈금으로 미리 양자화한 것
    M0, n   : int   [C_out]           채널별 requant 상수 (4장)
    반환     : int8  [C_out, H', W']   ← 이 배열이 RTL이 맞춰야 할 golden
    """
    x = np.pad(q_in.astype(np.int64), ((0,0),(1,1),(1,1))) if q_w.shape[-1]==3 \
        else q_in.astype(np.int64)
    Co, Ci, K, _ = q_w.shape
    Ho, Wo = ((x.shape[1]-K)//stride)+1, ((x.shape[2]-K)//stride)+1
    out = np.zeros((Co, Ho, Wo), dtype=np.int8)
    for c in range(Co):
        for i in range(Ho):
            for j in range(Wo):
                win = x[:, i*stride:i*stride+K, j*stride:j*stride+K]
                acc = np.int64((win * q_w[c].astype(np.int64)).sum()) + bias_i32[c]
                q = (acc * M0[c] + (1 << (n[c]-1))) >> n[c]        # requantize
                lo = 0 if relu else -128                            # ReLU = clamp 하한
                out[c, i, j] = np.clip(q, lo, 127)
    return out
```

:::note[bias는 어느 눈금으로 양자화하나]
bias는 누산기에 더해지므로 **누산기의 눈금**, 즉 `s_x · s_w[c]`로 양자화한다: `bias_i32[c] = round(b′_c / (s_x · s_w[c]))`. INT8이 아니라 INT32로 저장한다 — 어차피 레이어당 C_out개(최대 64개)뿐이라 용량 부담이 없고, 좁게 잡으면 그게 또 하나의 오차원이 된다.
:::

전체 파이프라인과 덤프는 이렇게 흘러간다.

```python
# 1) float ResNet-8 학습 (또는 학습된 체크포인트 로드)
# 2) 모든 conv-BN 쌍에 fold_bn() 적용 → w′, b′
# 3) weight scale: s_w[c] = max|w′_c| / 127, 양자화: q_w = clip(round(w′/s_w), -127, 127)
# 4) calibration 512장으로 각 레이어 ActObserver 수집 → s_x (99.9 pct)
# 5) 레이어별 M[c] = s_x·s_w[c]/s_y 를 (M0, n)으로 분해
# 6) 정수 추론 실행 + 레이어별 덤프

test_img = load_cifar_test(index=0)                # 대표 벡터 1: 실제 이미지
np.random.seed(42)
rand_img = np.random.randint(-128, 128, (3,32,32)) # 대표 벡터 2: 랜덤 (경계 자극용)

for name, img in [("img0", test_img), ("rand", rand_img)]:
    q = quantize_input(img)                        # 입력을 s_in으로 INT8화
    np.save(f"golden/{name}_input.npy", q)
    for li, layer in enumerate(net_int8):          # 레이어 descriptor 순회
        q = layer.run(q)                           # conv2d_int8 / add / gap / fc
        np.save(f"golden/{name}_L{li:02d}_out.npy", q)   # ★ 레이어별 golden
```

`golden/` 디렉터리에 쌓이는 이 `.npy` 파일들이 4편부터의 모든 RTL testbench가 읽을 정답지다. 레이어 단위로 끊어서 저장하는 이유가 중요하다 — 최종 출력만 비교하면 "틀렸다"는 것만 알 수 있지만, **레이어별로 비교하면 "몇 번 레이어에서 처음 틀렸다"까지 즉시 좁혀진다.** 디버깅 시간을 지배하는 것은 이런 준비다.

## 8. 결과 — 정확도는 얼마나 잃었나

측정 방법은 CIFAR-10 test 10,000장 전체를 (a) float32 원본, (b) INT8 정수 golden model 두 경로로 추론해 top-1 정확도를 비교하는 것이다.

| 모델 | Top-1 정확도 | 비고 |
|---|---:|---|
| float32 (BN folding 후) | __._% | folding 전후 동일함을 별도 확인 |
| INT8 PTQ (per-channel, 99.9 pct calib) | __._% | 손실 _._%p |

> 위 표의 수치는 학습이 끝난 뒤 채워 넣는다. 이 규모의 네트워크에서 per-channel weight + percentile calibration 조합이면 **손실 1%p 이내**가 일반적인 기대치이고, 그보다 크게 나온다면 calibration 표본 수, percentile 값(99.9 → 99.99), outlier가 심한 레이어의 개별 점검 순으로 파고들면 된다.

정확도와 별개로 이 편에서 확정된 **하드웨어 스펙으로의 출력**을 정리하면:

- 데이터 형식: activation/weight 모두 **signed INT8 대칭 양자화** (zero-point 없음)
- 누산기: **INT32** (수학적 최소는 26비트 — ASIC 최적화 여지로 기록)
- 레이어 경계 처리: 채널별 `(M0, n)` 테이블 기반 **곱셈-시프트-클램프** requantization
- ReLU: requant clamp의 **하한 선택(−128/0)** 으로 흡수 — 별도 유닛 없음
- residual add: 양 브랜치를 **공통 scale로 requant 후 INT8 덧셈 + 재클램프**
- BatchNorm: folding으로 **하드웨어에서 소멸**
- 검증 기준: 레이어별 `.npy` golden 덤프, **bit-exact 일치**가 통과 조건

다음 편(3편)은 드디어 하드웨어다. 이 스펙을 받아서 전체 아키텍처를 확정한다 — im2col을 버리고 라인 버퍼를 택하는 이유, PE를 몇 개, 어떤 축으로 병렬화할지, 그리고 1편의 "전량 온칩" 결론이 핑퐁 버퍼라는 구체적 구조가 되는 과정까지, **무엇을 만들고 무엇을 만들지 않을지**를 결정한다.

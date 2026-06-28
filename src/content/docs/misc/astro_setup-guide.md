---
title: Starlight 블로그 — 빌드부터 GitHub 호스팅까지
description: 리눅스에서 Starlight 블로그를 만들고 GitHub Pages로 게시하는 전체 과정.
---

프로젝트 생성부터 GitHub 호스팅까지 한 번에 끝내는 가이드입니다. 글 안의 코드를 복사해서 만들면 됩니다.

:::note[명령어 실행 위치]
각 코드 블록 첫 줄에 `# 실행 위치:` 주석으로 어디서 실행하는지 표시했습니다. 대부분 **프로젝트 폴더(`my_blog`) 안**에서 실행합니다. 헷갈리면 `pwd` 를 쳐서 현재 위치 끝이 `my_blog` 인지 확인하세요.
:::

## 1. Node.js 설치

Astro 7은 Node.js 22.12 이상이 필요합니다.

```bash
# 실행 위치: 아무 곳이나
node -v        # v22.12.0 이상이면 OK. 낮거나 없으면 아래 실행

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22     # ★ 새 터미널에서도 22를 기본으로 (이거 안 하면 다시 옛 버전)
node -v                  # v22.x 확인
```

:::caution[터미널을 새로 열면 자꾸 옛 Node가 잡힐 때]
`nvm alias default 22` 를 실행했는지 확인하세요. `nvm use` 는 그 터미널에서만, `nvm alias default` 라야 영구 적용됩니다. 그래도 `nvm: command not found` 가 나오면 nvm 로딩 줄이 `~/.bashrc` 에 없는 것이니, nvm 설치 명령을 다시 실행한 뒤 `source ~/.bashrc` 하세요.
:::

## 2. 프로젝트 생성

```bash
# 실행 위치: 프로젝트를 만들 상위 폴더 (예: ~/Desktop/kkh)
npm create astro@latest -- --template starlight
```

질문 답변: 폴더명 `my_blog`, 의존성 설치 `Yes`, git 초기화 `Yes`, TypeScript `Strict`.

```bash
# 실행 위치: 위에서 만든 상위 폴더
cd my_blog               # 이후 모든 명령은 이 폴더 안에서 실행
```

## 3. 카테고리 폴더와 글 만들기

```bash
# 실행 위치: my_blog (프로젝트 루트)
rm -rf src/content/docs/*
mkdir -p src/content/docs/ai src/content/docs/wireless src/content/docs/fpga src/content/docs/rtl src/content/docs/misc
```

각 카테고리에 샘플 글을 넣습니다. 아래 덩어리를 통째로 복사해 붙여넣으세요.

```bash
# 실행 위치: my_blog (프로젝트 루트)
cat > src/content/docs/ai/cnn-basics.md << 'EOF'
---
title: CNN 기초
---
## 컨볼루션이란
여기에 내용을 적습니다.
EOF

cat > src/content/docs/wireless/ofdm.md << 'EOF'
---
title: OFDM 개요
---
## OFDM이란
여기에 내용을 적습니다.
EOF

cat > src/content/docs/fpga/synthesis-flow.md << 'EOF'
---
title: FPGA 합성 흐름
---
## 합성 흐름
여기에 내용을 적습니다.
EOF

cat > src/content/docs/rtl/uvm-verification.md << 'EOF'
---
title: UVM 검증 환경
---
## UVM이란
여기에 내용을 적습니다.
EOF
```

앞으로 글을 추가할 때는 `src/content/docs/<카테고리>/` 에 `.md` 파일을 만들고 맨 위에 `--- title: 제목 ---` 만 적으면 사이드바에 자동으로 나타납니다.

## 4. 홈페이지 만들기 (index.astro)

홈은 일반 글과 다르게 `src/pages/index.astro` 로 만듭니다. 홈을 `index.mdx` 로 만들면 메인 버튼 링크에 배포 경로가 안 붙어 클릭 시 404가 납니다. `index.astro` + `BASE_URL` 방식이면 로컬·배포 양쪽에서 버튼이 정상 동작합니다.

```bash
# 실행 위치: my_blog (프로젝트 루트)
mkdir -p src/pages
cat > src/pages/index.astro << 'EOF'
---
import StarlightPage from '@astrojs/starlight/components/StarlightPage.astro';
import { Card, CardGrid } from '@astrojs/starlight/components';

// base 를 자동으로 읽어 링크 앞에 붙임 (로컬: '/', 배포: '/저장소이름/')
const base = import.meta.env.BASE_URL;
const link = (p) => `${base.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
---
<StarlightPage frontmatter={{
  title: '안녕하세요 👋',
  template: 'splash',
  hero: {
    tagline: 'RTL 검증 · FPGA · 무선통신 · AI 를 공부하고 정리합니다.',
    actions: [
      { text: '기술 문서 보기', link: link('/rtl/uvm-verification/'), icon: 'right-arrow', variant: 'primary' },
      { text: 'GitHub', link: 'https://github.com/USERNAME', icon: 'external', variant: 'minimal' },
    ],
  },
}}>
  <h2>무엇을 다루나요</h2>
  <CardGrid>
    <Card title="AI" icon="seti:python">CNN, 딥러닝 기초와 가속기 구현.</Card>
    <Card title="Wireless" icon="seti:default">OFDM, MIMO 등 무선통신 이론.</Card>
    <Card title="FPGA" icon="seti:config">합성 흐름과 보드 구현 노트.</Card>
    <Card title="RTL" icon="seti:systemverilog">SystemVerilog, UVM 검증 환경.</Card>
  </CardGrid>
</StarlightPage>
EOF
```

버튼을 다른 글에 연결할 때도 `link('/카테고리/글이름/')` 형태로 감싸면 base 가 자동으로 붙습니다.

## 5. 설정 파일 (astro.config.mjs)

프로젝트 루트의 `astro.config.mjs` 를 아래 내용으로 통째로 교체합니다. 로컬에선 base 를 끄고 배포 때만 켜므로, 양쪽 다 정상 동작합니다.

```js
// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// =====================================================================
//  ★ 배포 전에 아래 두 줄을 본인 것으로 반드시 수정하세요 ★
//
//  GitHub Pages 주소는 보통  https://<유저명>.github.io/<저장소명>/  형태입니다.
//  - SITE     : "https://<유저명>.github.io"   (도메인까지만)
//  - REPO     : "<저장소명>"                   (저장소 이름, 슬래시 없이 이름만)
//
//  예) 유저명 hong, 저장소 my-blog 이면:
//      SITE = 'https://hong.github.io'
//      REPO = 'my-blog'
//      → 배포 주소: https://hong.github.io/my-blog/
//
//  ※ 저장소 이름을 "<유저명>.github.io" 로 만들면(루트 배포),
//     REPO 를 빈 문자열 ''  로 두면 됩니다.
// =====================================================================
const SITE = 'https://USERNAME.github.io';
const REPO = 'REPO-NAME';

// ── base 자동 처리 (이 부분은 건드릴 필요 없음) ──
//  로컬 개발(npm run dev)에서는 base 를 비워 둡니다.
//    → 홈 버튼 링크 404 문제가 안 생기고, http://localhost:4321/ 로 바로 접속됩니다.
//  GitHub 배포(npm run build) 때만 base 를 '/REPO' 로 켭니다.
//    → GitHub Pages 의 하위 경로(/저장소명/)에 맞춰집니다.
//  (배포 워크플로우가 build 를 실행하므로 자동으로 맞춰집니다.)
const isBuild = process.env.NODE_ENV === 'production';
const BASE = isBuild && REPO ? `/${REPO}` : undefined;

export default defineConfig({
  site: SITE,
  base: BASE,

  integrations: [
    starlight({
      title: '내 기술 블로그',
      description: '반도체 설계 · RTL 검증 · AI 학습 기록',

      // 다국어가 필요 없으면 기본 한국어로 지정
      defaultLocale: 'root',
      locales: {
        root: { label: '한국어', lang: 'ko' },
      },

      // 오른쪽 상단 소셜 링크 (본인 것으로 수정/추가)
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/USERNAME' },
      ],

      // ── 왼쪽 사이드바: 큰 주제 아래 작은 글들이 자동으로 트리에 들어감 ──
      //  autogenerate 는 해당 폴더의 .md / .mdx 를 사이드바에 자동 등록합니다.
      //  글을 추가하면 사이드바도 자동 갱신 — 일일이 등록할 필요 없음.
      sidebar: [
        { label: 'AI',                     items: [{ autogenerate: { directory: 'ai' } }] },
        { label: 'Wireless Communication', items: [{ autogenerate: { directory: 'wireless' } }] },
        { label: 'FPGA',                   items: [{ autogenerate: { directory: 'fpga' } }] },
        { label: 'RTL',                    items: [{ autogenerate: { directory: 'rtl' } }] },
        { label: '기타',                   items: [{ autogenerate: { directory: 'misc' } }] },
      ],

      // 코드 블록에 줄 번호 표시 (선택)
      expressiveCode: { themes: ['github-dark', 'github-light'] },
    }),
  ],
});
```

## 6. 로컬 미리보기

```bash
# 실행 위치: my_blog (프로젝트 루트)
npm run dev
```

`http://localhost:4321` 접속. 왼쪽 카테고리 사이드바가 보이고, 홈의 "기술 문서 보기" 버튼이 글로 이동하면 성공입니다.

:::caution[설정 바꾸면 dev 서버 재시작]
`astro.config.mjs` 를 바꾸면 Ctrl+C 로 끄고 다시 `npm run dev`. 이미 떠 있다는 메시지가 나오면 `npm run dev -- --force`. 글(.md)은 저장만 하면 바로 반영됩니다.
:::

여기까지가 로컬 확인입니다. 인터넷에 올리려면 계속하세요.

## 7. 배포 워크플로우 (deploy.yml)

push 때마다 자동 빌드·배포하는 파일을 만듭니다.

```bash
# 실행 위치: my_blog (프로젝트 루트)
mkdir -p .github/workflows
```

`.github/workflows/deploy.yml` 을 아래 내용으로 만듭니다. (`node-version: 22` 가 없으면 배포가 Node 20으로 돌아 실패하니 그대로 두세요)

```yaml
name: Deploy to GitHub Pages

on:
  # main 브랜치에 push할 때마다 자동 실행
  push:
    branches: [main]
  # Actions 탭에서 수동 실행도 가능하게
  workflow_dispatch:

# 이 워크플로우가 저장소를 읽고 Pages에 배포할 수 있도록 권한 부여
permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout your repository using git
        uses: actions/checkout@v4
      - name: Install, build, and upload your site
        uses: withastro/action@v3
        with:
          node-version: 22       # Astro 7 은 Node 22.12+ 필요 (기본 20이면 빌드 실패)
        # 프로젝트가 저장소 루트가 아니라 하위 폴더에 있으면 아래 path를 지정
        #   path: .

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## 8. 내 GitHub 정보로 수정

`astro.config.mjs` 맨 위 두 줄을 본인 것으로 (예: 아이디 `egghwan`, 저장소 `ASTRO_BLOG`):

```js
const SITE = 'https://egghwan.github.io';
const REPO = 'ASTRO_BLOG';     // 슬래시 없이 이름만, 대소문자까지 정확히
```

`index.astro` 와 `astro.config.mjs` 의 `USERNAME`(GitHub 링크)도 본인 아이디로 바꾸세요.

## 9. GitHub 저장소 만들기

github.com → 우측 상단 **+** → **New repository** → 이름은 8번 `REPO` 와 동일하게 → **Public** → README 등은 체크 안 함 → **Create repository**.

## 10. Git 사용자 등록 (처음 한 번만)

안 하면 커밋 때 `Author identity unknown` 에러가 납니다.

```bash
# 실행 위치: 아무 곳이나 (--global 이라 전역 적용)
git config --global user.name "본인이름"
git config --global user.email "github가입이메일@example.com"
```

## 11. 코드 올리기

```bash
# 실행 위치: my_blog (프로젝트 루트)
git add -A
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/본인아이디/저장소이름.git
git push -u origin main
```

:::caution[remote origin already exists / Repository not found]
- `already exists` → add 대신 덮어쓰기: `git remote set-url origin https://github.com/본인아이디/저장소이름.git`
- `Repository not found` → 주소에 `본인아이디`/`저장소이름` 예시 글자가 그대로 들어간 경우. 실제 값으로 바꾸세요.
:::

push 할 때 비밀번호 대신 토큰을 요구합니다. `https://github.com/settings/tokens` → **Generate new token (classic)** → scope에서 **`repo` 와 `workflow` 둘 다 체크** → 생성된 `ghp_...` 를 Password 자리에 붙여넣기.

:::caution[refusing to allow a Personal Access Token ... workflow scope]
토큰에 `workflow` 권한이 빠진 경우. 토큰 설정에서 `workflow` 체크 후 **Update token** 하고 다시 push.
:::

## 12. GitHub Pages 켜기

저장소 → **Settings** → **Pages** → **Source** 를 **GitHub Actions** 로 선택.

## 13. 배포 확인

저장소 **Actions** 탭에서 초록 체크가 뜨면(1~2분) 접속:

`https://본인아이디.github.io/저장소이름/`  (예: `https://egghwan.github.io/ASTRO_BLOG/`)

글 주소에는 항상 저장소 이름이 들어갑니다. 저장소 이름을 뺀 주소로 직접 들어가면 404가 나니, 홈에서 사이드바·버튼으로 이동하세요.

배포가 반영됐는지 의심되면 강력 새로고침(Ctrl+Shift+R) 후, 그래도 안 되면 실제 HTML 을 확인합니다.

```bash
# 실행 위치: 아무 곳이나
curl -s https://본인아이디.github.io/저장소이름/ | grep -o 'href="[^"]*uvm-verification[^"]*"'
```

`/저장소이름/rtl/uvm-verification/` 처럼 저장소 이름이 붙어 나오면 정상입니다.

## 평소 글 쓰는 흐름

```bash
# 실행 위치: my_blog (프로젝트 루트)
# 1) src/content/docs/<카테고리>/새글.md 작성 (맨 위 --- title: 제목 ---)
# 2) 게시
git add -A
git commit -m "post: 새 글"
git push
```

## 다른 컴퓨터에서 이어서 작업하기 (clone)

집·회사 등 다른 컴퓨터에서 이 블로그를 이어서 쓰려면, GitHub 저장소를 그대로 내려받으면(clone) 됩니다. `node_modules`(설치된 라이브러리)는 용량이 커서 GitHub에 안 올라가므로, clone 후 `npm install` 로 한 번 복구해야 합니다.

새 컴퓨터에서 처음 한 번:

```bash
# 실행 위치: 작업할 상위 폴더 (예: ~/Desktop)
# (1) Node 22 준비 — 1번 참고. node -v 가 v22.x 인지 먼저 확인
node -v

# (2) 저장소 내려받기 (본인 주소로)
git clone https://github.com/본인아이디/저장소이름.git

# (3) 프로젝트 폴더로 이동
cd 저장소이름

# (4) 라이브러리 설치 (node_modules 복구) — clone 직후 한 번 필수
npm install

# (5) 로컬에서 띄워 확인
npm run dev
```

`npm install` 이 끝나면 원래 컴퓨터와 똑같은 상태가 됩니다. 이후로는 글 쓰고 `git add -A && git commit && git push` 하면 됩니다.

:::caution[clone 후 git push 가 인증을 또 요구할 때]
컴퓨터가 바뀌면 토큰 인증을 새로 해야 합니다. 11번처럼 `repo` + `workflow` 권한 토큰을 Password 자리에 넣으세요. Git 사용자 등록(10번)도 새 컴퓨터에선 다시 해야 합니다.
:::

:::note[양쪽 컴퓨터를 오갈 때]
다른 컴퓨터에서 작업하기 전에, 먼저 `git pull` 로 최신 변경을 받아오세요. 안 그러면 두 컴퓨터의 내용이 어긋나 충돌이 날 수 있습니다.

```bash
# 실행 위치: 프로젝트 폴더
git pull        # 작업 시작 전 최신 상태로
```
:::

## 막힐 때

- **Node.js v18/v20 is not supported** — 로컬이면 1번 nvm 으로 22 설치 후 `nvm alias default 22`. 배포면 `deploy.yml` 의 `node-version: 22` 확인.
- **홈 버튼이 저장소 이름 빠진 주소로 가서 404** — 홈을 `index.mdx` 로 만든 경우. 4번처럼 `index.astro` + `link()` 로 만드세요.
- **"autogenerated sidebar groups was removed"** — 옛 사이드바 문법. 5번 설정(`items: [{ autogenerate: ... }]`)이면 해결.
- **Another astro dev server is already running** — `npm run dev -- --force`.
- **CSS 깨지고 글자만 보임** — `REPO` 가 저장소 이름과 안 맞음. 대소문자까지 맞추고 다시 push.
- **Actions 로그의 Node 20 deprecated / EBADENGINE / punycode** — 단순 경고이니 무시. 실패 원인은 빨간 X 단계의 마지막 에러 줄입니다.
- **clone 후 `npm run dev` 가 안 됨 (모듈 없음 에러)** — `npm install` 을 안 한 경우. 프로젝트 폴더에서 `npm install` 후 다시 실행하세요.

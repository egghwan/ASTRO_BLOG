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
const SITE = 'https://egghwan.github.io';
const REPO = 'ASTRO_BLOG';

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

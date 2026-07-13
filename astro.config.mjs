// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
// =====================================================================
//  ★ 배포 전에 아래 두 줄을 본인 것으로 반드시 수정하세요 ★
// =====================================================================
const SITE = 'https://egghwan.github.io';
const REPO = 'ASTRO_BLOG';
const isBuild = process.env.NODE_ENV === 'production';
const BASE = isBuild && REPO ? `/${REPO}` : undefined;
export default defineConfig({
  site: SITE,
  base: BASE,
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
  integrations: [
    starlight({
      title: 'Eggmo',
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
            integrity: 'sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+',
            crossorigin: 'anonymous',
          },
        },
      ],
      customCss: ['./src/styles/custom.css'],
      description: '반도체 설계 · RTL 검증 · AI 학습 기록',
      defaultLocale: 'root',
      locales: {
        root: { label: '한국어', lang: 'ko' },
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/USERNAME' },
      ],
      sidebar: [
        { label: 'AI',                     items: [{ autogenerate: { directory: 'ai' } }] },
        // ── Digital Signal Processing: dsp 직속 글 + DSP 기반 CDR 하위그룹 ──
        {
          label: 'Digital Signal Processing',
          items: [
            // dsp 폴더 바로 아래 글들 (하위 폴더는 collapsed 로 자동 그룹화됨)
            { autogenerate: { directory: 'dsp' } },
          ],
        },
        { label: 'Wireless Communication', items: [{ autogenerate: { directory: 'wireless' } }] },
        { label: 'RTL Library',            items: [{ autogenerate: { directory: 'RTL-library' } }] },
        { label: 'FPGA Demo',              items: [{ autogenerate: { directory: 'fpga' } }] },
        { label: 'UVM',                    items: [{ autogenerate: { directory: 'rtl' } }] },
        { label: '기타',                   items: [{ autogenerate: { directory: 'misc' } }] },
      ],
      expressiveCode: { themes: ['github-dark', 'github-light'] },
    }),
  ],
});

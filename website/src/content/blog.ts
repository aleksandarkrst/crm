import type { Copy, Lang } from './copy';
import { MONTHS, POSTS, TONES, type Category } from './posts';

export interface PostView {
  id: string;
  cat: Category;
  catLabel: string;
  href: string;
  /** "24 Aug 2026 · 5 min read" */
  meta: string;
  title: string;
  excerpt: string;
  body: string[];
  coverBg: string;
  coverFg: string;
  bar: string;
  barAccent: string;
}

/** The posts in one language, newest first, ready to render. */
export function postsFor(lang: Lang, t: Copy): PostView[] {
  return POSTS.map((po) => {
    const date = lang === 'sr' ? `${po.d}. ${MONTHS.sr[po.m]} 2026.` : `${po.d} ${MONTHS.en[po.m]} 2026`;
    return {
      ...po[lang],
      ...TONES[po.tone],
      id: po.id,
      cat: po.cat,
      catLabel: t.cats[po.cat],
      href: `/blog/${po.id}`,
      meta: `${date} · ${po.min} ${t.minRead}`,
    };
  });
}

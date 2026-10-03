import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Avatar, ChoicePill } from '../components/ds';
import { Newsletter } from '../components/Newsletter';
import { PostCard, PostCover } from '../components/PostCard';
import { postsFor } from '../content/blog';
import type { Category } from '../content/posts';
import { useLang } from '../lang';
import { useReveal } from '../hooks';

const CATS: ('all' | Category)[] = ['all', 'guides', 'sales', 'product'];

export function Blog() {
  const { lang, t } = useLang();
  const [cat, setCat] = useState<'all' | Category>('all');
  useReveal(lang, cat);
  const posts = postsFor(lang, t).filter((p) => cat === 'all' || p.cat === cat);
  const [featured, ...rest] = posts;
  return (
    <>
    <main className="blog-page">
      <div className="intro">
        <h1>{t.blogTitle}</h1>
        <p>{t.blogSub}</p>
      </div>
      <div className="cats">
        {CATS.map((c) => <ChoicePill key={c} on={cat === c} onClick={() => setCat(c)}>{t.cats[c]}</ChoicePill>)}
      </div>
      {featured && (
        <Link key={featured.id} to={featured.href} className="featured" data-reveal>
          <PostCover post={featured} big />
          <div className="featured-text">
            <div className="post-meta">{featured.meta}</div>
            <div className="featured-title">{featured.title}</div>
            <div className="post-excerpt">{featured.excerpt}</div>
            <span className="read-more">{t.read} →</span>
          </div>
        </Link>
      )}
      <div className="blog-grid">
        {rest.map((post) => <PostCard key={post.id} post={post} excerpt />)}
      </div>
    </main>
    <Newsletter />
    </>
  );
}

export function Article() {
  const { id } = useParams();
  const { lang, t } = useLang();
  const posts = postsFor(lang, t);
  const post = posts.find((p) => p.id === id);
  if (!post) return <Navigate to="/blog" replace />;
  const related = posts.filter((p) => p.id !== post.id).slice(0, 3);
  return (
    <>
    <main className="article-page">
      <article className="article">
        <Link to="/blog" className="article-back">← {t.navBlog}</Link>
        <div className="caps eyebrow">{post.catLabel}</div>
        <h1>{post.title}</h1>
        <p className="article-excerpt">{post.excerpt}</p>
        <div className="byline">
          <Avatar initials="P" size={32} />
          <span>{t.by} · {post.meta}</span>
        </div>
        <div className="article-body">
          {post.body.map((b) => (b.startsWith('## ') ? <h2 key={b}>{b.slice(3)}</h2> : <p key={b}>{b}</p>))}
        </div>
      </article>
      <div className="related">
        <div className="related-title">{t.moreArticles}</div>
        <div className="post-grid">
          {related.map((p) => (
            <Link key={p.id} to={p.href} className="related-card">
              <span className="caps" style={{ color: 'var(--green-500)' }}>{p.catLabel}</span>
              <div className="post-title">{p.title}</div>
              <div className="post-meta">{p.meta}</div>
            </Link>
          ))}
        </div>
      </div>
    </main>
    <Newsletter />
    </>
  );
}

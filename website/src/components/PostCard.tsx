import { Link } from 'react-router-dom';
import type { PostView } from '../content/blog';

/** The cover: category label over three slanted bars, like the control-desk mark. */
export function PostCover({ post, big = false }: { post: PostView; big?: boolean }) {
  return (
    <div className={big ? 'cover big' : 'cover'} style={{ background: post.coverBg, color: post.coverFg }}>
      <span className="caps">{post.catLabel}</span>
      <div className="cover-bars" aria-hidden="true">
        <span style={{ height: '40%', background: post.bar }} />
        <span style={{ height: '68%', background: post.bar }} />
        <span style={{ height: '100%', background: post.barAccent }} />
      </div>
    </div>
  );
}

export function PostCard({ post, excerpt = false }: { post: PostView; excerpt?: boolean }) {
  return (
    <Link to={post.href} className="post-card" data-reveal>
      <PostCover post={post} />
      <div className="post-meta">{post.meta}</div>
      <div className="post-title">{post.title}</div>
      {excerpt && <div className="post-excerpt">{post.excerpt}</div>}
    </Link>
  );
}

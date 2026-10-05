import { Fragment, type ReactNode } from 'react';

/**
 * Text with the tiny formatting meetings use (milestone 12 decision 8): `**bold**`, lines starting
 * with "- " or "* " as bullets, `[label](https://…)` and bare http(s) links. Everything else is
 * plain text: React escapes it, nothing is parsed as HTML.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>);
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      bullets.push(bullet[1]!);
    } else if (!line.trim()) {
      flushPara();
      flushBullets();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return <div className={'rich-text' + (className ? ' ' + className : '')}>{blocks}</div>;
}

const TOKEN = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;

/** Bold and links inside a line. */
function inline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m.index! > last) out.push(line.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>);
    else out.push(<a key={m.index} href={m[4]} target="_blank" rel="noopener noreferrer">{m[4]}</a>);
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

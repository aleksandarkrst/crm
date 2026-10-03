import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SIGN_UP_URL } from '../appLinks';
import { Avatar, Badge, ButtonLink, FitScore, Icon, Logo, StageBar, TaskCheck } from '../components/ds';
import type { IconName } from '../components/icons';
import { Newsletter } from '../components/Newsletter';
import { PostCard } from '../components/PostCard';
import { postsFor } from '../content/blog';
import { useLang } from '../lang';
import { useCountUp, useReducedMotion, useReveal, useWindowWidth } from '../hooks';

const RAIL_ICONS: IconName[] = ['overview', 'pipeline', 'today', 'company', 'contacts', 'settings'];
const MODULE_ICONS: IconName[] = ['pipeline', 'calendar', 'document', 'team', 'overview'];
const STAT_DOTS = ['#2F7A5E', '#C6F16A', '#B4531B', '#93A39B'];
const STAT_NOTE_COLORS = ['#475750', '#14503C', '#B4531B', '#475750'];
const FUNNEL_BG = ['#CBE3DA', '#A3D2BF', '#5FA587', '#2F7A5E'];

/** Funnel rows narrowing by `step`% each; green steps light → dark, the last (won) row lime. */
function Funnel({ rows, step }: { rows: { name: string; meta: string }[]; step: number }) {
  return (
    <div className="funnel">
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        const dark = !last && i >= 3;
        return (
          <div key={r.name} className="funnel-row" style={{ width: `${100 - i * step}%`, background: last ? '#C6F16A' : FUNNEL_BG[i] }}>
            <span className="funnel-name" style={{ color: dark ? '#FFFFFF' : '#0F1B16' }}>{r.name}</span>
            <span className="funnel-meta" style={{ color: dark ? '#CBE3DA' : last ? '#14503C' : '#475750' }}>{r.meta}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The control-desk mark with its bars rising, and three cards floating around it. */
function DeskMeter() {
  const { t } = useLang();
  const bar = (d: string, fill: string, i: number) => (
    <path key={i} d={d} fill={fill} className="desk-bar"
      style={{ animation: `plRise .9s cubic-bezier(.2,.8,.2,1) ${0.25 + i * 0.18}s both, plMeter ${3 + i * 0.7}s ease-in-out ${1.4 + i * 0.3}s infinite` }} />
  );
  const float = (delay: number) => ({ animation: `plFade .6s ease-out ${delay}s both, plFloat 6s ease-in-out ${delay + 0.6}s infinite` });
  return (
    <div className="desk-meter">
      <svg viewBox="0 0 64 48" className="desk-svg" aria-hidden="true">
        <path d="M14 4h48L52 34H4z" fill="#0D241C" />
        {bar('M20 28h5l2.7-8h-5z', '#FFFFFF', 0)}
        {bar('M28 28h5l4-12h-5z', '#FFFFFF', 1)}
        {bar('M36 28h5l5.3-16h-5z', '#C6F16A', 2)}
        <rect x={4} y={39} width={36} height={5} rx={2.5} fill="#0D241C" />
      </svg>
      <div className="desk-chip" style={{ top: 6, left: 0, ...float(1.2) }}>
        <div className="chip-title">{t.tasks[0].title}</div>
        <div className="chip-meta">{t.tasks[0].meta}</div>
      </div>
      <div className="desk-chip lime" style={{ bottom: 26, right: 0, ...float(1.6) }}>
        <div className="caps" style={{ color: '#0D241C' }}>{t.funnel[4].name}</div>
        <div className="chip-figure" style={{ fontSize: 22, color: '#0D241C' }}>€86k</div>
      </div>
      <div className="desk-chip" style={{ bottom: 0, left: '12%', ...float(2.0) }}>
        <div className="chip-meta" style={{ marginTop: 0 }}>{t.stats[0]}</div>
        <div className="chip-figure" style={{ fontSize: 18, color: '#0F1B16' }}>€412k</div>
      </div>
    </div>
  );
}

function Hero() {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const [wi, setWi] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setWi((i) => (i + 1) % t.words.length), 2400);
    return () => clearInterval(timer);
  }, [reduced, t.words.length]);
  return (
    <section className="hero wrap">
      <div className="hero-copy">
        <div className="caps eyebrow">{t.eyebrow}</div>
        <h1>{t.h1}<br /><span key={wi} className="hero-word">{t.words[wi]}</span></h1>
        <p className="hero-sub">{t.heroSub}</p>
        <div className="hero-cta">
          <ButtonLink className="btn-lg" href={SIGN_UP_URL}>{t.tryCta}</ButtonLink>
        </div>
      </div>
      <div className="hero-art"><DeskMeter /></div>
    </section>
  );
}

/**
 * The Overview screen at 1120×690, scaled down to fit narrow screens. It starts tilted back and
 * straightens as it scrolls into view; its figures count up.
 */
function ProductMock() {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const width = useWindowWidth();
  const p = useCountUp(!reduced);
  const ref = useRef<HTMLDivElement>(null);
  const scale = Math.min(1, (width - 32) / 1140);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      let k = 1;
      if (!reduced && el.parentElement) {
        const r = el.parentElement.getBoundingClientRect();
        k = Math.max(0, Math.min(1, (window.innerHeight - r.top) / (window.innerHeight * 0.75)));
      }
      el.style.transform = `translateX(-50%) perspective(2200px) rotateX(${(1 - k) * 20}deg) scale(${scale * (0.9 + 0.1 * k)})`;
    };
    apply();
    window.addEventListener('scroll', apply, { passive: true });
    return () => window.removeEventListener('scroll', apply);
  }, [reduced, scale]);

  const values = [`€${Math.round(412 * p)}k`, `€${Math.round(86 * p)}k`, `${Math.round(9 * p)}`, `${Math.round(4 * p)}`];

  return (
    <section className="mock-section" aria-hidden="true">
      <div className="mock-section-bg" />
      <div className="mock-box" style={{ height: Math.round(690 * scale + 60) }}>
        <div ref={ref} className="mock">
          <aside className="mock-rail">
            <Logo height={22} onDark wordmark={false} />
            <div className="mock-rail-items">
              {t.mockNav.map((label, i) => (
                <div key={label} className={i === 0 ? 'mock-rail-item on' : 'mock-rail-item'}>
                  <Icon name={RAIL_ICONS[i]} size={19} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </aside>
          <div className="mock-main">
            <div className="mock-top">
              <span className="mock-title">{t.mockTitle}</span>
              <div style={{ flex: 1 }} />
              <div className="mock-search"><Icon name="search" size={15} /><span>{t.mockSearch}</span></div>
              <div style={{ flex: 1 }} />
              <Avatar initials="AP" size={32} />
            </div>
            <div className="mock-body">
              <div className="mock-stats">
                {t.stats.map((label, i) => (
                  <div key={label} className="mock-stat">
                    <div className="mock-stat-label"><i style={{ background: STAT_DOTS[i] }} />{label}</div>
                    <div className="mock-stat-value">{values[i]}</div>
                    <div className="mock-stat-note" style={{ color: STAT_NOTE_COLORS[i] }}>{t.statNotes[i]}</div>
                  </div>
                ))}
              </div>
              <div className="mock-panels">
                <div className="mock-panel">
                  <div className="mock-panel-title">{t.mockFunnel}</div>
                  <div className="mock-panel-sub">{t.mockFunnelSub}</div>
                  <Funnel rows={t.funnel} step={11} />
                </div>
                <div className="mock-panel">
                  <div className="mock-panel-title">{t.mockStalled}</div>
                  <div className="mock-panel-sub" style={{ marginBottom: 10 }}>{t.mockStalledSub}</div>
                  {t.stalled.map((d) => (
                    <div key={d.ini} className="mock-deal">
                      <Avatar initials={d.ini} square size={30} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mock-deal-name">{d.name}</div>
                        <div className="mock-deal-meta">{d.meta}</div>
                      </div>
                      <Badge tone="warn">{d.days}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useLang();
  const [done, setDone] = useState([false, false, false]);
  const delay = (s: number) => ({ transitionDelay: `${s}s` });
  return (
    <section id="product" className="section soft">
      <div className="wrap">
        <div className="intro" data-reveal>
          <div className="caps eyebrow">{t.howCaps}</div>
          <h2 className="h2">{t.howTitle}</h2>
        </div>
        <div className="steps">
          <div className="step" data-reveal>
            <div className="step-num">01</div>
            <div className="step-title">{t.s1t}</div>
            <div className="step-desc">{t.s1d}</div>
            <div className="step-demo">
              <StageBar stages={t.stages} current={2} />
              <div className="deal-card">
                <div className="deal-card-head">
                  <span className="deal-card-name">{t.dealName}</span>
                  <FitScore score={4} />
                </div>
                <div className="task-meta">{t.dealMeta}</div>
              </div>
            </div>
          </div>
          <div className="step" data-reveal style={delay(0.12)}>
            <div className="step-num">02</div>
            <div className="step-title">{t.s2t}</div>
            <div className="step-desc">{t.s2d}</div>
            <div className="step-demo tasks">
              {t.tasks.map((k, i) => (
                <div key={k.title} className="task-row">
                  <TaskCheck done={done[i]} onClick={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="task-title" style={{ color: done[i] ? '#93A39B' : '#0F1B16' }}>{k.title}</div>
                    <div className="task-meta">{k.meta}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="step" data-reveal style={delay(0.24)}>
            <div className="step-num">03</div>
            <div className="step-title">{t.s3t}</div>
            <div className="step-desc">{t.s3d}</div>
            <div className="step-demo"><Funnel rows={t.funnelShort} step={9} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Home() {
  const { lang, t } = useLang();
  useReveal(lang);
  const latest = postsFor(lang, t).slice(0, 3);
  return (
    <main>
      <Hero />
      <ProductMock />
      <HowItWorks />

      <section className="section">
        <div className="wrap tools">
          <div data-reveal>
            <div className="caps eyebrow">{t.toolsCaps}</div>
            <h2 className="h2">{t.toolsTitle}</h2>
            <p className="lead">{t.toolsBody}</p>
          </div>
          <div className="tool-list" data-reveal style={{ transitionDelay: '.1s' }}>
            {t.tools.map((tool) => (
              <div key={tool.a} className="tool-row">
                <span className="tool-old">{tool.a}</span>
                <span>→</span>
                <span className="tool-new">{tool.b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="modules" className="section soft">
        <div className="wrap">
          <div className="intro" data-reveal>
            <div className="caps eyebrow">{t.modCaps}</div>
            <h2 className="h2">{t.modTitle}</h2>
            <p className="lead">{t.modBody}</p>
          </div>
          <div className="modules">
            {t.mods.map(([name, desc], i) => (
              <div key={name} className={i === 0 ? 'module live' : 'module'} data-reveal>
                <div className="module-head">
                  <Icon name={MODULE_ICONS[i]} size={22} />
                  <span className="caps module-status">{i === 0 ? t.live : t.soon}</span>
                </div>
                <div className="module-name">{name}</div>
                <div className="module-desc">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="intro" data-reveal style={{ marginBottom: 40 }}>
            <div className="caps eyebrow">{t.forCaps}</div>
            <h2 className="h2">{t.forTitle}</h2>
          </div>
          <div className="audiences">
            {t.audiences.map((a) => (
              <div key={a.t} className="audience" data-reveal>
                <Icon name={a.icon as IconName} size={22} color="#2F7A5E" />
                <div className="audience-title">{a.t}</div>
                <div className="audience-desc">{a.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 24 }}>
        <div className="wrap">
          <div className="teaser-head">
            <h2>{t.blogTeaser}</h2>
            <Link to="/blog">{t.allArticles} →</Link>
          </div>
          <div className="post-grid">
            {latest.map((post) => <PostCard key={post.id} post={post} />)}
          </div>
        </div>
      </section>

      <Newsletter />
    </main>
  );
}

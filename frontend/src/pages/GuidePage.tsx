import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Logo } from '../components/Brand';
import { GUIDE, type Block, type Section } from '../guide/content';
import { LanguageSwitch, useLang } from '../i18n/LanguageProvider';

const ICON: Record<Section['icon'], JSX.Element> = {
  start: <path d="M5 12h12m-5-5l5 5-5 5M4 4v16" />,
  roles: <><circle cx="8" cy="8" r="3" /><circle cx="16.5" cy="9.5" r="2.5" /><path d="M2.5 19a5.5 5.5 0 0111 0M14 19a4 4 0 017.5-1.5" /></>,
  flow: <><circle cx="5" cy="12" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" /><path d="M7.2 12h2.6M14.2 12h2.6" /></>,
  focal: <><path d="M14.5 4.5l5 5L9 20H4v-5z" /><path d="M12.5 6.5l5 5" /></>,
  leader: <path d="M4 12.5l5 5L20 6.5" />,
  tmo: <><path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" /></>,
  pages: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M3.5 9h17M9 9v11" /></>,
  bell: <><path d="M12 3.5a5 5 0 00-5 5v3l-1.6 2.8h13.2L17 11.5v-3a5 5 0 00-5-5z" /><path d="M10 18a2 2 0 004 0" /></>,
  faq: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.5a2.5 2.5 0 114 2c-.9.6-1.6 1.1-1.6 2.3M12 17h.01" /></>,
};

function Icon({ name }: { name: Section['icon'] }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[name]}
    </svg>
  );
}

const text = (b: Block) => [b.h, b.p, b.tip, ...(b.list ?? []), ...(b.steps ?? [])].filter(Boolean).join(' ').toLowerCase();

/**
 * The user guide, in English and Arabic, for everyone: it opens without signing in (from the sign-in page)
 * and from the "User guide" link in the application. It follows the language switch, can be searched,
 * jumps to the part for each role, and prints cleanly (or saves as PDF from the print dialog).
 */
export default function GuidePage() {
  const { lang } = useLang();
  const g = GUIDE[lang === 'ar' ? 'ar' : 'en'];
  const [q, setQ] = useState('');
  const [active, setActive] = useState(g.sections[0].id);
  const query = q.trim().toLowerCase();

  const sections = useMemo(() => {
    if (!query) return g.sections;
    return g.sections
      .map((s) => ({ ...s, blocks: s.title.toLowerCase().includes(query) ? s.blocks : s.blocks.filter((b) => text(b).includes(query)) }))
      .filter((s) => s.blocks.length > 0);
  }, [g, query]);
  const faq = query ? g.faq.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(query)) : g.faq;

  useEffect(() => {
    document.title = `${g.title} · Task Register`;
  }, [g.title]);
  // The contents follow the reader: the section at the top of the window is marked.
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(`g-${s.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id.slice(2));
    }, { rootMargin: '-80px 0px -60% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  // Printing (or saving as PDF) shows every answer, not only the open ones.
  useEffect(() => {
    const open = () => document.querySelectorAll<HTMLDetailsElement>('.guide-faq').forEach((d) => { d.open = true; });
    window.addEventListener('beforeprint', open);
    return () => window.removeEventListener('beforeprint', open);
  }, []);

  const jump = (id: string) => document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="guide" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="guide-top">
        <Link to="/" className="guide-brand" aria-label={g.back} data-notr><Logo /><span>{lang === 'ar' ? 'سجل المهام' : 'Task Register'}</span></Link>
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={() => window.print()} data-notr>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 9V3.5h10V9M7 17H4.5V9h15v8H17M7 14h10v6.5H7z" /></svg>
          <span>{g.print}</span>
        </button>
        <LanguageSwitch />
        <Link to="/" className="btn sm pri" data-notr>{g.back}</Link>
      </header>

      <div data-notr>
        <section className="guide-hero">
          <div className="guide-hero-in">
            <span className="guide-kicker"><Icon name="start" />{g.updated}</span>
            <h1>{g.title}</h1>
            <p>{g.lead}</p>
            <div className="guide-iam">
              <span>{g.iam}</span>
              {g.roles.map((r) => <button key={r.to} type="button" onClick={() => jump(r.to)}>{r.label}</button>)}
            </div>
            <label className="guide-search">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={g.search} aria-label={g.search} />
            </label>
          </div>
          <ol className="guide-flow" aria-label={g.flowTitle}>
            {g.flow.map((f, i) => (
              <li key={f.name} style={{ ['--i' as string]: String(i) }} className={`gf-${i}`}>
                <b>{i + 1}</b><span className="gf-name">{f.name}</span><span className="gf-who">{f.who}</span>
              </li>
            ))}
            <li className="gf-back">{g.flowBack}</li>
          </ol>
        </section>

        <div className="guide-body">
          <nav className="guide-toc" aria-label={g.contents}>
            <div className="guide-toc-h">{g.contents}</div>
            {g.sections.map((s) => (
              <a key={s.id} href={`#g-${s.id}`} className={active === s.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); jump(s.id); }}>
                <Icon name={s.icon} /><span>{s.title}</span>
              </a>
            ))}
            <a href="#g-faq" className={active === 'faq' ? 'on' : ''} onClick={(e) => { e.preventDefault(); jump('faq'); }}><Icon name="faq" /><span>{g.faqTitle}</span></a>
          </nav>

          <main className="guide-main">
            {sections.length === 0 && faq.length === 0 && <p className="guide-empty">{g.noMatch}</p>}
            {sections.map((s) => (
              <section key={s.id} id={`g-${s.id}`} className={`guide-sec gs-${s.id}`}>
                <header>
                  <span className="guide-ico"><Icon name={s.icon} /></span>
                  <div><h2>{s.title}</h2><p>{s.summary}</p></div>
                </header>
                {s.blocks.map((b, i) => (
                  <div key={i} className="guide-block">
                    {b.h && <h3>{b.h}</h3>}
                    {b.p && <p>{b.p}</p>}
                    {b.steps && <ol className="guide-steps">{b.steps.map((t) => <li key={t}>{t}</li>)}</ol>}
                    {b.list && <ul className="guide-list">{b.list.map((t) => <li key={t}>{t}</li>)}</ul>}
                    {b.tip && <p className="guide-tip">{b.tip}</p>}
                  </div>
                ))}
              </section>
            ))}
            {faq.length > 0 && (
              <section id="g-faq" className="guide-sec gs-faq">
                <header><span className="guide-ico"><Icon name="faq" /></span><div><h2>{g.faqTitle}</h2></div></header>
                {faq.map((f) => (
                  <details key={f.q} className="guide-faq" open={!!query}>
                    <summary>{f.q}</summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

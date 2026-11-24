import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { api } from '../api/client';
import { useBoardSummary, useDependenciesReport, useMasterPlan } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { toast } from '../components/Toasts';
import { useScope } from '../components/WorkGroupScope';
import { ErrorText, Loading } from '../components/ui';
import { useLang } from '../i18n/LanguageProvider';
import { fmtDate, todayIso } from '../lib/format';
import { useRefs } from '../lib/useRefs';
import BoardSummaryReport from '../reports/BoardSummaryReport';
import { Page, savePdf, type Stamp } from '../reports/common';
import DependenciesReport from '../reports/DependenciesReport';
import MasterPlanReport from '../reports/MasterPlanReport';
import ScorecardsReport from '../reports/ScorecardsReport';
import logo from '../assets/al-ayuni-logo.png';

type Key = 'summary' | 'plan' | 'groups' | 'deps';
const REPORTS: { key: Key; title: string; desc: string; file: string; icon: ReactNode }[] = [
  {
    key: 'summary', title: 'Board summary', file: 'Board-Summary',
    desc: 'The headline figures, readiness, the Master Plan, links, what needs attention and every work group.',
    icon: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  },
  {
    key: 'plan', title: 'Master Plan timeline', file: 'Master-Plan-Timeline',
    desc: 'Every task in the Master Plan by work group, with its planned dates on a timeline (landscape).',
    icon: <path d="M3 5h18M3 5v15h18M6.5 8.5h7M10 12.5h8M8 16.5h5" />,
  },
  {
    key: 'groups', title: 'Work group scorecards', file: 'Work-Group-Scorecards',
    desc: 'One page per work group: its figures, its links with other groups and its tasks.',
    icon: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  },
  {
    key: 'deps', title: 'Dependencies and decisions', file: 'Dependencies-and-Decisions',
    desc: 'Who depends on whom, the links still open, and the decisions of the last 30 days.',
    icon: <path d="M6 6a2.5 2.5 0 100 .01M18 6a2.5 2.5 0 100 .01M12 18a2.5 2.5 0 100 .01M8 7.5l3 8.5M16 7.5l-3 8.5M8.5 6h7" />,
  },
];

/** The management board: a set of reports for the board, each saved as PDF in one click, or all as one pack. */
export default function ManagementBoardPage() {
  const { me } = useAuth();
  const { wg } = useScope();
  const { lang } = useLang();
  const refs = useRefs();
  const allowed = !!me?.permissions.view_all;
  const summary = useBoardSummary(wg);
  const plan = useMasterPlan(wg, true, allowed);
  const deps = useDependenciesReport(wg, allowed);
  const [key, setKey] = useState<Key>('summary');
  const [busy, setBusy] = useState<'one' | 'pack' | null>(null);
  const [packing, setPacking] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const pack = useRef<HTMLDivElement>(null);
  const packDone = useRef<(() => void) | null>(null);

  // The pack is drawn off screen only while it is being saved; once it is on the page, it is captured.
  useEffect(() => {
    if (packing && packDone.current) {
      const go = packDone.current;
      packDone.current = null;
      requestAnimationFrame(() => requestAnimationFrame(go));
    }
  }, [packing]);

  if (!allowed) return <Navigate to="/" replace />;
  const error = summary.error ?? plan.error ?? deps.error;
  if (error) return <ErrorText error={error} />;
  if (!summary.data || !plan.data || !deps.data) return <Loading />;

  const s = summary.data;
  const stamp: Stamp = {
    generatedAt: s.generated_at,
    preparedBy: s.prepared_by,
    scope: s.scope ? `${s.scope.code} – ${s.scope.name}` : 'All work groups',
  };
  const groupName = (code: string) => refs.groups.find((g) => g.code === code)?.name ?? '';
  const render = (k: Key) =>
    k === 'summary' ? <BoardSummaryReport r={s} stamp={stamp} />
      : k === 'plan' ? <MasterPlanReport rows={plan.data} summary={s} groupName={groupName} stamp={stamp} />
        : k === 'groups' ? <ScorecardsReport summary={s} rows={plan.data} deps={deps.data} stamp={stamp} />
          : <DependenciesReport d={deps.data} stamp={stamp} />;
  const current = REPORTS.find((r) => r.key === key) ?? REPORTS[0];
  const suffix = `${s.scope ? `${s.scope.code}-` : ''}${todayIso()}${lang === 'ar' ? '-AR' : ''}`;
  const pageCount = (k: Key) =>
    k === 'summary' ? 2 : k === 'groups' ? s.groups.length : k === 'plan' ? Math.max(1, 1 + Math.ceil(Math.max(0, s.plan.included + new Set(plan.data.filter((r) => r.status === 'in_master_plan').map((r) => r.work_group_code)).size - 17) / 22)) : null;

  const logExport = (report: string) =>
    void api('/api/reports/board-summary/exported/', { method: 'POST', body: { scope: s.scope?.code ?? 'All work groups', report } }).catch(() => undefined);

  const downloadOne = async () => {
    const pages = [...(preview.current?.querySelectorAll<HTMLElement>('.rp-page') ?? [])];
    if (!pages.length) return;
    setBusy('one');
    try {
      await savePdf(pages, `Management-Board-${current.file}-${suffix}.pdf`, `Management board – ${current.title}`);
      logExport(current.title);
      toast('The PDF is saved in your downloads.');
    } catch {
      toast('The PDF could not be made. Try again, or print the page to PDF.');
    } finally {
      setBusy(null);
    }
  };

  const downloadPack = () => {
    setBusy('pack');
    packDone.current = async () => {
      try {
        const pages = [...(pack.current?.querySelectorAll<HTMLElement>('.rp-page') ?? [])];
        await savePdf(pages, `Management-Board-Pack-${suffix}.pdf`, 'Management board – Board pack');
        logExport('Board pack');
        toast('The board pack is saved in your downloads.');
      } catch {
        toast('The PDF could not be made. Try again, or print the page to PDF.');
      } finally {
        setPacking(false);
        setBusy(null);
      }
    };
    setPacking(true);
  };

  return (
    <div className="stack rp-wrap">
      <div className="mb-cards" role="tablist" aria-label="Reports">
        {REPORTS.map((r) => (
          <button key={r.key} type="button" role="tab" aria-selected={key === r.key} className={`mb-card ${key === r.key ? 'on' : ''}`} onClick={() => setKey(r.key)}>
            <span className="mb-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{r.icon}</svg>
            </span>
            <b>{r.title}</b>
            <span className="mb-desc">{r.desc}</span>
            {pageCount(r.key) !== null && <span className="mb-pages">{pageCount(r.key) === 1 ? '1 page' : `${pageCount(r.key)} pages`}</span>}
          </button>
        ))}
      </div>

      <div className="rp-bar">
        <div className="rp-bar-txt">
          <b>{current.title}</b>
          <span className="t2">{s.scope ? 'One work group, as chosen in the side menu.' : 'Every work group. Choose one in the side menu for its own reports.'}</span>
        </div>
        <button type="button" className="btn" onClick={() => { void summary.refetch(); void plan.refetch(); void deps.refetch(); }} disabled={summary.isFetching}>
          {summary.isFetching ? 'Refreshing…' : 'Refresh figures'}
        </button>
        <button type="button" className="btn" onClick={downloadPack} disabled={busy !== null} data-tip="All four reports in one PDF, with a cover page">
          {busy === 'pack' ? 'Making the pack…' : 'Download board pack'}
        </button>
        <button type="button" className="btn pri rp-dlbtn" onClick={() => void downloadOne()} disabled={busy !== null}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg>
          {busy === 'one' ? 'Making the PDF…' : 'Download PDF'}
        </button>
      </div>

      <div className="rp-scroll">
        <div className="rp-paper" ref={preview} dir={lang === 'ar' ? 'rtl' : 'ltr'} key={key}>
          {render(key)}
        </div>
      </div>

      {packing && (
        <div className="rp-offscreen" aria-hidden="true">
          <div className="rp-paper" ref={pack} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <Page stamp={stamp} n={1} of={1} className="rp-cover">
              <img src={logo} alt="" width={96} height={93} />
              <span className="rp-kicker">Al-Ayuni TMO Task Register</span>
              <h2 className="rp-cover-t">Management board</h2>
              <p className="rp-cover-s">Board pack</p>
              <p className="rp-cover-m">{`${stamp.scope} · ${fmtDate(s.generated_at.slice(0, 10))}`}</p>
              <ol className="rp-toc">
                {REPORTS.map((r, i) => <li key={r.key}><i>{i + 1}</i><b>{r.title}</b><span>{r.desc}</span></li>)}
              </ol>
              <p className="rp-note">{`Prepared by ${s.prepared_by}`}</p>
            </Page>
            {REPORTS.map((r) => <div key={r.key} className="rp-sec">{render(r.key)}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

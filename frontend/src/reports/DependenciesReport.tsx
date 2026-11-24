import type { DependenciesReport as Deps } from '../api/types';
import { fmtDate } from '../lib/format';
import { Page, paginate, ReportHead, RunningHead, type Stamp } from './common';

/** Long texts are cut, so that every row stays on its page. */
const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v);

const DECISION: Record<Deps['decisions'][number]['decision'], string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  included: 'Included in the plan',
  returned: 'Sent back',
};

type Block =
  | { kind: 'open'; rows: Deps['open_links'] }
  | { kind: 'decisions'; rows: Deps['decisions'] };

/**
 * Who depends on whom: the links between work groups as a matrix, the links still open, and the decisions of
 * the last 30 days (leaders on tasks and links, the TMO on tasks).
 */
export default function DependenciesReport({ d, stamp }: { d: Deps; stamp: Stamp }) {
  const title = 'Dependencies and decisions';
  const codes = d.groups.map((g) => g.code);
  const cell = (from: string, to: string) => d.matrix.find((c) => c.from === from && c.to === to);
  const tone = (c: Deps['matrix'][number]) => (c.rejected ? 'bad' : c.pending ? (c.approved ? 'mix' : 'wait') : 'ok');

  // Page 1 holds the matrix and the first open links; the rest flow onto the next pages, then the decisions.
  const firstOpen = d.open_links.slice(0, codes.length > 10 ? 3 : 8);
  const moreOpen = paginate(d.open_links.slice(firstOpen.length), 0, 16).slice(1);
  const decisionPages = paginate(d.decisions, 0, 15).slice(1);
  const later: Block[][] = [
    ...moreOpen.map((rows) => [{ kind: 'open', rows } as Block]),
    ...(decisionPages.length ? decisionPages : [[]]).map((rows) => [{ kind: 'decisions', rows } as Block]),
  ];
  const total = 1 + later.length;

  const openTable = (rows: Deps['open_links']) => (
    <table className="rp-tab">
      <thead><tr><th>Task</th><th>Link</th><th>What</th><th>Review</th><th className="r">Days</th></tr></thead>
      <tbody>
        {rows.map((l, i) => (
          <tr key={`${l.task}-${l.to}-${i}`}>
            <td><span className="rp-code" data-notr>{l.task}</span> {cut(l.title, 55)}</td>
            <td className="nowrap" data-notr dir="ltr">{l.kind === 'needs' ? `${l.from} ← ${l.to}` : `${l.from} → ${l.to}`}</td>
            <td>{cut(l.what || '–', 60)}{l.note && <span className="rp-dim">{` · “${cut(l.note, 70)}”`}</span>}</td>
            <td><span className={`rp-why ${l.review === 'rejected' ? 'rp-plan_not_ok' : 'rp-waiting_leader'}`}>{l.review === 'rejected' ? 'Rejected' : 'Waiting for review'}</span></td>
            <td className="r">{l.days}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <Page stamp={stamp} n={1} of={total}>
        <ReportHead title={title} stamp={stamp} />
        <div className="rp-strip">
          <div><b>{d.totals.links}</b><span>Links between groups</span></div>
          <div><b>{d.totals.approved}</b><span>Agreed</span></div>
          <div><b>{d.totals.pending}</b><span>Waiting for review</span></div>
          <div><b className={d.totals.rejected ? 'rp-bad' : ''}>{d.totals.rejected}</b><span>Rejected</span></div>
          <div><b>{d.decisions_total}</b><span>{`Decisions in ${d.decided_days} days`}</span></div>
        </div>

        <h3 className="rp-h">Who depends on whom</h3>
        {d.matrix.length ? (
          <>
            <table className="rp-mx" dir="ltr">
              <thead>
                <tr><th className="rp-mx-corner"><span>Task of</span><span>Other group</span></th>{codes.map((c) => <th key={c} data-notr>{c}</th>)}</tr>
              </thead>
              <tbody>
                {codes.map((from) => (
                  <tr key={from}>
                    <th data-notr>{from}</th>
                    {codes.map((to) => {
                      const c = from === to ? null : cell(from, to);
                      return <td key={to} className={from === to ? 'self' : c ? `on ${tone(c)}` : ''}>{c ? c.total : ''}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rp-legend">
              <span><i className="rp-sw-ok" />All agreed</span>
              <span><i className="rp-sw-mix" />Some waiting for review</span>
              <span><i className="rp-sw-wait" />None agreed yet</span>
              <span><i className="rp-sw-bad" />At least one rejected</span>
            </div>
            <p className="rp-note">Each number counts the links a group’s tasks record with another group: what they need from it, or deliver to it.</p>
          </>
        ) : <p className="rp-note">No links between work groups yet.</p>}

        <h3 className="rp-h">{`Open links · ${d.open_total}`}</h3>
        {firstOpen.length ? openTable(firstOpen) : <p className="rp-note">Every link is agreed.</p>}
      </Page>

      {later.map((blocks, i) => (
        <Page key={i} stamp={stamp} n={i + 2} of={total}>
          <RunningHead title={title} stamp={stamp} />
          {blocks.map((b, j) => b.kind === 'open' ? (
            <div key={j}>
              <h3 className="rp-h rp-h1">Open links (continued)</h3>
              {openTable(b.rows)}
            </div>
          ) : (
            <div key={j}>
              <h3 className="rp-h rp-h1">{`Decisions of the last ${d.decided_days} days`}</h3>
              {b.rows.length ? (
                <table className="rp-tab">
                  <thead><tr><th>Date</th><th>Decision</th><th>Task or link</th><th>By</th></tr></thead>
                  <tbody>
                    {b.rows.map((x, k) => (
                      <tr key={k}>
                        <td className="nowrap">{fmtDate(x.at.slice(0, 10))}</td>
                        <td className="nowrap"><span className={`rp-why ${x.decision === 'rejected' || x.decision === 'returned' ? 'rp-plan_not_ok' : 'rp-waiting_tmo'}`}>{DECISION[x.decision]}</span></td>
                        <td>
                          <span className="rp-code" data-notr>{x.code}</span> {cut(x.title, 60)}
                          <span className="rp-dim">{x.subject === 'link' ? ` · link with ${x.group}` : ` · ${x.group}`}</span>
                          {x.note && <div className="rp-dim">{`“${cut(x.note, 90)}”`}</div>}
                        </td>
                        <td className="nowrap">{x.who || '–'}<div className="rp-dim">{x.role === 'tmo' ? 'TMO' : 'Leader'}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="rp-note">{`No decision in the last ${d.decided_days} days.`}</p>}
              {i === later.length - 1 && d.decisions_total > d.decisions.length && <p className="rp-note">{`And ${d.decisions_total - d.decisions.length} more in the application.`}</p>}
            </div>
          ))}
        </Page>
      ))}
    </>
  );
}

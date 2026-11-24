import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { qs } from '../api/client';
import { useAuditFacets, useAuditTrail } from '../api/queries';
import type { AuditEntry } from '../api/types';
import { Empty, ErrorText, Pager, Panel, Tip, usePaging } from '../components/ui';
import { fmtStamp } from '../lib/format';
import { browserName } from '../lib/useragent';

/** Colour family of each action, so creations, changes, deletions and sign-in problems stand apart. */
const TONE: Record<string, string> = {
  create: 'ok', update: 'info', transition: 'info', approval: 'info', review: 'info', delete: 'bad',
  login: 'muted', logout: 'muted', login_failed: 'warn', export: 'muted', restore: 'warn', admin: 'warn',
};

function Changes({ e }: { e: AuditEntry }) {
  const rows = Object.entries(e.changes ?? {});
  return (
    <div className="audit-detail">
      {rows.length ? (
        <table className="chg">
          <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
          <tbody>
            {rows.map(([k, [before, after]]) => (
              <tr key={k}>
                <td className="t1">{k}</td>
                <td className={`prewrap ${before === null ? 't2' : 'was'}`}>{before ?? '—'}</td>
                <td className={`prewrap ${after === null ? 't2' : 'now'}`}>{after ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="t2">No field values were recorded for this entry.</p>}
      <dl className="req">
        <div><dt>Request</dt><dd className="mono">{[e.method, e.path].filter(Boolean).join(' ') || '—'}</dd></div>
        <div><dt>Address</dt><dd className="mono">{e.ip || '—'}</dd></div>
        <div><dt>Browser</dt><dd title={e.user_agent}>{browserName(e.user_agent) || '—'}</dd></div>
        <div><dt>Entry</dt><dd className="mono">#{e.id}</dd></div>
      </dl>
    </div>
  );
}

export default function AuditPage() {
  const facets = useAuditFacets();
  const paging = usePaging(25);
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [f, setF] = useState({ actor: '', action: '', entity: '', work_group: '', date_from: '', date_to: '' });
  const [open, setOpen] = useState<number | null>(null);
  // Searching waits until typing pauses, so each key press does not start a request.
  useEffect(() => {
    const t = window.setTimeout(() => { setQ(typed.trim()); paging.setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = { ...f, q, page: paging.page, page_size: paging.size };
  const trail = useAuditTrail(params);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); paging.setPage(1); };
  const filtered = Boolean(q || Object.values(f).some(Boolean));
  const exportHref = `/api/audit/export/${qs({ ...f, q })}`;
  const fa = facets.data;

  return (
    <div className="stack">
      <Panel title="Audit trail" tip="Every change, decision, sign-in, failed sign-in, export and restore, with who did it, when, from where, and the values before and after. Click an entry to see its details."
        actions={<a className="btn sm" href={exportHref} download>Download CSV</a>}>
        <div className="filters">
          <input type="search" aria-label="Search the audit trail" placeholder="Search: task, user, address, value…" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <select aria-label="User" value={f.actor} onChange={set('actor')}>
            <option value="">All users</option>
            {fa?.actors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select aria-label="Action" value={f.action} onChange={set('action')}>
            <option value="">All actions</option>
            {fa?.actions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select aria-label="Record type" value={f.entity} onChange={set('entity')}>
            <option value="">All records</option>
            {fa?.entities.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select aria-label="Work group" value={f.work_group} onChange={set('work_group')}>
            <option value="">All work groups</option>
            {fa?.work_groups.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <label className="date-f">From <input type="date" value={f.date_from} max={f.date_to || undefined} onChange={set('date_from')} /></label>
          <label className="date-f">To <input type="date" value={f.date_to} min={f.date_from || undefined} onChange={set('date_to')} /></label>
          {filtered && (
            <button type="button" className="btn sm ghost" onClick={() => { setTyped(''); setQ(''); setF({ actor: '', action: '', entity: '', work_group: '', date_from: '', date_to: '' }); }}>
              Clear filters
            </button>
          )}
          <span className="spacer" />
          <span className="t2">{trail.data ? `${trail.data.count} entries` : ''}</span>
        </div>
        <ErrorText error={trail.error} />
        <div className="tw"><table className="audit">
          <thead><tr>
            <th>When</th><th>Who</th><th>Action</th><th>Record</th><th>What happened</th>
            <th>Address <Tip text="The network address the request came from." /></th>
          </tr></thead>
          <tbody>
            {trail.data?.results.map((e) => (
              <Fragment key={e.id}>
                <tr className={`click ${open === e.id ? 'sel' : ''}`} onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <td className="mono nowrap small">{fmtStamp(e.created_at)}</td>
                  <td className="nowrap">{e.actor}{e.actor_name && e.actor !== e.actor_name && <div className="t2 mono">{e.actor_name}</div>}</td>
                  <td><span className={`act ${TONE[e.action] ?? 'muted'}`}>{e.action_label ?? e.action}</span></td>
                  <td className="nowrap">
                    <div className="t2">{e.entity}{e.work_group ? ` · ${e.work_group}` : ''}</div>
                    {e.entity === 'Task' && e.entity_id
                      ? <Link to={`/tasks/${e.entity_id}`} className="mono" onClick={(ev) => ev.stopPropagation()}>{e.entity_label}</Link>
                      : <span className="mono">{e.entity_label}</span>}
                  </td>
                  <td>{e.summary}{Object.keys(e.changes ?? {}).length > 0 && <span className="cc">{` ${Object.keys(e.changes ?? {}).length} fields`}</span>}</td>
                  <td className="mono small">{e.ip || '—'}</td>
                </tr>
                {open === e.id && <tr className="detail-row"><td colSpan={6}><Changes e={e} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table></div>
        {trail.data && !trail.data.count && <Empty>{filtered ? 'Nothing matches these filters. Clear them to see the whole trail.' : 'Nothing has been recorded yet.'}</Empty>}
        {trail.data && <Pager count={trail.data.count} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} />}
      </Panel>
    </div>
  );
}

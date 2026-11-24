import { Fragment, useEffect, useState } from 'react';

import { useSystemAction, useSystemEvents, useSystemSummary } from '../api/queries';
import type { SystemEvent } from '../api/types';
import { ConfirmButton, Empty, ErrorText, Pager, Panel, Tip, usePaging } from '../components/ui';
import { fmtStamp } from '../lib/format';
import { browserName } from '../lib/useragent';

const SOURCE_TIP = 'Server: an error inside the application (with its traceback). Browser: a page that failed in a user\'s browser. Security: failed sign-ins, lockouts, refused requests and other warnings.';

function Detail({ e }: { e: SystemEvent }) {
  const act = useSystemAction();
  const [note, setNote] = useState('');
  return (
    <div className="issue-detail">
      <dl className="req">
        <div><dt>First seen</dt><dd>{fmtStamp(e.first_seen)}</dd></div>
        <div><dt>Last seen</dt><dd>{fmtStamp(e.last_seen)}</dd></div>
        <div><dt>Times</dt><dd className="num">{e.count}</dd></div>
        <div><dt>Request</dt><dd className="mono">{[e.method, e.path].filter(Boolean).join(' ') || '—'}{e.status_code ? ` → ${e.status_code}` : ''}</dd></div>
        <div><dt>User</dt><dd>{e.username || '—'}</dd></div>
        <div><dt>Address</dt><dd className="mono">{e.ip || '—'}</dd></div>
        <div><dt>Browser</dt><dd title={e.user_agent}>{browserName(e.user_agent) || '—'}</dd></div>
        <div><dt>Kind</dt><dd className="mono">{e.kind}</dd></div>
      </dl>
      <div className="t1 issue-msg prewrap">{e.message}</div>
      {e.detail && <pre className="trace" tabIndex={0} aria-label="Technical details">{e.detail}</pre>}
      <ErrorText error={act.error} />
      {e.resolved ? (
        <div className="issue-acts">
          <span className="t2">Resolved by {e.resolved_by_name || '—'} on {fmtStamp(e.resolved_at)}{e.resolution_note ? `: ${e.resolution_note}` : ''}</span>
          <button type="button" className="btn sm" onClick={() => act.mutate({ path: `${e.id}/reopen/` })}>Reopen</button>
        </div>
      ) : (
        <div className="issue-acts">
          <input aria-label="Resolution note" placeholder="What was done (optional), e.g. fixed in 1.14, user reminded of password" value={note} maxLength={500} onChange={(ev) => setNote(ev.target.value)} />
          <button type="button" className="btn sm pri" disabled={act.isPending} onClick={() => act.mutate({ path: `${e.id}/resolve/`, body: { note } })}>Mark resolved</button>
        </div>
      )}
    </div>
  );
}

export default function SystemIssuesPage() {
  const summary = useSystemSummary();
  const act = useSystemAction();
  const paging = usePaging(25);
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => { setQ(typed.trim()); paging.setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  const filters = { level, source, q, resolved: status === 'all' ? '' : status === 'resolved' ? 'true' : 'false' };
  const events = useSystemEvents({ ...filters, page: paging.page, page_size: paging.size });
  const s = summary.data;
  const kpi = (label: string, value: number | undefined, tip: string, tone = '') => (
    <div className="kpi">
      <span className="kpi-l">{label} <Tip text={tip} /></span>
      <span className={`kpi-v ${tone}`}>{value ?? '–'}</span>
    </div>
  );
  return (
    <div className="stack">
      <div className="kpis">
        {kpi('Open errors', s?.open_errors, 'Server and browser errors not yet marked resolved.', s?.open_errors ? 'bad' : '')}
        {kpi('Open warnings', s?.open_warnings, 'Security warnings not yet marked resolved.', s?.open_warnings ? 'warn' : '')}
        {kpi('Errors, last 24 hours', s?.errors_24h, 'How many times an error happened in the last 24 hours (repeats included).')}
        {kpi('Failed sign-ins, last 24 hours', s?.failed_signins_24h, 'Wrong passwords and unknown user names. Many from one address can mean password guessing.')}
      </div>
      <Panel title="System errors & alerts" tip={`Errors and warnings recorded by the application, newest first. The same problem is counted on one row. Kept for ${s?.retention_days ?? 90} days.`}>
        <div className="filters">
          <div className="seg" role="group" aria-label="Status">
            {(['open', 'resolved', 'all'] as const).map((k) => (
              <button key={k} type="button" className={status === k ? 'on' : ''} aria-pressed={status === k} onClick={() => { setStatus(k); paging.setPage(1); }}>
                {{ open: 'Open', resolved: 'Resolved', all: 'All' }[k]}
              </button>
            ))}
          </div>
          <select aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value); paging.setPage(1); }}>
            <option value="">Errors and warnings</option><option value="error">Errors</option><option value="warning">Warnings</option>
          </select>
          <select aria-label="Source" value={source} onChange={(e) => { setSource(e.target.value); paging.setPage(1); }}>
            <option value="">All sources</option><option value="server">Server</option><option value="browser">Browser</option><option value="security">Security</option>
          </select>
          <Tip text={SOURCE_TIP} />
          <input type="search" aria-label="Search issues" placeholder="Search: message, page, user, address…" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <span className="spacer" />
          {status !== 'resolved' && !!events.data?.count && (
            <ConfirmButton label={`Resolve all ${events.data.count} shown`} confirmTitle="Mark all the issues shown as resolved?" message="Every issue that matches the current filters is marked resolved with the note “Resolved together”. You can reopen them one by one." confirmLabel="Resolve all" onConfirm={() => act.mutate({ path: `resolve-all/?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()}`, body: { note: 'Resolved together' } })} />
          )}
        </div>
        <ErrorText error={events.error || act.error} />
        <div className="tw"><table className="sys-issues">
          <thead><tr><th>Last seen</th><th>Level</th><th>Source</th><th>What happened</th><th>Where</th><th>User</th><th className="r">Times</th></tr></thead>
          <tbody>
            {events.data?.results.map((e) => (
              <Fragment key={e.id}>
                <tr className={`click ${open === e.id ? 'sel' : ''} ${e.resolved ? 'inactive' : ''}`} onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <td className="mono nowrap small">{fmtStamp(e.last_seen)}</td>
                  <td><span className={`lvl ${e.level}`}>{e.level_label}</span></td>
                  <td>{e.source_label}</td>
                  <td><div className="clamp2">{e.message}</div>{e.resolved && <span className="chk ok">Resolved</span>}</td>
                  <td className="mono small">{[e.method, e.path].filter(Boolean).join(' ') || '—'}</td>
                  <td className="nowrap">{e.username || '—'}</td>
                  <td className="num r">{e.count}</td>
                </tr>
                {open === e.id && <tr className="detail-row"><td colSpan={7}><Detail e={e} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table></div>
        {events.data && !events.data.count && (
          <Empty>{status === 'open' ? 'No open issues. Errors and security warnings appear here as soon as they happen.' : 'Nothing matches these filters.'}</Empty>
        )}
        {events.data && <Pager count={events.data.count} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} />}
      </Panel>
    </div>
  );
}

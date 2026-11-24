import { useRef, useState, type FormEvent } from 'react';

import { api, upload } from '../api/client';
import { useAudit, useRestorePoints } from '../api/queries';
import type { BackupSummary, RestorePoint } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/Confirm';
import { Empty, ErrorText, Loading, Pager, Panel, usePaging } from '../components/ui';
import { fmtStamp } from '../lib/format';

const CONFIRM = 'RESTORE';

const COUNT_LABELS: Record<string, string> = {
  'auth.group': 'Roles',
  'auth.user': 'Users',
  'masterdata.workgroup': 'Work groups',
  'masterdata.groupmember': 'Group members',
  'masterdata.direction': 'Directions',
  'masterdata.lookupvalue': 'List values',
  'register.task': 'Tasks',
  'register.activity': 'Activities',
  'register.taskpartner': 'Partner rows',
  'register.contribution': 'Contributions',
  'core.auditlog': 'Audit entries',
};

const stamp = (iso: string | null) => fmtStamp(iso) || '—';

function History() {
  const paging = usePaging();
  const log = useAudit({ entity: 'backup', page: paging.page, page_size: paging.size });
  if (log.error) return <ErrorText error={log.error} />;
  if (!log.data) return <Loading />;
  if (!log.data.count) return <Empty>No backups downloaded yet.</Empty>;
  return (
    <>
      <div className="tw">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>
            {log.data.results.map((e) => (
              <tr key={e.id}>
                <td className="nowrap mono">{stamp(e.created_at)}</td>
                <td>{e.actor || '—'}</td>
                <td>{e.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager count={log.data.count} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} />
    </>
  );
}

/** Restore points: a full backup kept automatically before every restore (the last five). */
function RestorePoints({ points }: { points: RestorePoint[] }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!points.length) return <Empty>No restore point yet. One is kept automatically before every restore.</Empty>;
  const goBack = async (p: RestorePoint) => {
    const ok = await confirm({
      title: 'Go back to this restore point?',
      message: <><p className="confirm-subject">{stamp(p.created_at)} · {p.reason}</p><p>ALL current data is replaced with the data of this restore point. A restore point of the current data is kept first, and everyone is signed in again.</p></>,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/backup/restore-points/${p.id}/restore/`, { method: 'POST', body: { confirm: CONFIRM } });
      window.location.assign('/?restored=1');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <>
      <ErrorText error={error} />
      <div className="tw">
        <table>
          <thead><tr><th>When</th><th>Why</th><th>By</th><th className="r">Tasks</th><th className="r">Activities</th><th className="r">Users</th><th /></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td className="nowrap mono">{stamp(p.created_at)}</td>
                <td>{p.reason}</td>
                <td>{p.created_by || '—'}</td>
                <td className="num r">{p.counts['register.task'] ?? 0}</td>
                <td className="num r">{p.counts['register.activity'] ?? 0}</td>
                <td className="num r">{p.counts['auth.user'] ?? 0}</td>
                <td className="r nowrap">
                  <button type="button" className="btn sm" disabled={busy} onClick={() => void goBack(p)}>
                    {busy ? 'Restoring…' : 'Restore'}
                  </button>
                  <a className="btn ghost sm" href={`/api/backup/restore-points/${p.id}/download/`} download>Download</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function BackupPage() {
  const { me } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupSummary | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const points = useRestorePoints(!!me?.permissions.admin);
  if (!me?.permissions.admin) return <Empty>Only administrators can back up or restore the data.</Empty>;

  const send = async (dryRun: boolean) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('dry_run', dryRun ? 'true' : 'false');
    if (!dryRun) form.append('confirm', confirm);
    setBusy(true);
    setError(null);
    try {
      const result = await upload<BackupSummary>('/api/backup/restore/', form);
      if (result.restored) {
        // Everything changed, possibly including your own account: start the app again.
        window.location.assign('/?restored=1');
        return;
      }
      setPreview(result);
    } catch (e) {
      setError(e);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setConfirm('');
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onCheck = (e: FormEvent) => {
    e.preventDefault();
    void send(true);
  };

  return (
    <div className="stack">
      <p className="intro">
        Keep a copy of all the application data in case it is lost. A backup holds every user and role, the configuration, all
        registers with their partner rows, contributions and activities, and the audit log. Download one before big changes and on a
        regular schedule, and keep it somewhere safe: it contains users' password hashes (never the passwords themselves).
      </p>
      <div className="grid g2">
        <Panel title="Download" tip="Both downloads are recorded in the audit log.">
          <div className="dl-row">
            <div>
              <strong>Full backup</strong>
              <p className="hint">One JSON file with every record. This is the file you restore from.</p>
            </div>
            <a className="btn pri" href="/api/backup/export/" download>Download backup</a>
          </div>
          <div className="dl-row">
            <div>
              <strong>Excel export</strong>
              <p className="hint">A readable copy with one sheet per table, for reports or review. It cannot be restored.</p>
            </div>
            <a className="btn" href="/api/backup/export-excel/" download>Download Excel</a>
          </div>
        </Panel>

        <Panel title="Restore from a backup" tip="Restoring replaces ALL current data with the data in the file. It is all or nothing.">
          <form className="stack restore" onSubmit={onCheck}>
            <div className="fld">
              <label htmlFor="backup-file">Backup file (.json)</label>
              <input
                id="backup-file"
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                  setConfirm('');
                  setError(null);
                }}
              />
            </div>
            {!preview && (
              <div>
                <button type="submit" className="btn" disabled={!file || busy}>{busy ? 'Checking…' : 'Check file'}</button>
                <p className="hint">Checking reads the file and shows what it contains. Nothing changes yet.</p>
              </div>
            )}
            <ErrorText error={error} />
            {preview && (
              <>
                <div className="ok-box">
                  Valid backup from <strong>{stamp(preview.created_at)}</strong>, made by <strong>{preview.created_by}</strong>{' '}
                  (version {preview.app_version}).
                </div>
                {preview.notes.map((n) => <div key={n} className="warn-box">{n}</div>)}
                <div className="tw">
                  <table>
                    <thead><tr><th>Item</th><th className="r">In this backup</th><th className="r">Now</th></tr></thead>
                    <tbody>
                      {Object.entries(preview.counts).map(([k, n]) => (
                        <tr key={k}>
                          <td>{COUNT_LABELS[k] ?? k}</td>
                          <td className="r num">{n}</td>
                          <td className={`r num ${preview.current_counts[k] !== n ? 'warn strong' : ''}`}>{preview.current_counts[k] ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="warn-box">
                  Restoring <strong>deletes all current data</strong> and replaces it with this backup, including users and
                  roles. A restore point of the current data is kept first, so you can go back from the Restore points list
                  below. You may have to sign in again afterwards.
                </div>
                <div className="fld">
                  <label htmlFor="confirm">Type {CONFIRM} to confirm</label>
                  <input id="confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
                <div className="row-btns">
                  <button type="button" className="btn danger" disabled={confirm !== CONFIRM || busy} onClick={() => void send(false)}>
                    {busy ? 'Restoring…' : 'Replace all data with this backup'}
                  </button>
                  <button type="button" className="btn ghost" onClick={reset} disabled={busy}>Cancel</button>
                </div>
              </>
            )}
          </form>
        </Panel>
      </div>

      <Panel title="Restore points" tip="Kept automatically before every restore, so a restore can be undone. The last five are kept, on the server.">
        {points.error ? <ErrorText error={points.error} /> : points.data ? <RestorePoints points={points.data} /> : <Loading />}
      </Panel>

      <Panel title="Backup history" tip="Downloads and restores, from the audit log.">
        <History />
      </Panel>
    </div>
  );
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import type { CheckSummary, Status } from '../api/types';
import { fmtDate, fmtShort } from '../lib/format';
import { CheckBadge, Modal, StatusPill } from './ui';

/** A task as a drill-down list shows it. */
export interface DrillTask {
  id: number;
  code: string;
  title: string;
  work_group_code: string;
  status: Status;
  owner_role?: string;
  planned_start: string | null;
  planned_finish: string | null;
  duration_days?: number | null;
  check_summary?: CheckSummary | null;
  why?: string;
}

/** An activity as a drill-down list shows it. */
export interface DrillActivity {
  id: number;
  task: number;
  code: string;
  name: string;
  task_code: string;
  task_title: string;
  owner_name: string;
  owner_group: string;
  start_date: string;
  finish_date: string;
  duration_days: number | null;
  status?: { label: string; tone: string };
  issues: string[];
}

export type TaskDrill = { title: string; sub?: string; kind?: 'tasks'; rows: DrillTask[] };
export type ActivityDrill = { title: string; sub?: string; kind: 'activities'; rows: DrillActivity[] };
export type DrillSpec = TaskDrill | ActivityDrill;

const DrillContext = createContext<(spec: DrillSpec) => void>(() => undefined);
export const useDrill = () => useContext(DrillContext);

const HINT = { tasks: 'Click to see the tasks', activities: 'Click to see the activities' };

/** A count that opens the tasks (or activities) behind it. Zero, or nothing to show, stays plain text. */
export function Num({ value, drill }: { value: ReactNode; drill?: DrillSpec | null }) {
  const open = useDrill();
  if (!drill || !drill.rows.length) return <>{value}</>;
  return (
    <button type="button" className="dn" data-tip={HINT[drill.kind ?? 'tasks']} onClick={(e) => { e.stopPropagation(); open(drill); }}>
      {value}
    </button>
  );
}

function DrillModal({ spec, onClose }: { spec: DrillSpec; onClose: () => void }) {
  const navigate = useNavigate();
  const go = (id: number, tab?: string) => {
    onClose();
    navigate(`/tasks/${id}${tab ? `?tab=${tab}` : ''}`);
  };
  return (
    <Modal title={`${spec.title} (${spec.rows.length})`} onClose={onClose} wide>
      {spec.sub && <p className="intro">{spec.sub}</p>}
      <div className="tw">
        {spec.kind === 'activities' ? (
          <table>
            <thead><tr><th>Activity ID</th><th>Activity</th><th>Task</th><th>Owner</th><th>Dates</th><th className="r">Days</th><th>Status</th><th>Check</th></tr></thead>
            <tbody>
              {spec.rows.map((a) => (
                <tr key={a.id} className="click" onClick={() => go(a.task, 'activities')}>
                  <td className="id mono">{a.code}</td>
                  <td>{a.name}</td>
                  <td className="mono small">{a.task_code}<div className="t2 body-font">{a.task_title}</div></td>
                  <td className="nowrap">{a.owner_name || '—'} {a.owner_group && <span className="tag wg">{a.owner_group}</span>}</td>
                  <td className="mono small nowrap">{fmtShort(a.start_date)} → {fmtShort(a.finish_date)}</td>
                  <td className="num r">{a.duration_days ?? ''}</td>
                  <td>{a.status && <span className="pill" style={{ ['--c' as string]: a.status.tone }}>{a.status.label}</span>}</td>
                  <td>{a.issues.length ? <span className="chk bad" data-tip={a.issues.join('\n')}>{a.issues.length} to fix</span> : <span className="chk ok">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>Task ID</th><th>Task</th><th>Group</th><th>Owner role</th><th>Planned</th><th className="r">Days</th><th>Readiness status</th><th>Check</th></tr></thead>
            <tbody>
              {spec.rows.map((t) => (
                <tr key={t.id} className="click" onClick={() => go(t.id)}>
                  <td className="id mono">{t.code}</td>
                  <td className="wide-cell"><div className="t1">{t.title}</div>{t.why && <div className="t2">{t.why}</div>}</td>
                  <td><span className="tag wg">{t.work_group_code}</span></td>
                  <td>{t.owner_role || '—'}</td>
                  <td className="mono small nowrap">{fmtDate(t.planned_start) || '—'}{t.planned_finish ? ` → ${fmtDate(t.planned_finish)}` : ''}</td>
                  <td className="num r">{t.duration_days ?? ''}</td>
                  <td><StatusPill status={t.status} /></td>
                  <td><CheckBadge summary={t.check_summary} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="hint">Click a row to open the task.</p>
    </Modal>
  );
}

/** Holds the one drill-down window of the app. */
export function DrillProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<DrillSpec | null>(null);
  const open = useCallback((s: DrillSpec) => setSpec(s), []);
  const close = useCallback(() => setSpec(null), []);
  const value = useMemo(() => open, [open]);
  return (
    <DrillContext.Provider value={value}>
      {children}
      {spec && <DrillModal spec={spec} onClose={close} />}
    </DrillContext.Provider>
  );
}

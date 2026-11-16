import { Link, useNavigate } from 'react-router-dom';

import { usePaged } from '../api/queries';
import type { ContributionLink, PartnerLink, TaskRef } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../components/WorkGroupScope';
import { Empty, ErrorText, Pager, Panel, usePaging } from '../components/ui';
import { useRefs } from '../lib/useRefs';

function Their({ info, code }: { info: TaskRef | null; code: string }) {
  if (info) return <Link to={`/tasks/${info.id}`}><span className="mono nowrap">{info.code}</span><div className="t2">{info.title}</div></Link>;
  return code ? <span className="mono nowrap">{code}</span> : <span className="t2">—</span>;
}

function Status({ issues, agreed, linked }: { issues: string[]; agreed: boolean; linked: boolean }) {
  return (
    <>
      {issues.length ? <span className="chk bad" data-tip={issues.join('\n')}>{issues.length} to fix</span> : <span className="chk ok">OK</span>}{' '}
      {agreed ? <span className="chk ok">Agreed both sides</span> : linked ? <span className="chk warn">Waiting for their side</span> : null}
    </>
  );
}

const dash = (v: string | undefined | null) => v || <span className="t2">—</span>;

export default function LinksPage() {
  const { wg } = useScope();
  const refs = useRefs();
  const navigate = useNavigate();
  const { canEditGroup } = useAuth();
  const aPaging = usePaging();
  const bPaging = usePaging();
  // involves = the selected group on either side: its own rows and the ones other groups recorded with it.
  const a = usePaged<PartnerLink>('partners', { involves: wg, page: aPaging.page, page_size: aPaging.size });
  const b = usePaged<ContributionLink>('contributions', { involves: wg, page: bPaging.page, page_size: bPaging.size });
  const edit = (task: TaskRef) =>
    canEditGroup(task.work_group_code, task.status) ? (
      (label: string) => <button type="button" className="btn sm" onClick={() => navigate(`/tasks/${task.id}/edit?section=1`)}>{label}</button>
    ) : null;

  return (
    <div className="stack">
      <p className="intro">
        Partners: what each task needs from its partner groups. Contributions: what Enable and Support tasks deliver to other
        groups. Both fill themselves from the register; when both groups record each other&apos;s task number, the link is agreed.
      </p>
      <Panel title="Partners · what we need from them" tip="One row per partner group named on a task (up to five per task). Fill in what we need, when, and their task number agreed in the meeting: all are required.">
        <ErrorText error={a.error} />
        <div className="tw"><table>
          <thead><tr><th>Our task</th><th>Partner group</th><th>Role</th><th>What we need</th><th>When needed</th><th>Their task</th><th>Check</th><th /></tr></thead>
          <tbody>
            {a.data?.results.map((p) => (
              <tr key={p.id}>
                <td className="id"><Link to={`/tasks/${p.task}`}>{p.task_ref.code}</Link><div className="t2">{p.task_ref.title}</div></td>
                <td><span className="tag wg">{p.work_group_code}</span></td>
                <td>{dash(refs.value(p.role))}</td>
                <td>{dash(p.need)}</td>
                <td className="nowrap">{dash(refs.value(p.needed_when))}</td>
                <td className="small"><Their info={p.their_task_info} code={p.their_task_ref} /></td>
                <td><Status issues={p.issues} agreed={p.agreed} linked={!!p.their_task_info} /></td>
                <td className="r">{edit(p.task_ref)?.(p.issues.length ? 'Fill in' : 'Edit')}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {a.data && !a.data.count && <Empty>No partner groups named on these tasks.</Empty>}
        {a.data && <Pager count={a.data.count} page={aPaging.page} size={aPaging.size} onPage={aPaging.setPage} onSize={aPaging.setSize} />}
      </Panel>
      <Panel title="Contributions · what we deliver to other groups" tip="Up to five per task whose owner role is Enable or Support. Fill in the group, what we deliver, when they need it and their task number: all are required.">
        <ErrorText error={b.error} />
        <div className="tw"><table>
          <thead><tr><th>Our task</th><th>Owner role</th><th>Group we enable / support</th><th>What we deliver</th><th>When they need it</th><th>Their task</th><th>Check</th><th /></tr></thead>
          <tbody>
            {b.data?.results.map((c) => (
              <tr key={c.id}>
                <td className="id"><Link to={`/tasks/${c.task}`}>{c.task_ref.code}</Link> <span className="cc">#{c.slot}</span><div className="t2">{c.task_ref.title}</div></td>
                <td>{dash(c.owner_role)}</td>
                <td>{c.to_group_code ? <span className="tag wg">{c.to_group_code}</span> : dash('')}</td>
                <td>{dash(c.benefit)}</td>
                <td className="nowrap">{dash(refs.value(c.needed_when))}</td>
                <td className="small"><Their info={c.their_task_info} code={c.their_task_ref} /></td>
                <td>
                  {c.orphan ? <span className="chk bad" title="The owner role changed to Direct. Save the task to remove this row.">No task any more</span>
                    : <Status issues={c.issues} agreed={c.agreed} linked={!!c.their_task_info} />}
                </td>
                <td className="r">{edit(c.task_ref)?.(c.issues.length ? 'Fill in' : 'Edit')}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {b.data && !b.data.count && <Empty>No contribution rows yet. Enable and Support tasks record theirs in the task form.</Empty>}
        {b.data && <Pager count={b.data.count} page={bPaging.page} size={bPaging.size} onPage={bPaging.setPage} onSize={bPaging.setSize} />}
      </Panel>
    </div>
  );
}

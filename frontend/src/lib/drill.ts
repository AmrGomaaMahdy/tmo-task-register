import type { Summary, SummaryTask } from '../api/types';
import type { TaskDrill } from '../components/Drill';

/**
 * Turns the summary's id sets into drill-down lists: drillOf(summary)('not_ok', 'Not OK') gives the tasks
 * behind that count. `why` adds a line under each task (by default its first problem, for check counts).
 */
export function drillOf(s: Summary) {
  const byId = new Map(s.drill.rows.map((r) => [r.id, r]));
  return (key: string, title: string, sub?: string, why?: (t: SummaryTask) => string): TaskDrill => ({
    title,
    sub,
    rows: (s.drill.sets[key] ?? [])
      .map((id) => byId.get(id))
      .filter((r): r is SummaryTask => !!r)
      .map((r) => ({ ...r, why: why ? why(r) : undefined })),
  });
}
export const problemWhy = (t: SummaryTask) => t.problem;

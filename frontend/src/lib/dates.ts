import { useAuth } from '../auth/AuthContext';
import { fmtDate } from './format';

/** The same date rules the API applies on save, so the forms can say what is wrong before saving. */
export interface DateRange { min: string; max: string }

export const DEFAULT_RANGE: DateRange = { min: '2024-01-01', max: '2035-12-31' };

export function useDateRange(): DateRange {
  return useAuth().me?.date_range ?? DEFAULT_RANGE;
}

const outside = (d: string, r: DateRange) => !!d && (d < r.min || d > r.max);
const rangeText = (r: DateRange) => `between ${fmtDate(r.min)} and ${fmtDate(r.max)}`;

/** Planned start and finish of a task; `acts` are its activities (they must stay inside the dates). */
export function taskDateErrors(start: string, finish: string, r: DateRange, acts: { start_date: string; finish_date: string }[] = []) {
  const out: { planned_start?: string; planned_finish?: string } = {};
  if (outside(start, r)) out.planned_start = `The planned start must be ${rangeText(r)}.`;
  if (outside(finish, r)) out.planned_finish = `The planned finish must be ${rangeText(r)}.`;
  if (start && finish && finish < start && !out.planned_finish) out.planned_finish = 'The planned finish must be on or after the planned start.';
  if (acts.length) {
    const first = acts.reduce((m, a) => (a.start_date < m ? a.start_date : m), acts[0].start_date);
    const last = acts.reduce((m, a) => (a.finish_date > m ? a.finish_date : m), acts[0].finish_date);
    if (!start) out.planned_start ??= 'This task has activities, so it needs a planned start.';
    else if (start > first) out.planned_start ??= `Activities start on ${fmtDate(first)}: the planned start must be on or before it.`;
    if (!finish) out.planned_finish ??= 'This task has activities, so it needs a planned finish.';
    else if (finish < last) out.planned_finish ??= `Activities finish on ${fmtDate(last)}: the planned finish must be on or after it.`;
  }
  return out;
}

/** An activity's dates: inside its task's planned dates, and after its predecessors finish. */
export function activityDateErrors(
  start: string,
  finish: string,
  task: { planned_start: string | null; planned_finish: string | null },
  r: DateRange,
  preds: { code: string; finish_date: string }[] = [],
) {
  const out: { start?: string; finish?: string; task?: string } = {};
  if (!task.planned_start || !task.planned_finish) {
    out.task = "Set the task's planned start and finish first: activities must fit inside them.";
    return out;
  }
  if (outside(start, r)) out.start = `The start must be ${rangeText(r)}.`;
  else if (start && start < task.planned_start) out.start = `The start must be on or after the task's planned start (${fmtDate(task.planned_start)}).`;
  if (outside(finish, r)) out.finish = `The finish must be ${rangeText(r)}.`;
  else if (finish && finish > task.planned_finish) out.finish = `The finish must be on or before the task's planned finish (${fmtDate(task.planned_finish)}).`;
  if (start && finish && finish < start) out.finish ??= 'The finish must be on or after the start.';
  const blocking = preds.find((p) => start && start <= p.finish_date);
  if (blocking && !out.start) out.start = `The start must be after predecessor ${blocking.code} finishes (${fmtDate(blocking.finish_date)}).`;
  return out;
}

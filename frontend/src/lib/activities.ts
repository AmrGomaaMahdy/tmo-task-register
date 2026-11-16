import type { Activity } from '../api/types';
import type { DrillActivity } from '../components/Drill';
import { todayIso } from './format';

/**
 * Where an activity stands by its planned dates. The register plans work and does not record execution,
 * so the status is read from the calendar: upcoming, under way, or past its finish date.
 */
export type ActivityState = 'upcoming' | 'running' | 'past';
export const ACTIVITY_STATES: { key: ActivityState; label: string; tone: string; tip: string }[] = [
  { key: 'past', label: 'Past finish date', tone: 'var(--ok)', tip: 'The planned finish date has passed.' },
  { key: 'running', label: 'Under way', tone: 'var(--s-ready)', tip: 'Today is between the planned start and finish.' },
  { key: 'upcoming', label: 'Upcoming', tone: 'var(--ink3)', tip: 'The planned start is still ahead.' },
];

export function activityState(a: Pick<Activity, 'start_date' | 'finish_date'>, today = todayIso()): ActivityState {
  if (a.finish_date < today) return 'past';
  if (a.start_date <= today) return 'running';
  return 'upcoming';
}

export function toDrillActivity(a: Activity): DrillActivity {
  const st = ACTIVITY_STATES.find((s) => s.key === activityState(a)) ?? ACTIVITY_STATES[2];
  return {
    id: a.id,
    task: a.task,
    code: a.code,
    name: a.name,
    task_code: a.task_code,
    task_title: a.task_title,
    owner_name: a.owner_name,
    owner_group: a.owner_group,
    start_date: a.start_date,
    finish_date: a.finish_date,
    duration_days: a.duration_days,
    status: { label: st.label, tone: st.tone },
    issues: a.issues,
  };
}

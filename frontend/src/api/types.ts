export type Status = 'draft' | 'needs_completion' | 'ready' | 'in_master_plan';

export type ListKey = 'workstream' | 'sub_objective' | 'owner_role' | 'partner_role' | 'needed';

/** A person of a work group; activity owners are members of the task's own group. */
export interface GroupMember {
  id: number;
  name: string;
  work_group: number;
  work_group_code: string;
  is_active: boolean;
  activity_count: number;
}

export interface Paged<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Me {
  id: number;
  username: string;
  full_name: string;
  email: string;
  roles: string[];
  /** Work groups whose register the user maintains (from their "<CODE> Team" roles). */
  work_groups: { id: number; code: string; name: string }[];
  permissions: {
    manage_master_data: boolean;
    admin: boolean;
    tmo: boolean;
    create_tasks: boolean;
    /** Reads every register (Administrator, TMO, Viewer). Teams see their own register and the shared part only. */
    view_all: boolean;
    master_plan: boolean;
  };
}

export interface WorkGroup {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  task_count: number | null;
}

export interface Direction {
  id: number;
  code: string;
  work_group: number;
  work_group_code: string;
  title: string;
  meaning: string;
  task_count: number | null;
}

export interface Lookup {
  id: number;
  list_key: ListKey;
  value: string;
  definition: string;
  sort_order: number;
  semantic: string;
  is_core: boolean;
  usage: number;
}

export interface CheckIssue {
  field: string;
  label: string;
  message: string;
  level: 'error' | 'warning';
}

export interface CheckSummary {
  errors: number;
  warnings: number;
  ok: boolean;
}

type Id = number | null;

export interface TaskRef {
  id: number;
  code: string;
  title: string;
  status: Status;
  work_group_code: string;
}

/** A partner row: a partner group, its role, and what we need from it, when, and their task number. */
export interface PartnerRow {
  id?: number;
  slot?: number;
  work_group: number;
  work_group_code?: string;
  role: Id;
  need: string;
  needed_when: Id;
  their_task_ref: string;
  their_task_info?: TaskRef | null;
  agreed?: boolean;
  issues?: string[];
}

/** A contribution row: what an Enable / Support task delivers to another group (up to five per task). */
export interface ContributionRow {
  id?: number;
  slot?: number;
  to_group: Id;
  to_group_code?: string;
  benefit: string;
  needed_when: Id;
  their_task_ref: string;
  their_task_info?: TaskRef | null;
  agreed?: boolean;
  issues?: string[];
}

/** Partner row as listed on the Links page. */
export interface PartnerLink extends Required<Omit<PartnerRow, 'their_task_info'>> {
  task: number;
  task_ref: TaskRef;
  their_task_info: TaskRef | null;
}

/** Contribution row as listed on the Links page. */
export interface ContributionLink extends Required<Omit<ContributionRow, 'their_task_info'>> {
  task: number;
  task_ref: TaskRef;
  owner_role: string;
  orphan: boolean;
  their_task_info: TaskRef | null;
}

export interface TaskListItem {
  id: number;
  code: string;
  title: string;
  work_group: number;
  work_group_code: string;
  status: Status;
  direction: Id;
  workstream: Id;
  sub_objective: Id;
  owner_role: Id;
  planned_start: string | null;
  planned_finish: string | null;
  duration_days: number | null;
  partner_codes: string[];
  activity_count: number;
  check_summary: CheckSummary;
}

/** The columns of sheet 2 (Task Register) that a group fills in. */
export interface TaskFields {
  work_group: number;
  title: string;
  direction: Id;
  workstream: Id;
  sub_objective: Id;
  owner_role: Id;
  planned_start: string | null;
  planned_finish: string | null;
  status: Status;
  partners: PartnerRow[];
  contributions: ContributionRow[];
}

export interface Task extends TaskFields {
  id: number;
  code: string;
  work_group_code: string;
  duration_days: number | null;
  activity_count: number;
  checks: CheckIssue[];
  check_summary: CheckSummary;
  access: { can_edit: boolean; can_delete: boolean; transitions: Status[] };
  created_at: string;
  updated_at: string;
  updated_by_name: string;
}

export interface Activity {
  id: number;
  task: number;
  code: string;
  order: number;
  name: string;
  owner: Id;
  owner_name: string;
  owner_group: string;
  task_code: string;
  task_title: string;
  task_status: Status;
  work_group: number;
  work_group_code: string;
  start_date: string;
  finish_date: string;
  duration_days: number | null;
  predecessors: number[];
  issues: string[];
}

export interface Summary {
  total: number;
  by_status: Partial<Record<Status, number>>;
  with_sub_objective: number;
  ready_ok: number;
  ready_not_ok: number;
  needs_completion: number;
  readiness_not_set: number;
  not_ok: number;
  without_dates: number;
  by_owner_role: { id: number; value: string; count: number }[];
  contributions: number;
  contributions_not_complete: number;
  shared_with_partners: number;
  partner_rows: number;
  partner_rows_not_complete: number;
  with_activities: number;
  activities: number;
  activities_not_ok: number;
  by_direction: { id: number; code: string; title: string; count: number }[];
  by_workstream: { id: number; value: string; definition: string; count: number }[];
  sub_objectives: { id: number; value: string; count: number }[];
  problems_by_field: { label: string; errors: number; warnings: number }[];
  coming_up: { task_id: number; code: string; title: string; status: Status; what: string; date: string }[];
  /** Per other work group: partner rows naming it (what we need) and contributions to it (what we deliver). */
  links_by_group: { id: number; code: string; name: string; need: number; deliver: number }[];
  /** The tasks behind each count: "sets" maps a count (e.g. "not_ok", "direction:3") to task ids. */
  drill: { rows: SummaryTask[]; sets: Record<string, number[]> };
}

export interface SummaryTask {
  id: number;
  code: string;
  title: string;
  work_group_code: string;
  status: Status;
  owner_role: string;
  planned_start: string | null;
  planned_finish: string | null;
  duration_days: number | null;
  check_summary: CheckSummary;
  problem: string;
  partner_codes: string[];
  activity_count: number;
}

export interface MasterPlanRow {
  id: number;
  code: string;
  title: string;
  status: Status;
  work_group: number;
  work_group_code: string;
  direction: Id;
  direction_code: string | null;
  direction_title: string;
  workstream: Id;
  workstream_value: string;
  owner_role: string;
  partner_codes: string[];
  planned_start: string | null;
  planned_finish: string | null;
  duration_days: number | null;
  check_summary: CheckSummary;
  can_include: boolean;
  can_release: boolean;
  activities: {
    id: number;
    code: string;
    name: string;
    owner: Id;
    owner_name: string;
    start_date: string;
    finish_date: string;
    duration_days: number | null;
    predecessors: string[];
  }[];
  waits_for: string[];
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: string;
  entity_label: string;
  summary: string;
  created_at: string;
}

export interface BackupSummary {
  restored: boolean;
  app_version: string | null;
  schema_version: number | null;
  created_at: string | null;
  created_by: string | null;
  counts: Record<string, number>;
  current_counts: Record<string, number>;
  notes: string[];
  restore_point?: number;
}

/** A full backup kept automatically before every restore. */
export interface RestorePoint {
  id: number;
  created_at: string;
  created_by: string;
  reason: string;
  counts: Record<string, number>;
}

/** Code and title of a task, to pick "their task" when recording a link. */
export interface TaskDirectoryEntry {
  id: number;
  code: string;
  title: string;
  work_group: number;
  work_group_code: string;
}

/** Another work group's task as a team user sees it: identity, dates and the links with their own group. */
export interface SharedTask {
  id: number;
  code: string;
  title: string;
  status: Status;
  work_group: number;
  work_group_code: string;
  planned_start: string | null;
  planned_finish: string | null;
  limited: true;
  shared: { partners: PartnerLink[]; contributions: ContributionLink[] };
}

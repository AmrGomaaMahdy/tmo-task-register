export type Status = 'draft' | 'needs_completion' | 'ready' | 'leader_approved' | 'in_master_plan';

export type ListKey = 'workstream' | 'sub_objective' | 'owner_role' | 'partner_role' | 'needed';

/** A person of a work group; activity owners are members of the task's own group. */
export interface GroupMember {
  id: number;
  name: string;
  work_group: number;
  work_group_code: string;
  /** Optional contact details. */
  job_title?: string;
  email?: string;
  phone?: string;
  is_active: boolean;
  activity_count: number;
  /** Leader, Focal Point ('coordinator') or Member: sets the person's role for this group when they have an account. */
  member_type?: MemberType;
  member_type_label?: string;
  /** The sign-in account of this person (a user id), and its user name. */
  user?: number | null;
  username?: string;
}

export type MemberType = 'leader' | 'coordinator' | 'member';

/** What a team role allows in its group. */
export type GroupRole = 'leader' | 'coordinator' | 'member' | 'delegate';

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
  /** Work groups whose register the user maintains (from their "<CODE> Team" roles, and the groups they lead). */
  work_groups: { id: number; code: string; name: string; leader?: boolean }[];
  /** Every group the user belongs to (Leader, Focal Point or Member): they read these registers. */
  view_groups?: { id: number; code: string; name: string; role: GroupRole }[];
  /** Must the password be changed now (expired, or set by an administrator)? And the length rule (0: none). */
  password?: { required: boolean; reason: 'reset' | 'expired' | ''; expires_in_days: number | null; min_length: number };
  permissions: {
    manage_master_data: boolean;
    admin: boolean;
    tmo: boolean;
    create_tasks: boolean;
    /** Reads every register (Administrator, TMO, Viewer). Teams see their own register and the shared part only. */
    view_all: boolean;
    master_plan: boolean;
    /** The governance desk: work group leaders, the TMO, administrators and viewers. */
    governance: boolean;
    /** Decides for at least one work group: leads it, or stands in for its leader today (delegate). */
    leader: boolean;
    /** Leads a work group themselves, so may name a delegate. */
    lead_own?: boolean;
    /** The Audit trail page: Administrators, the TMO and the committee. */
    audit?: boolean;
    /** The System issues page: Administrators. */
    system?: boolean;
  };
  /** The first and last date the register accepts (YYYY-MM-DD). */
  date_range?: { min: string; max: string };
}

/** A work group leader's decision on a Direct task or on a link with another group. */
export type Decision = 'pending' | 'approved' | 'clarification' | 'timeline' | 'rejected';

/** The leader's review of a partner row or a contribution (by the group it points to). */
export interface Review {
  review?: Decision;
  review_note?: string;
  review_date?: string | null;
  reviewed_by_name?: string;
  reviewed_at?: string | null;
  can_review?: boolean;
}

export interface GovernanceDirect {
  id: number;
  code: string;
  title: string;
  work_group_code: string;
  direction_code: string;
  /** Direct, Enable or Support: every task goes to the leader once Ready to include. */
  owner_role?: string;
  check_summary?: CheckSummary;
  status: Status;
  planned_start: string | null;
  planned_finish: string | null;
  approval: Decision;
  approval_note: string;
  approval_by_name: string;
  approval_at: string | null;
  can_decide: boolean;
  can_remove: boolean;
}

export interface GovernanceLink {
  kind: 'partner' | 'contribution';
  id: number;
  task: number;
  task_code: string;
  task_title: string;
  from_group: string;
  group: string;
  role: string;
  /** The other group's task type: Direct, Enable or Support. */
  owner_role?: string;
  what: string;
  needed_when: string;
  their_task_ref: string;
  planned_start: string | null;
  planned_finish: string | null;
  review: Decision;
  review_note: string;
  review_date: string | null;
  reviewed_by_name: string;
  reviewed_at: string | null;
  can_review: boolean;
}

export interface Governance {
  groups: { id: number; code: string; name: string; leader: string }[];
  direct: GovernanceDirect[];
  links: GovernanceLink[];
  pending: { direct: number; links: number };
}

export interface WorkGroup {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  task_count: number | null;
  /** The work group leader (a user id), and their name. */
  leader?: number | null;
  leader_name?: string;
  /** The group's mission and its weight in the programme (per cent). */
  mission?: string;
  weight?: number;
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
  /** Sub-objectives belong to one work group. */
  work_group?: number | null;
  work_group_code?: string;
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
export interface PartnerRow extends Review {
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

/** A contribution row: what an Enable / Support task delivers to another group (up to twenty per task). */
export interface ContributionRow extends Review {
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
  description?: string;
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
  /** Direct tasks: the leader's approval; null for Enable and Support tasks. */
  approval?: Decision | null;
}

/** The columns of sheet 2 (Task Register) that a group fills in. */
export interface TaskFields {
  work_group: number;
  title: string;
  /** Optional: scope and expected result, in a few sentences. */
  description: string;
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
  access: { can_edit: boolean; can_delete: boolean; transitions: Status[]; can_approve?: boolean };
  /** The work group leader's decision, made when the task is Ready to include. */
  approval: Decision;
  approval_note: string;
  approval_by_name: string;
  approval_at: string | null;
  approval_needed: boolean;
  /** The TMO's latest decision: its reason when it sent the task back to the group. */
  tmo_note: string;
  tmo_by_name: string;
  tmo_at: string | null;
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
  /** The leader's decision (Leader Approved tasks wait for the TMO). */
  approval?: Decision | null;
  approval_by_name?: string;
  approval_at?: string | null;
  /** The TMO may include it in the Master Plan, or send it back to the group (with a reason). */
  can_include: boolean;
  can_return?: boolean;
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
  actor_name?: string;
  action: string;
  action_label?: string;
  entity: string;
  entity_id: string;
  entity_label: string;
  work_group?: string;
  summary: string;
  /** {field: [before, after]} */
  changes?: Record<string, [string | null, string | null]>;
  ip?: string;
  user_agent?: string;
  method?: string;
  path?: string;
  created_at: string;
}

export interface AuditFacets {
  actors: string[];
  actions: { value: string; label: string }[];
  entities: string[];
  work_groups: string[];
}

export interface SystemEvent {
  id: number;
  level: 'error' | 'warning';
  level_label: string;
  source: 'server' | 'browser' | 'security';
  source_label: string;
  kind: string;
  message: string;
  detail: string;
  path: string;
  method: string;
  status_code: number | null;
  username: string;
  ip: string;
  user_agent: string;
  count: number;
  first_seen: string;
  last_seen: string;
  resolved: boolean;
  resolved_by_name: string;
  resolved_at: string | null;
  resolution_note: string;
}

export interface SystemSummary {
  open_errors: number;
  open_warnings: number;
  errors_24h: number;
  failed_signins_24h: number;
  browser_open: number;
  retention_days: number;
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
  description?: string;
  status: Status;
  work_group: number;
  work_group_code: string;
  planned_start: string | null;
  planned_finish: string | null;
  limited: true;
  shared: { partners: PartnerLink[]; contributions: ContributionLink[] };
}

/** The TMO Action Center (1.27): Leader Approved tasks and the TMO's recent decisions. */
export interface TmoDesk {
  waiting: (MasterPlanRow & { waiting_days: number | null })[];
  decided: { id: number; code: string; title: string; work_group_code: string; outcome: 'included' | 'returned'; note: string; by: string; at: string; status: Status }[];
  decided_days: number;
}

/** The management report (1.27): one summary of the registers for the board. */
export interface BoardSummary {
  generated_at: string;
  prepared_by: string;
  scope: { code: string; name: string } | null;
  totals: { tasks: number; groups: number; by_status: Record<Status, number>; ok: number; not_ok: number; without_dates: number };
  plan: { included: number; waiting_tmo: number; progress: number; running: number; first_start: string | null; last_finish: string | null; activities: number };
  links: { total: number; approved: number; pending: number; rejected: number };
  groups: { code: string; name: string; leader: string; total: number; by_status: Record<Status, number>; not_ok: number; ready_pct: number; progress: number }[];
  attention: { id: number; code: string; title: string; group: string; why: 'waiting_tmo' | 'waiting_leader' | 'plan_not_ok' | 'past_finish'; days: number | null }[];
  attention_total: number;
  upcoming: { date: string; what: 'task' | 'activity'; code: string; title: string }[];
  upcoming_total: number;
}

/** The management board's dependencies report (1.28): links between work groups and recent decisions. */
export interface DependenciesReport {
  generated_at: string;
  prepared_by: string;
  scope: { code: string; name: string } | null;
  groups: { code: string; name: string }[];
  matrix: { from: string; to: string; total: number; approved: number; pending: number; rejected: number }[];
  totals: { links: number; approved: number; pending: number; rejected: number; groups: number };
  open_links: { kind: 'needs' | 'delivers'; task: string; title: string; from: string; to: string; what: string; review: string; note: string; days: number }[];
  open_total: number;
  decisions: { at: string; who: string; role: 'leader' | 'tmo'; subject: 'task' | 'link'; code: string; title: string; group: string; decision: 'approved' | 'rejected' | 'included' | 'returned'; note: string }[];
  decisions_total: number;
  decided_days: number;
}

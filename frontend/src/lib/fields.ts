import type { ListKey, Status } from '../api/types';

/** Field definitions follow the Simplified Task Register (sheet 2 and sheet 3). */
export type Requirement = 'REQUIRED' | 'BEFORE' | 'WHEN' | 'OPTIONAL' | 'AUTOMATIC';

export const REQUIREMENT_LABEL: Record<Requirement, string> = {
  REQUIRED: 'Required',
  BEFORE: 'Before ready',
  WHEN: 'When needed',
  OPTIONAL: 'Optional',
  AUTOMATIC: 'Automatic',
};

export const REQUIREMENT_HINT: Record<Requirement, string> = {
  REQUIRED: 'Must be filled in for every task.',
  BEFORE: 'Must be filled in before the task can be Ready to include.',
  WHEN: 'Required only in a specific case; the hint says when.',
  OPTIONAL: 'Fill in when it applies.',
  AUTOMATIC: 'Calculated by the application.',
};

export interface FieldDef {
  label: string;
  hint: string;
  req: Requirement;
  list?: ListKey;
}

export const FIELDS: Record<string, FieldDef> = {
  work_group: { label: 'Work group', req: 'REQUIRED', hint: 'The work group that owns and executes the task. Its code starts the task ID.' },
  title: {
    label: 'Task',
    req: 'REQUIRED',
    hint: 'Action + intent, e.g. "Develop and approve the offshore strategy for Engineering" (not just "Offshore"). One row = one task with a clear output.',
  },
  description: {
    label: 'Description',
    req: 'OPTIONAL',
    hint: 'A few sentences on what the task covers: its scope, its expected result, and anything a partner group or the TMO should know. Up to 3,000 characters.',
  },
  direction: { label: 'Direction', req: 'REQUIRED', hint: 'Pick the direction the task serves (ID and title).' },
  workstream: { label: 'Main workstream', req: 'REQUIRED', list: 'workstream', hint: 'Pick one of the six workstreams.' },
  sub_objective: {
    label: 'Sub-objective',
    req: 'OPTIONAL',
    list: 'sub_objective',
    hint: 'Pick it only if the task delivers one of your sub-objectives; otherwise leave it empty.',
  },
  owner_role: {
    label: 'Owner role',
    req: 'REQUIRED',
    list: 'owner_role',
    hint: 'Direct = our own result. Enable or Support = the task helps another group: complete what it delivers to them (its contributions).',
  },
  planned_start: { label: 'Planned start', req: 'BEFORE', hint: "The group's proposal. The TMO confirms the final dates in the Master Plan." },
  planned_finish: { label: 'Planned finish', req: 'BEFORE', hint: "The group's proposal. The TMO confirms the final dates in the Master Plan." },
  status: {
    label: 'Readiness status',
    req: 'REQUIRED',
    hint: 'Ready to include = the data is mature enough for the Master Plan (not necessarily ready to start). Needs completion = something must be completed or resolved first.',
  },
};

/** Hints for the partner and contribution rows. */
export const MAX_ROWS = 20;

/** A work group leader's decisions, on a Direct task or on a link with another group. */
export const DECISION_LABEL: Record<'pending' | 'approved' | 'clarification' | 'timeline' | 'rejected', string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  clarification: 'Needs clarification',
  timeline: 'Change timeline',
  rejected: 'Rejected',
};
export const LINK_HINT = {
  partner: 'A group that works with us on this task. Then agree with them what we need, when, and their task number.',
  role: 'Enable or Support: the role the partner group plays in our task.',
  need: 'A clear output, e.g. "approved offshore staffing rules".',
  when: 'Before start / During execution of our task.',
  their: 'Their task number, agreed in the meeting, e.g. HR-T012.',
  group: 'The group whose work our task enables or supports.',
  deliver: 'The output or service they receive.',
  theirWhen: 'Before start / During execution of their task.',
};

/** The four steps of the template's Read Me. */
export const SECTIONS: { title: string; intro: string; fields: string[] }[] = [
  {
    title: 'Describe the task',
    intro: 'Which work group owns the task, what it is, and which direction, main workstream and sub-objective it serves.',
    fields: ['work_group', 'title', 'description', 'direction', 'workstream', 'sub_objective'],
  },
  {
    title: 'Who it involves',
    intro:
      "The owner role and the partner groups with their roles. Then meet each related group and agree the links: what we need from each partner and, for an Enable or Support task, its contributions to other groups. Record each other's task numbers. Add up to twenty of each.",
    fields: ['owner_role', 'partners', 'contribution'],
  },
  {
    title: 'Plan',
    intro: "The group's proposed planned start and finish; the duration is calculated. Add the activities of a big task from the task page once they are known.",
    fields: ['planned_start', 'planned_finish', 'activities'],
  },
  {
    title: 'Readiness',
    intro: 'Draft or Needs completion while the Focal Point prepares it; Ready to include submits it to the leader. The live check lists everything that is not OK yet.',
    fields: ['status'],
  },
];

export const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  needs_completion: 'Needs completion',
  ready: 'Ready to include',
  leader_approved: 'Leader Approved',
  in_master_plan: 'In Master Plan',
};

export const STATUS_HINT: Record<Status, string> = {
  draft: 'The Focal Point has started the task but has not submitted it yet. The Focal Point can still edit or delete it.',
  needs_completion: 'Something must be completed first, for example the dates or the links agreed with another group, or the leader or the TMO sent it back with a reason. The Focal Point can edit or delete it.',
  ready: 'Submitted by the Focal Point and waiting for the work group leader to approve it. It can no longer be edited; the Focal Point can withdraw it to Draft until the leader decides.',
  leader_approved: 'Approved by the work group leader and waiting for the TMO: include it in the Master Plan, or send it back to the group.',
  in_master_plan: 'The TMO has included the task. Only the TMO can send it back to the group.',
};

export const LIST_LABEL: Record<ListKey, string> = {
  workstream: 'Workstreams',
  sub_objective: 'Sub-objectives',
  owner_role: 'Owner roles',
  partner_role: 'Partner roles',
  needed: 'When needed',
};

export const LIST_HINT: Record<ListKey, string> = {
  workstream: 'The six program workstreams. Each task picks one main workstream.',
  sub_objective: "Sub-objectives a task can deliver, each belonging to one work group. A task offers only its own group's; linking is optional.",
  owner_role: 'Direct = the result is the owner group\'s own. Enable and Support = the task helps another group and needs its contributions. The checks rely on all three values.',
  partner_role: 'The role of a partner group working with us on a task: Enable or Support.',
  needed: 'Before start / During execution: when an output is needed. "Before start" is a core value.',
};

/** The form step a check issue belongs to, so the live check can jump to it. */
export function sectionOf(field: string): number {
  if (field.startsWith('partner') || field.startsWith('contribution')) return 1;
  return SECTIONS.findIndex((s) => s.fields.includes(field));
}

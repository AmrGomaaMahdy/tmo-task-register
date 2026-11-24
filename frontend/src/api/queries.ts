import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, qs } from './client';
import type {
  Activity,
  BoardSummary,
  DependenciesReport,
  TmoDesk,
  AuditEntry,
  AuditFacets,
  ContributionLink,
  Decision,
  Direction,
  Governance,
  GroupMember,
  Lookup,
  MasterPlanRow,
  Paged,
  PartnerLink,
  RestorePoint,
  SharedTask,
  Status,
  Summary,
  SystemEvent,
  SystemSummary,
  Task,
  TaskDirectoryEntry,
  TaskFields,
  TaskListItem,
  WorkGroup,
} from './types';

type Params = Record<string, string | number | null | undefined>;

export const keys = {
  workGroups: ['work-groups'] as const,
  directions: ['directions'] as const,
  lookups: ['lookups'] as const,
  tasks: (p: Params) => ['tasks', p] as const,
  task: (id: number) => ['task', id] as const,
  summary: (wg: number | null) => ['summary', wg] as const,
  masterPlan: (wg: number | null, all = false) => ['master-plan', wg, all] as const,
};

export const useWorkGroups = () =>
  useQuery({ queryKey: keys.workGroups, queryFn: () => api<WorkGroup[]>('/api/work-groups/'), staleTime: 60_000 });
export const useDirections = () =>
  useQuery({ queryKey: keys.directions, queryFn: () => api<Direction[]>('/api/directions/'), staleTime: 60_000 });
export const useLookups = () =>
  useQuery({ queryKey: keys.lookups, queryFn: () => api<Lookup[]>('/api/lookups/'), staleTime: 60_000 });

/** Members of one work group (the people who can own its activities), or every member you may see. */
export const useMembers = (workGroup?: number | null) =>
  useQuery({
    queryKey: ['members', workGroup ?? null],
    queryFn: () => api<GroupMember[]>(`/api/members/${qs({ work_group: workGroup ?? null })}`),
    staleTime: 60_000,
  });

export const useTasks = (params: Params) =>
  useQuery({
    queryKey: keys.tasks(params),
    queryFn: () => api<Paged<TaskListItem>>(`/api/tasks/${qs(params)}`),
    placeholderData: (prev) => prev,
  });

/** A task in full, or (for a team user looking at another group's linked task) its shared part. */
export const useTask = (id: number | null) =>
  useQuery({ queryKey: keys.task(id ?? 0), queryFn: () => api<Task | SharedTask>(`/api/tasks/${id}/`), enabled: !!id });

export const isShared = (t: Task | SharedTask | undefined): t is SharedTask => !!t && 'limited' in t && t.limited === true;

/** Code and title of tasks (any group), to choose "their task" for a link. */
export const useTaskDirectory = (workGroup: number | null) =>
  useQuery({
    queryKey: ['task-directory', workGroup],
    queryFn: () => api<TaskDirectoryEntry[]>(`/api/tasks/directory/${qs({ work_group: workGroup })}`),
    enabled: !!workGroup,
  });

export const useSummary = (wg: number | null) =>
  useQuery({ queryKey: keys.summary(wg), queryFn: () => api<Summary>(`/api/tasks/summary/${qs({ work_group: wg })}`) });

/** The Master Plan rows (Ready and included tasks); `all` adds every other stage, for the Gantt timeline. */
export const useMasterPlan = (wg: number | null, all = false, enabled = true) =>
  useQuery({
    queryKey: keys.masterPlan(wg, all),
    queryFn: () => api<MasterPlanRow[]>(`/api/tasks/master-plan/${qs({ work_group: wg, all: all ? 1 : null })}`),
    enabled,
    placeholderData: (prev) => prev,
  });

export const usePaged = <T,>(resource: string, params: Params) =>
  useQuery({
    queryKey: [resource, params],
    queryFn: () => api<Paged<T>>(`/api/${resource}/${qs(params)}`),
    placeholderData: (prev) => prev,
  });

export const useActivities = (task: number, enabled = true) =>
  useQuery({ queryKey: ['activities', { task }], queryFn: () => api<Activity[]>(`/api/activities/?task=${task}`), enabled: enabled && task > 0 });
/** Every activity of the registers you can see (optionally one work group). */
export const useAllActivities = (wg: number | null) =>
  useQuery({
    queryKey: ['activities', { wg }],
    queryFn: () => api<Activity[]>(`/api/activities/${qs({ task__work_group: wg })}`),
  });
export const useRestorePoints = (enabled: boolean) =>
  useQuery({ queryKey: ['restore-points'], queryFn: () => api<RestorePoint[]>('/api/backup/restore-points/'), enabled });
/** Partner and contribution rows pointing at this task from other tasks ("feeds into"). */
export const useNeededBy = (task: number) => usePaged<PartnerLink>('partners', { their_task: task, page_size: 50 });
export const useSupportedBy = (task: number) => usePaged<ContributionLink>('contributions', { their_task: task, page_size: 50 });
export const useAudit = (params: Params) => usePaged<AuditEntry>('audit', params);

/** Refresh everything that a change to tasks or links can affect. */
function useInvalidateRegister() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ['tasks', 'task', 'summary', 'master-plan', 'activities', 'partners', 'contributions', 'audit', 'task-directory', 'members', 'governance', 'timeline', 'audit-trail', 'notifications', 'tmo-desk', 'board-summary'].map(
        (k) => client.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

export function useSaveTask() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Partial<TaskFields> }) =>
      id ? api<Task>(`/api/tasks/${id}/`, { method: 'PATCH', body: data }) : api<Task>('/api/tasks/', { method: 'POST', body: data }),
    onSuccess: invalidate,
    meta: { toast: 'Task saved.' },
  });
}

/** The leader's desk: Direct tasks to approve and links other groups recorded with the group. */
export const useGovernance = (wg: number | null, enabled = true) =>
  useQuery({
    queryKey: ['governance', wg],
    queryFn: () => api<Governance>(`/api/tasks/governance/${qs({ work_group: wg })}`),
    enabled,
    placeholderData: (prev) => prev,
  });

/** The register as a timeline (same filters as the table). */
export const useTimeline = (params: Params, enabled = true) =>
  useQuery({
    queryKey: ['timeline', params],
    queryFn: () => api<MasterPlanRow[]>(`/api/tasks/timeline/${qs(params)}`),
    enabled,
    placeholderData: (prev) => prev,
  });

export interface DecisionBody {
  decision: Exclude<Decision, 'pending'>;
  note?: string;
  proposed_date?: string | null;
}

/** A leader decides: on a Direct task (kind "task") or on a partner row / contribution. */
export function useDecide() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({ kind, id, body }: { kind: 'task' | 'partner' | 'contribution'; id: number; body: DecisionBody }) =>
      api(kind === 'task' ? `/api/tasks/${id}/approval/` : `/api/${kind === 'partner' ? 'partners' : 'contributions'}/${id}/review/`, {
        method: 'POST',
        body,
      }),
    onSuccess: invalidate,
    meta: { toast: 'Decision recorded.' },
  });
}

/** A leader takes a link that names their group out of another group's task, with a reason. */
export const useLeaderCandidates = (enabled: boolean) =>
  useQuery({
    queryKey: ['leader-candidates'],
    queryFn: () => api<{ id: number; username: string; name: string; teams: string[] }[]>('/api/work-groups/leader-candidates/'),
    enabled,
    staleTime: 60_000,
  });

export function useTransition() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: Status; note?: string }) =>
      api<Task>(`/api/tasks/${id}/transition/`, { method: 'POST', body: { status, ...(note ? { note } : {}) } }),
    onSuccess: invalidate,
    meta: { toast: 'Readiness updated.' },
  });
}

/** Create, update or delete any resource under /api/<resource>/. */
export function useResource(resource: string, extraInvalidate: string[] = []) {
  const invalidateRegister = useInvalidateRegister();
  const client = useQueryClient();
  const done = async () => {
    await invalidateRegister();
    await Promise.all(extraInvalidate.map((k) => client.invalidateQueries({ queryKey: [k] })));
  };
  const create = useMutation({
    mutationFn: (body: unknown) => api(`/api/${resource}/`, { method: 'POST', body }),
    onSuccess: done,
    meta: { toast: 'Added.' },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: unknown }) => api(`/api/${resource}/${id}/`, { method: 'PATCH', body }),
    onSuccess: done,
    meta: { toast: 'Changes saved.' },
  });
  const remove = useMutation({
    // A reason, when given, is kept in the audit trail (for example why a task was deleted).
    mutationFn: (id: number | { id: number; reason?: string }) =>
      typeof id === 'number'
        ? api(`/api/${resource}/${id}/`, { method: 'DELETE' })
        : api(`/api/${resource}/${id.id}/`, { method: 'DELETE', body: id.reason ? { reason: id.reason } : undefined }),
    onSuccess: done,
    meta: { toast: 'Removed.' },
  });
  return { create, update, remove };
}

/** The audit trail with its filters, and the values the filters offer. */
export const useAuditTrail = (params: Params) =>
  useQuery({
    queryKey: ['audit-trail', params],
    queryFn: () => api<Paged<AuditEntry>>(`/api/audit/${qs(params)}`),
    placeholderData: (prev) => prev,
  });

export const useAuditFacets = (enabled = true) =>
  useQuery({ queryKey: ['audit-trail', 'facets'], queryFn: () => api<AuditFacets>('/api/audit/facets/'), enabled, staleTime: 60_000 });

/** Errors and warnings for administrators (System issues). */
export const useSystemEvents = (params: Params, enabled = true) =>
  useQuery({
    queryKey: ['system-events', params],
    queryFn: () => api<Paged<SystemEvent>>(`/api/system-events/${qs(params)}`),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useSystemSummary = (enabled = true) =>
  useQuery({
    queryKey: ['system-events', 'summary'],
    queryFn: () => api<SystemSummary>('/api/system-events/summary/'),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });

export function useSystemAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(`/api/system-events/${path}`, { method: 'POST', body: body ?? {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['system-events'] }),
    meta: { toast: 'Issue updated.' },
  });
}

/** One thing the signed-in person has to do now (GET /api/notifications/). */
export interface ActionItem {
  key: string;
  kind: 'returned_tmo' | 'returned_leader' | 'link_rejected' | 'complete' | 'decide' | 'review_link' | 'include';
  role: 'Focal Point' | 'Leader' | 'TMO';
  task: { id: number; code: string; title: string; status: string; work_group_code: string };
  at: string | null;
  by: string;
  note: string;
  url: string;
  link: { kind: 'partner' | 'contribution'; id: number; group_code: string } | null;
  new: boolean;
}

/** The action centre: refreshed every minute, when the window gets focus, and after every change. */
export const useNotifications = (enabled: boolean) =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ count: number; new: number; seen_at: string | null; items: ActionItem[] }>('/api/notifications/'),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

export function useMarkNotificationsSeen() {
  return useMutation({ mutationFn: () => api<void>('/api/notifications/seen/', { method: 'POST' }) });
}

export const useTmoDesk = (wg: number | null, enabled = true) =>
  useQuery({
    queryKey: ['tmo-desk', wg],
    queryFn: () => api<TmoDesk>(`/api/tmo-desk/${qs({ work_group: wg })}`),
    enabled,
    placeholderData: (prev) => prev,
  });

export const useBoardSummary = (wg: number | null) =>
  useQuery({
    queryKey: ['board-summary', wg],
    queryFn: () => api<BoardSummary>(`/api/reports/board-summary/${qs({ work_group: wg })}`),
    placeholderData: (prev) => prev,
  });

export const useDependenciesReport = (wg: number | null, enabled = true) =>
  useQuery({
    queryKey: ['board-summary', 'dependencies', wg],
    queryFn: () => api<DependenciesReport>(`/api/reports/dependencies/${qs({ work_group: wg })}`),
    enabled,
    placeholderData: (prev) => prev,
  });

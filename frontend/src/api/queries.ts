import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, qs } from './client';
import type {
  Activity,
  AuditEntry,
  ContributionLink,
  Direction,
  GroupMember,
  Lookup,
  MasterPlanRow,
  Paged,
  PartnerLink,
  RestorePoint,
  SharedTask,
  Status,
  Summary,
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
  masterPlan: (wg: number | null) => ['master-plan', wg] as const,
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

export const useMasterPlan = (wg: number | null) =>
  useQuery({
    queryKey: keys.masterPlan(wg),
    queryFn: () => api<MasterPlanRow[]>(`/api/tasks/master-plan/${qs({ work_group: wg })}`),
  });

export const usePaged = <T,>(resource: string, params: Params) =>
  useQuery({
    queryKey: [resource, params],
    queryFn: () => api<Paged<T>>(`/api/${resource}/${qs(params)}`),
    placeholderData: (prev) => prev,
  });

export const useActivities = (task: number) =>
  useQuery({ queryKey: ['activities', { task }], queryFn: () => api<Activity[]>(`/api/activities/?task=${task}`) });
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
      ['tasks', 'task', 'summary', 'master-plan', 'activities', 'partners', 'contributions', 'audit', 'task-directory', 'members'].map(
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
  });
}

export function useTransition() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: Status }) =>
      api<Task>(`/api/tasks/${id}/transition/`, { method: 'POST', body: { status } }),
    onSuccess: invalidate,
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
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: unknown }) => api(`/api/${resource}/${id}/`, { method: 'PATCH', body }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/${resource}/${id}/`, { method: 'DELETE' }),
    onSuccess: done,
  });
  return { create, update, remove };
}

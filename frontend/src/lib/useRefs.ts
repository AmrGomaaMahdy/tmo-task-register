import { useMemo } from 'react';

import { useDirections, useLookups, useWorkGroups } from '../api/queries';
import type { Direction, ListKey, Lookup, WorkGroup } from '../api/types';

/** Master data indexed for quick lookups of ids → labels. */
export function useRefs() {
  const lookups = useLookups();
  const directions = useDirections();
  const groups = useWorkGroups();
  return useMemo(() => {
    const byId = new Map<number, Lookup>((lookups.data ?? []).map((l) => [l.id, l]));
    const dirById = new Map<number, Direction>((directions.data ?? []).map((d) => [d.id, d]));
    const wgById = new Map<number, WorkGroup>((groups.data ?? []).map((g) => [g.id, g]));
    return {
      ready: !!(lookups.data && directions.data && groups.data),
      lookups: lookups.data ?? [],
      directions: directions.data ?? [],
      groups: groups.data ?? [],
      list: (key: ListKey) => (lookups.data ?? []).filter((l) => l.list_key === key),
      value: (id: number | null | undefined) => (id ? byId.get(id)?.value ?? '' : ''),
      lookup: (id: number | null | undefined) => (id ? byId.get(id) : undefined),
      direction: (id: number | null | undefined) => (id ? dirById.get(id) : undefined),
      group: (id: number | null | undefined) => (id ? wgById.get(id) : undefined),
    };
  }, [lookups.data, directions.data, groups.data]);
}
export type Refs = ReturnType<typeof useRefs>;

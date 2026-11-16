import { createContext, useContext, useState, type ReactNode } from 'react';

/** The work group selected in the side menu (null = all work groups). */
const ScopeContext = createContext<{ wg: number | null; setWg: (id: number | null) => void } | null>(null);

const KEY = 'task-register.work-group';

function readStored(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function WorkGroupScopeProvider({ children }: { children: ReactNode }) {
  const [wg, setWgState] = useState<number | null>(readStored);
  const setWg = (id: number | null) => {
    setWgState(id);
    try {
      if (id) localStorage.setItem(KEY, String(id));
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: keep the choice in memory only */
    }
  };
  return <ScopeContext.Provider value={{ wg, setWg }}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const v = useContext(ScopeContext);
  if (!v) throw new Error('useScope must be used inside WorkGroupScopeProvider');
  return v;
}

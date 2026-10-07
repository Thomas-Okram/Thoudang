import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMeta, setCurrentOfficer, type Meta, type Officer, type Permission } from './api';

const STORAGE_KEY = 'thoudang.officer';

interface OfficerState {
  officer: Officer | null;
  officers: Officer[];
  meta: Meta | undefined;
  choose: (id: string | null) => void;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<OfficerState | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function OfficerProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [id, setId] = useState<string | null>(() => {
    const stored = readStored();
    setCurrentOfficer(stored);
    return stored;
  });
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: Infinity });
  const officers = meta?.officers ?? [];
  const officer = officers.find((o) => o.id === id) ?? null;

  const choose = useCallback(
    (next: string | null) => {
      setCurrentOfficer(next);
      setId(next);
      try {
        if (next) localStorage.setItem(STORAGE_KEY, next);
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        // storage unavailable — choice lasts for this tab only
      }
      void qc.invalidateQueries({ queryKey: ['case'] });
    },
    [qc],
  );

  const value = useMemo<OfficerState>(
    () => ({
      officer,
      officers,
      meta,
      choose,
      can: (p) => Boolean(officer?.permissions.includes(p)),
    }),
    [officer, officers, meta, choose],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOfficer(): OfficerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOfficer must be used inside <OfficerProvider>');
  return v;
}

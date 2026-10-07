import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMe,
  fetchMeta,
  setCurrentOfficer,
  setUnauthorizedHandler,
  signIn as apiSignIn,
  signOut as apiSignOut,
  type AuthMe,
  type AuthMode,
  type Meta,
  type Officer,
  type Permission,
} from './api';

const STORAGE_KEY = 'thoudang.officer';
const ME_KEY = ['auth', 'me'] as const;

interface OfficerState {
  /** session = PIN sign-in (cookie); header = legacy "acting as" dropdown (AUTH_MODE=header). */
  mode: AuthMode;
  /** false until we know who (if anyone) is signed in. */
  ready: boolean;
  officer: Officer | null;
  officers: Officer[];
  meta: Meta | undefined;
  /** Header mode only: pick the acting officer. */
  choose: (id: string | null) => void;
  signIn: (officerId: string, pin: string) => Promise<Officer>;
  signOut: () => Promise<void>;
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
  const {
    data: me,
    isPending: mePending,
    isError: meError,
  } = useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: 1,
  });
  // An API without the auth routes (or one that is down) behaves like the old header mode.
  const mode: AuthMode = me?.mode ?? (meError ? 'header' : 'session');
  const ready = !mePending;

  const [headerId, setHeaderId] = useState<string | null>(() => readStored());
  useEffect(() => {
    setCurrentOfficer(mode === 'header' ? headerId : null);
  }, [mode, headerId]);

  // Any 401 outside the sign-in routes: re-check the session; the route guard redirects.
  useEffect(() => {
    setUnauthorizedHandler(() => void qc.invalidateQueries({ queryKey: ME_KEY }));
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: Infinity });
  const officers = useMemo(() => meta?.officers ?? [], [meta]);
  const officer =
    mode === 'session' ? (me?.officer ?? null) : (officers.find((o) => o.id === headerId) ?? null);

  const choose = useCallback(
    (next: string | null) => {
      setCurrentOfficer(next);
      setHeaderId(next);
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

  const signIn = useCallback(
    async (officerId: string, pin: string) => {
      const { officer: signedIn } = await apiSignIn(officerId, pin);
      qc.setQueryData<AuthMe>(ME_KEY, (prev) => ({
        mode: prev?.mode ?? 'session',
        officer: signedIn,
        expiresAt: null,
      }));
      void qc.invalidateQueries({ queryKey: ME_KEY });
      void qc.invalidateQueries({ queryKey: ['case'] });
      return signedIn;
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    try {
      await apiSignOut();
    } finally {
      // Drop everything fetched as this officer; keep the sign-in state explicit.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'meta' });
      qc.setQueryData<AuthMe>(ME_KEY, { mode: 'session', officer: null, expiresAt: null });
    }
  }, [qc]);

  const value = useMemo<OfficerState>(
    () => ({
      mode,
      ready,
      officer,
      officers,
      meta,
      choose,
      signIn,
      signOut,
      can: (p) => Boolean(officer?.permissions.includes(p)),
    }),
    [mode, ready, officer, officers, meta, choose, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOfficer(): OfficerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOfficer must be used inside <OfficerProvider>');
  return v;
}

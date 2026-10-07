import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'thoudang.presentation';

interface PresentationState {
  on: boolean;
  toggle: () => void;
}
const Ctx = createContext<PresentationState>({ on: false, toggle: () => {} });

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Presentation mode (projector): +15% root font size and `.dev-noise` elements hidden
 * (file names, cache chips, internal ids). Purely visual — no data or behaviour changes.
 */
export function PresentationProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(readStored);
  useEffect(() => {
    document.documentElement.classList.toggle('presentation', on);
    try {
      if (on) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable — mode lasts for this tab only
    }
  }, [on]);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return <Ctx.Provider value={{ on, toggle }}>{children}</Ctx.Provider>;
}

export const usePresentation = () => useContext(Ctx);

export function PresentationToggle() {
  const { on, toggle } = usePresentation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      title="Larger text and less technical detail, for projectors"
      className={`group flex items-center gap-2.5 rounded-full border py-1.5 pl-3 pr-1.5 text-sm font-semibold transition ${
        on
          ? 'border-teal-accent/50 bg-teal-wash text-teal-darker'
          : 'border-line bg-white text-ink-soft hover:border-line-strong'
      }`}
    >
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 4h18v12H3zM12 16v4M8 20h8" />
      </svg>
      <span>Presentation mode</span>
      <span
        aria-hidden
        className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-teal-deep' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  );
}

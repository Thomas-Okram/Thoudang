import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** Transient confirmation, bottom-centre. The parent owns the timer. */
export function Toast({ tone = 'ok', children }: { tone?: 'ok' | 'error'; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`no-print fixed bottom-7 left-1/2 z-[70] flex -translate-x-1/2 animate-enter items-center gap-3 rounded-2xl py-3 pl-3.5 pr-5 text-[0.95rem] font-semibold shadow-overlay ${
        tone === 'ok' ? 'bg-navy-900 text-white' : 'bg-rose-700 text-white'
      }`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full ${tone === 'ok' ? 'bg-teal-accent' : 'bg-white/20'}`}
      >
        <Icon name={tone === 'ok' ? 'check' : 'alert'} size={16} strokeWidth={2.6} />
      </span>
      {children}
    </div>
  );
}

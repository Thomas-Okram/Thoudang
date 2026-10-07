import { useEffect } from 'react';
import type { AuditEntry } from '../../lib/api';

function actorKind(a: AuditEntry): { label: string; tone: string } {
  if (a.actor.startsWith('officer:'))
    return { label: a.actorName ?? 'Officer', tone: 'bg-navy-900 text-white' };
  if (a.actor === 'system:claude') return { label: 'AI', tone: 'bg-teal-accent text-white' };
  if (a.actor === 'system:rules') return { label: 'Rules', tone: 'bg-slate-700 text-white' };
  return { label: 'System', tone: 'bg-slate-200 text-slate-700' };
}

export function AuditDrawer({ entries, onClose }: { entries: AuditEntry[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-navy-950/30"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label="Audit trail"
    >
      <aside
        className="flex h-full w-full max-w-xl animate-enter flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-navy-900">Audit trail</h2>
            <p className="text-sm text-slate-500">
              Append-only — every AI reading, rule result and officer decision.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
        </header>
        <ol className="flex-1 space-y-0 overflow-y-auto px-6 py-4">
          {entries.map((a) => {
            const k = actorKind(a);
            return (
              <li
                key={a.id}
                className="relative flex gap-3 border-l-2 border-slate-200 pb-4 pl-4 last:pb-0"
              >
                <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-slate-400" />
                <time
                  className="w-12 shrink-0 pt-0.5 font-mono text-xs text-slate-500"
                  dateTime={a.createdAt}
                >
                  {new Date(a.createdAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </time>
                <div className="min-w-0">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-bold ${k.tone}`}>
                    {k.label}
                  </span>
                  <span className="text-sm text-slate-800">{a.summary}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}

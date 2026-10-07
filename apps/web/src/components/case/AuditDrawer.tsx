import type { AuditEntry } from '../../lib/api';
import { Drawer } from '../ui/Drawer';
import { Icon, type IconName } from '../ui/Icon';

function actorKind(a: AuditEntry): { label: string; tone: string; icon: IconName } {
  if (a.actor.startsWith('officer:'))
    return { label: a.actorName ?? 'Officer', tone: 'bg-navy-900 text-white', icon: 'user' };
  if (a.actor === 'system:claude')
    return { label: 'AI', tone: 'bg-teal-deep text-white', icon: 'sparkle' };
  if (a.actor === 'system:rules')
    return { label: 'Rules', tone: 'bg-slate-700 text-white', icon: 'scale' };
  return { label: 'System', tone: 'bg-slate-200 text-slate-800', icon: 'dot' };
}

export function AuditDrawer({ entries, onClose }: { entries: AuditEntry[]; onClose: () => void }) {
  return (
    <Drawer
      title="Audit trail"
      description="Append-only — every AI reading, rule result and officer decision."
      onClose={onClose}
    >
      <ol className="px-6 py-5" aria-label="Audit entries">
        {entries.map((a, i) => {
          const k = actorKind(a);
          return (
            <li key={a.id} className="relative flex gap-3 pb-5 pl-9 last:pb-0">
              {i < entries.length - 1 && (
                <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-line-strong" />
              )}
              <span
                className={`absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full ${k.tone}`}
              >
                <Icon name={k.icon} size={14} strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-navy-900">{k.label}</span>
                  <time className="font-mono text-xs text-ink-muted" dateTime={a.createdAt}>
                    {new Date(a.createdAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </time>
                </div>
                <p className="mt-0.5 text-[0.92rem] leading-snug text-ink-soft">{a.summary}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Drawer>
  );
}

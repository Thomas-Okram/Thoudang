import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useOverlay } from './useOverlay';

/** Right-hand side panel (audit trail etc.). Escape, backdrop and the × close it. */
export function Drawer({
  title,
  description,
  onClose,
  children,
  width = 'max-w-xl',
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const id = useId();
  const panel = useOverlay(onClose, false);
  return (
    <div
      className="no-print fixed inset-0 z-50 flex animate-fade justify-end bg-navy-950/35"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className={`flex h-full w-full ${width} animate-slide-in flex-col bg-surface shadow-overlay`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 id={`${id}-title`} className="text-xl font-bold tracking-tight text-navy-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-control text-ink-muted hover:bg-navy-50 hover:text-navy-900"
            autoFocus
          >
            <Icon name="x" size={22} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

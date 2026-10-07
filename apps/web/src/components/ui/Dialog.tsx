import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useOverlay } from './useOverlay';

/** Centred modal dialog. Escape and the backdrop close it; focus is trapped inside. */
export function Dialog({
  title,
  description,
  icon,
  tone = 'navy',
  onClose,
  children,
  footer,
  width = 'max-w-lg',
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  tone?: 'navy' | 'warn' | 'danger';
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
  className?: string;
}) {
  const id = useId();
  const panel = useOverlay(onClose);
  const iconTone =
    tone === 'danger'
      ? 'bg-rose-50 text-rose-700'
      : tone === 'warn'
        ? 'bg-warm-50 text-warm-700'
        : 'bg-navy-50 text-navy-700';
  return (
    <div
      className="no-print fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-navy-950/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={`w-full ${width} animate-enter rounded-panel bg-surface p-6 shadow-overlay outline-none ${className}`}
      >
        <div className="flex items-start gap-4">
          {icon && (
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconTone}`}
            >
              <Icon name={icon} size={22} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="text-xl font-bold tracking-tight text-navy-900">
              {title}
            </h2>
            {description && (
              <p id={`${id}-desc`} className="mt-1 text-[0.95rem] text-ink-muted">
                {description}
              </p>
            )}
          </div>
        </div>
        {children && <div className="mt-5">{children}</div>}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

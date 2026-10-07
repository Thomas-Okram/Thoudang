import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Card({
  className = '',
  padded = false,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { padded?: boolean }) {
  return (
    <section
      className={`rounded-card border border-line bg-surface shadow-card ${padded ? 'p-6' : ''} ${className}`}
      {...rest}
    >
      {children}
    </section>
  );
}

/** Card header: title (+ optional icon, subtitle) on the left, actions on the right. */
export function CardHeader({
  title,
  titleId,
  subtitle,
  icon,
  actions,
  className = '',
}: {
  title: ReactNode;
  titleId?: string;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-6 py-4 ${className}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-navy-50 text-navy-700">
            <Icon name={icon} size={19} />
          </span>
        )}
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold tracking-tight text-navy-900">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Small uppercase section label. */
export function Overline({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-overline font-bold uppercase text-ink-muted ${className}`}>
      {children}
    </div>
  );
}

import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({
  heading,
  body,
  icon = 'folder',
  action,
  compact = false,
}: {
  heading: string;
  body: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-2 border-dashed border-line-strong bg-surface/70 text-center ${compact ? 'px-5 py-8' : 'px-8 py-14'}`}
    >
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-500">
        <Icon name={icon} size={24} />
      </span>
      <h2 className="mt-3 text-lg font-semibold text-navy-900">{heading}</h2>
      <p className="mx-auto mt-1 max-w-xl text-ink-muted">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

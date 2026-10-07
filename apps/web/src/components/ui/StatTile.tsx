import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type StatTone = 'navy' | 'teal' | 'success' | 'warn' | 'danger' | 'muted';

const VALUE_TONE: Record<StatTone, string> = {
  navy: 'text-navy-900',
  teal: 'text-teal-deep',
  success: 'text-emerald-700',
  warn: 'text-warm-700',
  danger: 'text-rose-700',
  muted: 'text-ink-muted',
};
const ICON_TONE: Record<StatTone, string> = {
  navy: 'bg-navy-50 text-navy-700',
  teal: 'bg-teal-wash text-teal-deep',
  success: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-warm-50 text-warm-700',
  danger: 'bg-rose-50 text-rose-700',
  muted: 'bg-slate-100 text-slate-600',
};

/** KPI tile: big tabular number, uppercase label, optional hint/icon/footer (e.g. a bar). */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'navy',
  size = 'md',
  footer,
  className = '',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  tone?: StatTone;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
  className?: string;
}) {
  const valueSize =
    size === 'lg'
      ? 'text-[2.6rem] leading-none'
      : size === 'sm'
        ? 'text-2xl'
        : 'text-[2rem] leading-tight';
  return (
    <div
      data-testid="stat-tile"
      className={`flex flex-col rounded-card border border-line bg-surface shadow-card ${size === 'sm' ? 'px-4 py-3' : 'px-5 py-4'} ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-overline font-bold uppercase text-ink-muted">{label}</div>
        {icon && (
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ICON_TONE[tone]}`}
          >
            <Icon name={icon} size={17} />
          </span>
        )}
      </div>
      <div
        className={`mt-1 font-bold tracking-tight tabular-nums ${valueSize} ${VALUE_TONE[tone]}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-sm text-ink-muted">{hint}</div>}
      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </div>
  );
}

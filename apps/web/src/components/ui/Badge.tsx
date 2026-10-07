import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type BadgeTone =
  'neutral' | 'navy' | 'teal' | 'success' | 'warn' | 'danger' | 'info' | 'violet' | 'solid';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-300/70',
  navy: 'bg-navy-50 text-navy-800 ring-navy-200',
  teal: 'bg-teal-wash text-teal-darker ring-teal-accent/30',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/25',
  warn: 'bg-warm-50 text-warm-900 ring-warm-400/50',
  danger: 'bg-rose-50 text-rose-800 ring-rose-600/25',
  info: 'bg-sky-50 text-sky-900 ring-sky-600/25',
  violet: 'bg-violet-50 text-violet-900 ring-violet-500/25',
  solid: 'bg-navy-900 text-white ring-navy-900',
};

/** Small status/label pill. `size="lg"` for headline statuses. */
export function Badge({
  tone = 'neutral',
  size = 'md',
  icon,
  dot,
  className = '',
  title,
  children,
}: {
  tone?: BadgeTone;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  dot?: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const sz =
    size === 'sm'
      ? 'gap-1 px-2 py-0.5 text-[0.72rem]'
      : size === 'lg'
        ? 'gap-2 px-3.5 py-1.5 text-base'
        : 'gap-1.5 px-2.5 py-0.5 text-[0.8rem]';
  return (
    <span
      data-tone={tone}
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${TONE[tone]} ${sz} ${className}`}
    >
      {dot && <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />}
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 14} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

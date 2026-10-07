import type { ReactNode } from 'react';
export { EmptyState } from './ui/EmptyState';

/** Standard page frame: eyebrow, title, subtitle and right-aligned actions. */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 text-overline font-bold uppercase text-teal-deep">{eyebrow}</div>
        )}
        <h1 className="text-display font-bold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-2 max-w-3xl text-[1.05rem] text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

export function Page({
  title,
  subtitle,
  eyebrow,
  actions,
  width = 'max-w-6xl',
  children,
}: {
  title: string;
  subtitle: string;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto ${width} px-8 py-9`}>
      <PageHeader title={title} subtitle={subtitle || undefined} eyebrow={eyebrow} actions={actions} />
      {children}
    </div>
  );
}

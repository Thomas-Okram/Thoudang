import type { ReactNode } from 'react';

export function Page({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-navy-900">{title}</h1>
        <p className="mt-1 text-lg text-slate-600">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

export function EmptyState({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-8 py-14 text-center">
      <h2 className="text-xl font-semibold text-navy-800">{heading}</h2>
      <p className="mx-auto mt-2 max-w-xl text-slate-600">{body}</p>
    </div>
  );
}

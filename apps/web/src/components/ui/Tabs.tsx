import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  className?: string;
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string;
}

/** Segmented tab control with roving focus (←/→/Home/End), WAI-ARIA tabs pattern. */
export function Tabs<V extends string>({
  items,
  value,
  onChange,
  label,
  size = 'md',
  className = '',
}: {
  items: TabItem<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = items.findIndex((i) => i.value === value);

  const onKey = (e: KeyboardEvent) => {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? idx === last
          ? 0
          : idx + 1
        : e.key === 'ArrowLeft'
          ? idx <= 0
            ? last
            : idx - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    onChange(items[next]!.value);
    refs.current[next]?.focus();
  };

  const pad =
    size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-6 py-2.5 text-base' : 'px-4 py-2 text-[0.95rem]';
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`inline-flex rounded-xl border border-line bg-slate-100/80 p-1 ${className}`}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={item.ariaLabel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={onKey}
            className={`rounded-lg font-semibold transition-all duration-200 ${pad} ${item.className ?? ''} ${
              selected
                ? 'bg-white text-navy-900 shadow-[0_1px_3px_rgb(10_27_51/0.14)] ring-1 ring-line'
                : 'text-ink-muted hover:text-navy-900'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

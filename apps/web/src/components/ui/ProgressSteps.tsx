import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface Step {
  key: string;
  label: ReactNode;
  detail?: ReactNode;
}

type State = 'done' | 'active' | 'pending';

/**
 * Horizontal stepper. Connectors fill left→right and ticks "pop" as each stage completes, so a
 * pipeline run reads as a confident sequence from the back of the room.
 */
export function ProgressSteps({
  steps,
  current,
  complete = false,
  stalled = false,
  size = 'lg',
  label = 'Progress',
}: {
  steps: Step[];
  /** Index of the stage in progress. */
  current: number;
  /** Every step done (the last stage reached is itself finished). */
  complete?: boolean;
  /** The active step needs a human (e.g. extraction failed). */
  stalled?: boolean;
  size?: 'md' | 'lg';
  label?: string;
}) {
  const dot = size === 'lg' ? 'h-11 w-11' : 'h-8 w-8';
  const top = size === 'lg' ? 'top-[1.375rem]' : 'top-4';
  return (
    <ol
      aria-label={label}
      className="grid"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => {
        const state: State =
          complete || i < current ? 'done' : i === current ? 'active' : 'pending';
        const filled = complete || i < current;
        return (
          <li
            key={s.key}
            data-state={state}
            aria-current={state === 'active' ? 'step' : undefined}
            className="relative flex flex-col items-center px-1 text-center"
          >
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`absolute left-1/2 right-[-50%] ${top} h-1 -translate-y-1/2 overflow-hidden rounded-full bg-slate-200`}
              >
                <span
                  className="block h-full origin-left rounded-full bg-teal-accent transition-transform duration-700 ease-out-expo"
                  style={{ transform: `scaleX(${filled ? 1 : 0})` }}
                />
              </span>
            )}
            <span className={`relative z-10 flex ${dot} items-center justify-center`}>
              {state === 'done' ? (
                <span
                  key="done"
                  className={`flex ${dot} animate-pop items-center justify-center rounded-full bg-teal-deep text-white shadow-[0_4px_12px_-2px_rgb(11_122_110/0.5)]`}
                >
                  <Icon name="check" size={size === 'lg' ? 22 : 16} strokeWidth={3} />
                </span>
              ) : state === 'active' ? (
                <span
                  key="active"
                  className={`flex ${dot} items-center justify-center rounded-full border-[3px] bg-white ${
                    stalled
                      ? 'border-warm-500 text-warm-700'
                      : 'animate-halo border-teal-accent text-teal-deep'
                  }`}
                >
                  {stalled ? (
                    <Icon name="alert" size={size === 'lg' ? 20 : 15} strokeWidth={2.4} />
                  ) : (
                    <span
                      className={`${size === 'lg' ? 'h-4 w-4' : 'h-3 w-3'} animate-spin rounded-full border-[2.5px] border-teal-accent border-t-transparent`}
                    />
                  )}
                </span>
              ) : (
                <span
                  className={`flex ${dot} items-center justify-center rounded-full border-2 border-line-strong bg-white text-sm font-bold text-ink-muted`}
                >
                  {i + 1}
                </span>
              )}
            </span>
            <span
              className={`mt-2.5 leading-tight ${size === 'lg' ? 'text-[0.95rem]' : 'text-sm'} ${
                state === 'pending' ? 'text-ink-muted' : 'font-semibold text-navy-900'
              }`}
            >
              {s.label}
            </span>
            {s.detail && (
              <span className="mt-0.5 text-xs leading-tight text-ink-muted tabular-nums">
                {s.detail}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/** Data table primitives: zebra-free, hairline rows, tabular numerals, sticky-able header. */
export function Table({
  children,
  className = '',
  caption,
}: {
  children: ReactNode;
  className?: string;
  caption?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-[0.92rem] ${className}`}>
        {caption && (
          <caption className="mb-2 text-left text-overline font-bold uppercase text-ink-muted">
            {caption}
          </caption>
        )}
        {children}
      </table>
    </div>
  );
}

export function Th({
  align = 'left',
  className = '',
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={`border-b border-line-strong px-3 py-2.5 text-overline font-bold uppercase text-ink-muted first:pl-0 last:pr-0 ${ALIGN[align]} ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  align = 'left',
  className = '',
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={`border-b border-line px-3 py-2.5 first:pl-0 last:pr-0 ${ALIGN[align]} ${align === 'right' ? 'tabular-nums' : ''} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}

export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`transition-colors hover:bg-navy-50/50 ${className}`} {...rest} />;
}

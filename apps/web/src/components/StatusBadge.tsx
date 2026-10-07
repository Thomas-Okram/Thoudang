import type { CaseStatus } from '../lib/api';
import { STATUS_LABEL, STATUS_STYLE } from '../lib/labels';

export function StatusBadge({ status, large = false }: { status: CaseStatus; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ring-1 ring-inset ${STATUS_STYLE[status]} ${
        large ? 'px-4 py-1.5 text-base' : 'px-2.5 py-0.5 text-sm'
      }`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

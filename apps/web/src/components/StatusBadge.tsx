import type { CaseStatus } from '../lib/api';
import { STATUS_ICON, STATUS_LABEL, STATUS_STYLE } from '../lib/labels';
import { Icon } from './ui/Icon';

export function StatusBadge({ status, large = false }: { status: CaseStatus; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${STATUS_STYLE[status]} ${
        large ? 'px-4 py-1.5 text-base' : 'px-2.5 py-0.5 text-[0.8rem]'
      }`}
    >
      <Icon name={STATUS_ICON[status]} size={large ? 18 : 14} strokeWidth={2.4} />
      {STATUS_LABEL[status]}
    </span>
  );
}

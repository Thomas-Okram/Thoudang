import { useOfficer } from '../lib/officer';
import { Icon } from './ui/Icon';

export function OfficerSwitcher() {
  const { officer, officers, choose } = useOfficer();
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
          officer ? 'bg-navy-900 text-white' : 'bg-warm-100 text-warm-900'
        }`}
      >
        {officer ? (
          officer.name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()
        ) : (
          <Icon name="user" size={18} />
        )}
      </span>
      <div className="leading-tight">
        <label htmlFor="officer" className="block text-[0.7rem] font-semibold text-ink-muted">
          Acting as
        </label>
        <div className="relative">
          <select
            id="officer"
            value={officer?.id ?? ''}
            onChange={(e) => choose(e.target.value || null)}
            className={`max-w-[15rem] cursor-pointer appearance-none truncate rounded-md bg-transparent py-0.5 pr-6 text-[0.92rem] font-bold focus:outline-none ${
              officer ? 'text-navy-900' : 'text-warm-700'
            }`}
          >
            <option value="">Choose officer…</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <Icon
            name="chevronDown"
            size={16}
            className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-ink-muted"
          />
        </div>
      </div>
      {officer && (
        <span
          className={`hidden rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide xl:inline ${
            officer.role === 'DSWO' ? 'bg-navy-900 text-white' : 'bg-teal-wash text-teal-darker'
          }`}
          title={officer.roleLabel}
        >
          {officer.role === 'DSWO' ? 'DSWO · can approve' : 'Dealing Assistant'}
        </span>
      )}
    </div>
  );
}

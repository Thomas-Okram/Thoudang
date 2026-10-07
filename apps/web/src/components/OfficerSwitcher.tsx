import { useOfficer } from '../lib/officer';

export function OfficerSwitcher() {
  const { officer, officers, choose } = useOfficer();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor="officer" className="text-sm text-slate-500">
        Acting as
      </label>
      <div className="relative">
        <select
          id="officer"
          value={officer?.id ?? ''}
          onChange={(e) => choose(e.target.value || null)}
          className={`appearance-none rounded-lg border py-2 pl-3 pr-9 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-accent ${
            officer
              ? 'border-slate-300 bg-white text-navy-900'
              : 'border-amber-400 bg-amber-50 text-amber-900'
          }`}
        >
          <option value="">Choose officer…</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            d="M5.5 7.5 10 12l4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {officer && (
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
            officer.role === 'DSWO' ? 'bg-navy-900 text-white' : 'bg-teal-soft text-navy-900'
          }`}
          title={officer.roleLabel}
        >
          {officer.role === 'DSWO' ? 'DSWO · can approve' : 'Dealing Assistant'}
        </span>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useOfficer } from '../lib/officer';
import { Icon } from './ui/Icon';

/**
 * Header identity. Session mode (default): "Signed in as …" + Sign out. Header mode
 * (AUTH_MODE=header fallback): the old "Acting as" dropdown.
 */
export function OfficerSwitcher() {
  const { mode, officer, officers, choose, signOut } = useOfficer();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  if (mode === 'session') {
    if (!officer) return null;
    return (
      <div className="flex items-center gap-2.5" data-testid="signed-in-officer">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white"
        >
          {officer.name
            .split(/\s+/)
            .filter((w) => /^[A-Za-z]/.test(w))
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <div className="leading-tight">
          <div className="text-[0.7rem] font-semibold text-ink-muted">Signed in as</div>
          <div className="max-w-[15rem] truncate text-[0.92rem] font-bold text-navy-900">
            {officer.name}
          </div>
        </div>
        <span
          className={`hidden rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide xl:inline ${
            officer.role === 'DSWO' ? 'bg-navy-900 text-white' : 'bg-teal-wash text-teal-darker'
          }`}
          title={officer.roleLabel}
        >
          {officer.role === 'DSWO' ? 'DSWO · can approve' : 'Dealing Assistant'}
        </span>
        <button
          type="button"
          title="Sign out"
          disabled={leaving}
          onClick={async () => {
            setLeaving(true);
            try {
              await signOut();
            } finally {
              setLeaving(false);
              navigate('/login', { replace: true });
            }
          }}
          className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-navy-50 hover:text-navy-900 disabled:opacity-60"
        >
          <Icon name="lock" size={16} />
          <span className="max-2xl:sr-only">Sign out</span>
        </button>
      </div>
    );
  }

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

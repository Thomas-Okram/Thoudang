import { NavLink, Outlet } from 'react-router';
import { HealthBadge } from './HealthBadge';

const NAV = [
  { to: '/intake', label: 'Intake', hint: 'Upload packets' },
  { to: '/queue', label: 'Queue', hint: 'Cases by priority' },
  { to: '/case', label: 'Case', hint: 'Scrutinise one case' },
  { to: '/notices', label: 'Notices', hint: 'Deficiency notices' },
  { to: '/trust', label: 'Trust Report', hint: 'Accuracy & safeguards' },
] as const;

export function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col bg-navy-900 text-white">
        <div className="border-b border-navy-700 px-5 py-5">
          <div className="text-2xl font-bold tracking-tight">Thoudang</div>
          <div className="mt-0.5 text-sm text-slate-300">Welfare Scrutiny Desk</div>
          <div className="mt-1 text-xs text-slate-400">Social Welfare Dept · Manipur</div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-lg border-l-4 px-3 py-2.5 transition-colors ${
                  isActive
                    ? 'border-teal-accent bg-navy-800 text-white'
                    : 'border-transparent text-slate-300 hover:bg-navy-800/60 hover:text-white'
                }`
              }
            >
              <div className="font-semibold">{item.label}</div>
              <div className="text-xs text-slate-400">{item.hint}</div>
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 px-3 pb-4">
          <HealthBadge />
          <p className="px-1 text-xs leading-snug text-slate-400">
            AI reads · code decides · officer makes the final call.
          </p>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}

import { NavLink, Outlet } from 'react-router';
import { HealthBadge } from './HealthBadge';
import { OfficerSwitcher } from './OfficerSwitcher';
import { DemoReset } from './DemoReset';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', hint: 'Department overview' },
  { to: '/intake', label: 'Intake', hint: 'Upload packets' },
  { to: '/queue', label: 'Queue', hint: 'Cases by priority' },
  { to: '/notices', label: 'Notices', hint: 'Citizen corrections' },
  { to: '/trust', label: 'Trust Report', hint: 'Accuracy & safeguards' },
  { to: '/admin/templates', label: 'Templates', hint: 'Admin · notice wording' },
] as const;

export function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-navy-900 text-white">
        <div className="border-b border-navy-700 px-5 py-5">
          <div className="text-2xl font-bold tracking-tight">Thoudang</div>
          <div className="mt-0.5 text-sm text-slate-300">AI Scrutiny Desk</div>
          <div className="mt-1 text-xs text-slate-400">Social Welfare · Manipur</div>
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
                } ${item.to === '/admin/templates' ? 'mt-4' : ''}`
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
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-6 backdrop-blur">
          <div className="min-w-0 truncate text-sm">
            <span className="font-bold text-navy-900">Thoudang — AI Scrutiny Desk</span>
            <span className="mx-2 text-slate-300">|</span>
            <span className="text-slate-600">Department of Social Welfare, Manipur</span>
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold uppercase text-amber-900">
              Prototype
            </span>
          </div>
          <OfficerSwitcher />
        </div>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </main>
      <DemoReset />
    </div>
  );
}

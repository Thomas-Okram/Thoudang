import { NavLink, Outlet } from 'react-router';
import { HealthBadge } from './HealthBadge';
import { OfficerSwitcher } from './OfficerSwitcher';
import { DemoReset } from './DemoReset';
import { BrandMark } from './BrandMark';
import { Icon, type IconName } from './ui/Icon';
import { PresentationToggle } from '../lib/presentation';

const NAV: { group: string; items: { to: string; label: string; hint: string; icon: IconName }[] }[] =
  [
    {
      group: 'Casework',
      items: [
        { to: '/dashboard', label: 'Dashboard', hint: 'Department overview', icon: 'dashboard' },
        { to: '/intake', label: 'Intake', hint: 'Upload packets', icon: 'upload' },
        { to: '/queue', label: 'Queue', hint: 'Cases by priority', icon: 'queue' },
        { to: '/notices', label: 'Notices', hint: 'Citizen corrections', icon: 'notice' },
      ],
    },
    {
      group: 'Oversight',
      items: [
        { to: '/trust', label: 'Trust Report', hint: 'Accuracy & safeguards', icon: 'shield' },
      ],
    },
    {
      group: 'Administration',
      items: [
        {
          to: '/admin/templates',
          label: 'Templates',
          hint: 'Admin · notice wording',
          icon: 'template',
        },
      ],
    },
  ];

export function Layout() {
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only z-[80] rounded-control bg-white px-4 py-2 font-semibold text-navy-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <aside className="no-print sticky top-0 flex h-screen w-[16.5rem] shrink-0 flex-col bg-navy-900 bg-[radial-gradient(120%_60%_at_0%_0%,#163a66_0%,transparent_60%)] text-white">
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <BrandMark size={42} />
          <div className="min-w-0">
            <div className="text-[1.35rem] font-bold leading-none tracking-tight">Thoudang</div>
            <div className="mt-1 text-[0.8rem] font-medium text-teal-soft/90">AI Scrutiny Desk</div>
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="px-3 pb-1.5 text-overline font-bold uppercase text-navy-300">
                {g.group}
              </div>
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                          isActive
                            ? 'bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]'
                            : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            aria-hidden
                            className={`absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-teal-accent transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`}
                          />
                          <span
                            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                              isActive
                                ? 'bg-teal-accent/20 text-teal-soft'
                                : 'bg-white/[0.04] text-slate-300 group-hover:text-white'
                            }`}
                          >
                            <Icon name={item.icon} size={19} />
                          </span>
                          <span className="min-w-0 leading-tight">
                            <span className="block font-semibold">{item.label}</span>
                            <span className="block truncate text-xs text-slate-400 [@media(max-height:820px)]:hidden">
                              {item.hint}
                            </span>
                          </span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="shrink-0 space-y-3 px-3 pb-4 pt-2">
          <HealthBadge />
          <p className="px-2 text-xs leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-200">AI reads</span> ·{' '}
            <span className="font-semibold text-slate-200">code decides</span> ·{' '}
            <span className="font-semibold text-teal-soft">officer makes the final call</span>
          </p>
        </div>
      </aside>
      <main id="main" className="flex min-w-0 flex-1 flex-col">
        <div className="no-print sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-white/85 px-6 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
              <Icon name="building" size={19} />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[0.95rem] font-bold text-navy-900">
                Department of Social Welfare
              </div>
              <div className="truncate text-xs text-ink-muted">Government of Manipur</div>
            </div>
            <span
              className="ml-1 hidden shrink-0 rounded-full bg-warm-100 px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider text-warm-900 lg:inline"
              title="Prototype — synthetic SPECIMEN data only"
            >
              Prototype · Specimen data
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <PresentationToggle />
            <span aria-hidden className="h-7 w-px bg-line" />
            <OfficerSwitcher />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </main>
      <DemoReset />
    </div>
  );
}

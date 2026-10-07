import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError, fetchSignInOfficers, type SignInOfficer } from '../lib/api';
import { useOfficer } from '../lib/officer';
import { BrandMark } from '../components/BrandMark';
import { Badge, Button, Icon, Skeleton, Spinner } from '../components/ui';

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

/** Only same-site relative paths — never an open redirect. */
function safeNext(raw: string | null): string {
  return raw && /^\/(?![/\\])/.test(raw) && !raw.startsWith('/login') ? raw : '/queue';
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Officer sign-in: pick your name, then a 4-digit PIN. Sets an httpOnly session cookie. */
export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const { mode, ready, officer, signIn } = useOfficer();
  const { data, isPending, error } = useQuery({
    queryKey: ['auth', 'officers'],
    queryFn: fetchSignInOfficers,
  });

  const [chosen, setChosen] = useState<SignInOfficer | null>(null);
  const [pin, setPin] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  const officers = data?.officers ?? [];
  // One officer on the list → skip straight to the PIN.
  useEffect(() => {
    if (!chosen && officers.length === 1 && officers[0]?.canSignIn) setChosen(officers[0]);
  }, [chosen, officers]);
  useEffect(() => {
    if (chosen) pinRef.current?.focus();
  }, [chosen]);

  const submit = async (value: string) => {
    if (!chosen || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await signIn(chosen.id, value);
      navigate(next, { replace: true });
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
      setAttempt((n) => n + 1);
      setPin('');
      pinRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const update = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setPin(digits);
    if (failure) setFailure(null);
    if (digits.length === PIN_LENGTH) void submit(digits);
  };

  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'clear') update('');
    else if (key === 'back') update(pin.slice(0, -1));
    else update(pin + key);
    pinRef.current?.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pin.length === PIN_LENGTH) void submit(pin);
  };

  // Already signed in, or the API runs the header fallback → nothing to do here.
  if (ready && (officer && mode === 'session' ? true : mode === 'header')) {
    return <Navigate to={next} replace />;
  }

  return (
    <div className="grid min-h-[100dvh] bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-navy-900 bg-[radial-gradient(120%_70%_at_0%_0%,#163a66_0%,transparent_60%)] p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-3.5">
          <BrandMark size={52} />
          <div>
            <div className="text-[1.7rem] font-bold leading-none tracking-tight">Thoudang</div>
            <div className="mt-1.5 text-[0.95rem] font-medium text-teal-soft/90">
              AI Scrutiny Desk
            </div>
          </div>
        </div>
        <div className="my-auto max-w-[30rem] py-12">
          <h1 className="text-[2.1rem] font-bold leading-tight tracking-tight">
            Welfare applications, screened with evidence.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-300">
            Old Age Pension packets are read, checked and queued — every decision stays with the
            officer.
          </p>
          <ul className="mt-9 space-y-4">
            {[
              { icon: 'eye' as const, title: 'AI reads', text: 'every field, with its evidence' },
              { icon: 'scale' as const, title: 'Code decides', text: 'the same rules, every case' },
              {
                icon: 'shield' as const,
                title: 'You make the final call',
                text: 'nothing is ever auto-rejected',
              },
            ].map((p) => (
              <li key={p.title} className="flex items-center gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-teal-soft ring-1 ring-white/10">
                  <Icon name={p.icon} size={21} />
                </span>
                <span className="leading-snug">
                  <span className="block font-semibold">{p.title}</span>
                  <span className="block text-[0.95rem] text-slate-400">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2.5 text-sm text-slate-400">
          <Icon name="building" size={17} />
          Department of Social Welfare · Government of Manipur
        </div>
      </section>

      {/* Sign-in panel */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[29rem]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark size={44} />
            <div>
              <div className="text-xl font-bold leading-none text-navy-900">Thoudang</div>
              <div className="mt-1 text-sm text-ink-muted">AI Scrutiny Desk</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-overline font-bold uppercase text-teal-deep">
              Officer sign-in
            </span>
            <Badge tone="warn">Prototype · Specimen data</Badge>
          </div>

          {!chosen ? (
            <div className="animate-enter">
              <h2 className="mt-3 text-title font-bold text-navy-900">Who is signing in?</h2>
              <p className="mt-1.5 text-ink-soft">Choose your name to continue.</p>
              <div className="mt-6 space-y-3" role="list">
                {isPending &&
                  [0, 1].map((i) => <Skeleton key={i} className="h-[5.25rem] w-full" />)}
                {error && (
                  <p role="alert" className="rounded-card bg-rose-50 p-4 text-rose-900">
                    Cannot reach the Thoudang server. Check that it is running, then reload.
                  </p>
                )}
                {officers.map((o) => (
                  <button
                    key={o.id}
                    role="listitem"
                    data-testid={`login-officer-${o.id}`}
                    disabled={!o.canSignIn}
                    onClick={() => {
                      setChosen(o);
                      setPin('');
                      setFailure(null);
                    }}
                    className="group flex w-full items-center gap-4 rounded-panel border border-line bg-surface p-4 text-left shadow-card transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-teal-accent/60 hover:shadow-raised disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                  >
                    <span
                      aria-hidden
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold ${
                        o.role === 'DSWO'
                          ? 'bg-navy-900 text-white'
                          : 'bg-teal-wash text-teal-darker'
                      }`}
                    >
                      {initials(o.name)}
                    </span>
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="block truncate text-[1.05rem] font-bold text-navy-900">
                        {o.name}
                      </span>
                      <span className="block truncate text-sm text-ink-muted">
                        {o.roleLabel}
                        {o.district ? ` · ${o.district}` : ''}
                      </span>
                    </span>
                    {o.role === 'DSWO' && (
                      <Badge tone="solid" className="max-sm:hidden">
                        Can approve
                      </Badge>
                    )}
                    {!o.canSignIn && <Badge tone="neutral">No PIN set</Badge>}
                    <Icon
                      name="chevronRight"
                      size={20}
                      className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-teal-deep"
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <form className="animate-enter" onSubmit={onSubmit} noValidate>
              <button
                type="button"
                onClick={() => {
                  setChosen(null);
                  setPin('');
                  setFailure(null);
                }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-teal-deep hover:text-teal-darker"
              >
                <Icon name="arrowLeft" size={16} /> Not you? Choose another officer
              </button>
              <div className="mt-4 flex items-center gap-3.5">
                <span
                  aria-hidden
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold ${
                    chosen.role === 'DSWO'
                      ? 'bg-navy-900 text-white'
                      : 'bg-teal-wash text-teal-darker'
                  }`}
                >
                  {initials(chosen.name)}
                </span>
                <div className="min-w-0 leading-snug">
                  <h2 className="truncate text-title font-bold text-navy-900">{chosen.name}</h2>
                  <div className="truncate text-sm text-ink-muted">{chosen.roleLabel}</div>
                </div>
              </div>

              <label
                htmlFor="pin"
                className="mt-7 block text-[0.95rem] font-semibold text-ink-soft"
              >
                Enter your {PIN_LENGTH}-digit PIN
              </label>
              <div className="relative mt-3">
                <input
                  ref={pinRef}
                  id="pin"
                  data-testid="pin-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  pattern="[0-9]*"
                  maxLength={PIN_LENGTH}
                  value={pin}
                  disabled={busy}
                  aria-invalid={Boolean(failure)}
                  aria-describedby={failure ? 'pin-error' : undefined}
                  onChange={(e) => update(e.target.value)}
                  className="peer absolute inset-0 h-full w-full cursor-text opacity-0"
                />
                <div
                  key={attempt}
                  aria-hidden
                  className={`grid grid-cols-4 gap-3 rounded-panel peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-teal-accent ${
                    attempt > 0 ? 'animate-shake' : ''
                  }`}
                >
                  {Array.from({ length: PIN_LENGTH }, (_, i) => {
                    const filled = i < pin.length;
                    const current = i === pin.length && !busy;
                    return (
                      <div
                        key={i}
                        className={`flex h-16 items-center justify-center rounded-card border-2 bg-surface transition-colors ${
                          failure
                            ? 'border-rose-400 bg-rose-50'
                            : filled
                              ? 'border-teal-deep bg-teal-wash'
                              : current
                                ? 'border-navy-300'
                                : 'border-line'
                        }`}
                      >
                        {filled && (
                          <span className="h-3.5 w-3.5 animate-pop rounded-full bg-navy-900" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 min-h-[1.75rem]" aria-live="polite">
                {busy ? (
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-soft">
                    <Spinner size={16} /> Signing in…
                  </span>
                ) : failure ? (
                  <span
                    id="pin-error"
                    role="alert"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-rose-800"
                  >
                    <Icon name="alert" size={17} /> {failure}
                  </span>
                ) : null}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2.5" aria-label="PIN keypad">
                {KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    tabIndex={-1}
                    disabled={busy}
                    onClick={() => press(k)}
                    aria-label={k === 'back' ? 'Delete last digit' : k === 'clear' ? 'Clear' : k}
                    className={`h-14 rounded-card text-xl font-semibold transition-[background-color,transform] active:scale-[0.97] disabled:opacity-50 ${
                      k === 'back' || k === 'clear'
                        ? 'bg-transparent text-base text-ink-soft hover:bg-navy-50'
                        : 'bg-surface text-navy-900 shadow-card ring-1 ring-line hover:bg-navy-50'
                    }`}
                  >
                    {k === 'back' ? (
                      <Icon name="arrowLeft" size={20} className="mx-auto" />
                    ) : k === 'clear' ? (
                      'Clear'
                    ) : (
                      k
                    )}
                  </button>
                ))}
              </div>

              <Button
                type="submit"
                variant="navy"
                size="lg"
                className="mt-5 w-full"
                icon="lock"
                loading={busy}
                disabled={pin.length !== PIN_LENGTH}
              >
                Sign in
              </Button>
            </form>
          )}

          <p className="mt-8 flex items-start gap-2 text-sm leading-relaxed text-ink-muted">
            <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
            <span>
              Signing in starts a secure session on this computer. Every action you take is recorded
              in the audit log under your name.
              <span className="dev-noise block pt-1">
                Demo PINs: DSWO 2468 · Dealing Assistant 1357 (see apps/api/.env.example).
              </span>
            </span>
          </p>
        </div>
      </main>
    </div>
  );
}

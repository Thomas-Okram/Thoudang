import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { OfficerProvider } from '../../lib/officer';
import { LoginPage } from '../LoginPage';
import { RequireOfficer } from '../../components/RequireOfficer';

const DSWO = {
  id: 'dswo-imphal-west',
  name: 'DSWO Imphal West',
  role: 'DSWO',
  roleLabel: 'District Social Welfare Officer',
  district: 'Imphal West',
  permissions: ['approve'],
};

function mockApi(opts: { pin: string; mode?: 'session' | 'header' }) {
  let signedIn = false;
  const calls: { url: string; body?: unknown }[] = [];
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      calls.push({ url, body });
      if (url === '/api/auth/me')
        return json(200, {
          mode: opts.mode ?? 'session',
          officer: signedIn ? DSWO : null,
          expiresAt: null,
        });
      if (url === '/api/auth/officers')
        return json(200, {
          mode: 'session',
          officers: [
            { ...DSWO, canSignIn: true },
            {
              ...DSWO,
              id: 'da',
              name: 'Dealing Assistant',
              role: 'DEALING_ASSISTANT',
              canSignIn: true,
            },
          ],
        });
      if (url === '/api/meta')
        return json(200, { officers: [DSWO], overrideReasons: [], editReasons: [] });
      if (url === '/api/auth/login') {
        const b = body as { pin: string };
        if (b.pin !== opts.pin) return json(401, { error: 'Wrong PIN' });
        signedIn = true;
        return json(200, { officer: DSWO });
      }
      return json(404, { error: 'not found' });
    }),
  );
  return calls;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <OfficerProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/queue"
              element={
                <RequireOfficer>
                  <h1>Queue screen</h1>
                </RequireOfficer>
              }
            />
          </Routes>
        </OfficerProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it('guards officer screens: an unsigned-in visit goes to sign-in', async () => {
    mockApi({ pin: '2468' });
    renderAt('/queue');
    expect(await screen.findByText('Who is signing in?')).toBeTruthy();
    expect(screen.queryByText('Queue screen')).toBeNull();
  });

  it('pick officer → 4-digit PIN signs in with JSON and returns to the page', async () => {
    const calls = mockApi({ pin: '2468' });
    renderAt('/login?next=%2Fqueue');
    fireEvent.click(await screen.findByTestId('login-officer-dswo-imphal-west'));
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: '2468' } });
    expect(await screen.findByText('Queue screen')).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/auth/login')?.body).toEqual({
      officerId: 'dswo-imphal-west',
      pin: '2468',
    });
  });

  it('a wrong PIN shows the error and clears the boxes', async () => {
    mockApi({ pin: '2468' });
    renderAt('/login');
    fireEvent.click(await screen.findByTestId('login-officer-dswo-imphal-west'));
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: '1111' } });
    expect((await screen.findByRole('alert')).textContent).toContain('Wrong PIN');
    await waitFor(() =>
      expect((screen.getByTestId('pin-input') as HTMLInputElement).value).toBe(''),
    );
  });

  it('AUTH_MODE=header fallback: no sign-in needed', async () => {
    mockApi({ pin: '2468', mode: 'header' });
    renderAt('/queue');
    expect(await screen.findByText('Queue screen')).toBeTruthy();
  });

  it('never sends X-Officer-Id in session mode', async () => {
    mockApi({ pin: '2468' });
    renderAt('/login');
    await screen.findByText('Who is signing in?');
    const f = vi.mocked(fetch);
    for (const [, init] of f.mock.calls) {
      const h = (init?.headers ?? {}) as Record<string, string>;
      expect(h['X-Officer-Id']).toBeUndefined();
    }
  });
});

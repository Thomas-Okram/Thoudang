export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  db: 'ok' | 'error';
  claudeConfigured: boolean;
  time: string;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const fetchHealth = () => getJson<HealthResponse>('/api/health');

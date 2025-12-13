export type LngLat = [number, number];

function apiBase(): string {
  const cfg: any = (window as any).APP_CONFIG || {};
  return (cfg.API_BASE && String(cfg.API_BASE).trim()) || '/api';
}

export async function fetchJSON<T=any>(path: string): Promise<T> {
  const r = await fetch(apiBase() + '/' + path, { cache: 'no-store', mode: 'cors' });
  if (!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}

export async function fetchJSONRetry<T=any>(path: string, tries=3, delay=500): Promise<T> {
  async function attempt(n: number): Promise<T> {
    try { return await fetchJSON<T>(path); }
    catch(e: any){
      const msg = String(e?.message || '');
      if(/Abort|ERR_ABORTED/i.test(msg)) return Promise.resolve(null as any);
      if(n<=1) throw e;
      const wait = delay*Math.pow(2,tries-n)*(0.7+Math.random()*0.6);
      await new Promise(res=>setTimeout(res, wait));
      return attempt(n-1);
    }
  }
  return attempt(tries);
}

export async function postJSON<T=any>(path: string, payload: any): Promise<T> {
  const r = await fetch(apiBase() + '/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}

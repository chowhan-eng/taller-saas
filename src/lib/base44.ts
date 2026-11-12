import { createClient } from '@base44/sdk';

const TOKEN_KEY = 'base44_access_token';
const APP_ID = import.meta.env.VITE_BASE44_APP_ID;

let client: ReturnType<typeof createClient> | null = null;
/** Lazy: never construct the client at import time (a missing app id must not blank the page — QA ISSUE-002). */
export function base44() {
  if (!client) {
    if (!APP_ID) throw new Error('VITE_BASE44_APP_ID is not set');
    client = createClient({ appId: APP_ID, requiresAuth: false });
  }
  return client;
}

let memToken: string | null = null;
function readToken(): string | null {
  if (memToken) return memToken;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

/** After Base44 sign-in the page comes back with ?access_token=…: keep it and strip it from the URL. */
export function captureLoginToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('access_token');
  if (!token) return;
  memToken = token;
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode: token lives for this page only */ }
  url.searchParams.delete('access_token');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export const isSignedIn = () => !!readToken();

export function redirectToLogin() {
  base44().auth.redirectToLogin(window.location.href);
}

/**
 * POST to a Base44 backend function at /functions/<name> (same origin as the site). Keeps real HTTP
 * status codes so the UI can tell 401 from 503. Network failures throw (handled by guard()).
 */
export async function callFn<T extends object = Record<string, unknown>>(name: string, body: unknown) {
  const token = readToken();
  const res = await fetch(`/functions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<T> & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

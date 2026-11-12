/** Shared HTTP helpers for Base44 backend functions (port of web/lib/api.ts). */
export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const UNAVAILABLE = 'Servicio no disponible ahora mismo. Inténtalo en unos minutos.';

/**
 * Wrap a handler so ANY thrown error (missing secret, Stripe/Meta unreachable) becomes a logged
 * JSON 503 instead of an empty 500. Non-POST methods get 405, like the old Next.js routes.
 */
export function withJsonErrors(name: string, handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    try {
      return await handler(req);
    } catch (e) {
      console.error(`[fn] ${name} failed:`, e);
      return json({ ok: false, error: UNAVAILABLE }, 503);
    }
  };
}

/** Base44 returns created_date without a zone suffix in some APIs; treat it as UTC. */
export function parseTs(s: string | undefined | null): number {
  if (!s) return 0;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

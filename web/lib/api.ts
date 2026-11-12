import { NextResponse } from 'next/server';

/**
 * Wrap an API route handler so ANY thrown error (missing config, Supabase/Stripe/Meta unreachable)
 * becomes a logged JSON 503 instead of Next's empty-body 500. The client always gets a message.
 */
export function withJsonErrors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (e) {
      console.error(`[api] ${new URL(req.url).pathname} failed:`, e);
      return NextResponse.json(
        { ok: false, error: 'Servicio no disponible ahora mismo. Inténtalo en unos minutos.' },
        { status: 503 },
      );
    }
  };
}

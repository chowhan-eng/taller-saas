// Module: WhatsApp Pro (Starter + Pro). Scaffold: gate + action router. Port the WhatsApp Inbox Pro
// actions here (send templates, inbox, BAJA handling) — each handler receives an already-gated tenant.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { gateModule } from '../../shared/modules.ts';
import { checkWhatsappQuota } from '../../shared/waQuota.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('whatsapp', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const body = (await req.json().catch(() => ({}))) as { tenantId?: string; action?: string };
  const db = base44.asServiceRole.entities as unknown as Entities;
  const gate = await gateModule(db, user?.id, body.tenantId, 'whatsapp');
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  switch (body.action) {
    case 'settings': {
      const t = gate.tenant;
      return json({ wa_mode: t.wa_mode, wa_display_phone: t.wa_display_phone, wa_paused: t.wa_paused, wa_quality_rating: t.wa_quality_rating, google_review_url: t.google_review_url, review_delay_hours: t.review_delay_hours });
    }
    case 'quota': {
      // The ported send path MUST call checkWhatsappQuota() and refuse when !ok (trial cap 50, daily cap, pause).
      return json(await checkWhatsappQuota(db, gate.tenant));
    }
    default:
      return json({ error: 'Acción no disponible todavía.' }, 501);
  }
});

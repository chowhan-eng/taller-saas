// Port of supabase/migrations/002_sales_engine.sql: private.next_call_slot + public.schedule_voice_callback.
import type { Entities } from './db.ts';

type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number; dow: number };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
});

function madrid(d: Date): Wall {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, dow: DOW.indexOf(p.weekday) + 1 };
}

/** Madrid wall-clock time → UTC instant (handles CET/CEST). */
function fromMadrid(y: number, m: number, d: number, h: number, mi: number): Date {
  const target = Date.UTC(y, m - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const w = madrid(new Date(guess));
    guess += target - Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  }
  return new Date(guess);
}

/**
 * Earliest instant >= ts inside calling hours (Europe/Madrid): Mon–Fri 09:00–20:55, Sat 10:00–13:55,
 * never Sunday. Same rules as the SQL version (LGT 11/2022 art. 66: consented calls only).
 */
export function nextCallSlot(ts: Date): Date | null {
  let cur = ts;
  for (let i = 0; i < 8; i++) {
    const w = madrid(cur);
    const t = w.h * 60 + w.mi + w.s / 60;
    if (w.dow >= 1 && w.dow <= 5) {
      if (t < 9 * 60) return fromMadrid(w.y, w.m, w.d, 9, 0);
      if (t <= 20 * 60 + 55) return cur;
    } else if (w.dow === 6) {
      if (t < 10 * 60) return fromMadrid(w.y, w.m, w.d, 10, 0);
      if (t <= 13 * 60 + 55) return cur;
    }
    const next = new Date(Date.UTC(w.y, w.m - 1, w.d) + 86400e3);
    cur = fromMadrid(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0);
  }
  return null;
}

/**
 * Schedule ONE consented callback for a lead. Refuses without consent_commercial_call or with do_not_contact.
 * Idempotent: returns null if a scheduled/dialing call already exists.
 */
export async function scheduleVoiceCallback(db: Entities, leadId: string, delayMinutes = 5): Promise<string | null> {
  const [lead] = await db.Lead.filter({ id: leadId }, undefined, 1);
  if (!lead) throw new Error('lead not found');
  if (lead.consent_commercial_call !== true || lead.do_not_contact === true) {
    throw new Error(`no call consent for lead ${leadId}`);
  }
  const calls = await db.VoiceCall.filter({ lead_id: leadId }, '-created_date', 20);
  if (calls.some((c) => c.status === 'scheduled' || c.status === 'dialing')) return null;
  const slot = nextCallSlot(new Date(Date.now() + Math.max(delayMinutes, 1) * 60e3));
  const call = await db.VoiceCall.create({
    lead_id: leadId, direction: 'callback', status: 'scheduled',
    scheduled_for: slot?.toISOString() ?? null, to_phone: lead.phone_e164 ?? null,
  });
  return call.id;
}

// «Programa Beta Fundadores»: max 10 shops at 59 €/year, then 29 €/month for life.
// A seat is taken by a founder subscription that is paid (active / past_due / trialing) or by a checkout in
// progress (incomplete, touched in the last RESERVATION_MS) — so two shops cannot both take seat 10.
import { find, type Entities, type Row } from './db.ts';
import { parseTs } from './http.ts';

export const FOUNDER_CAP = 10;
export const RESERVATION_MS = 35 * 60e3; // Stripe Checkout sessions for founders expire after 30 min
const TAKEN = ['active', 'past_due', 'trialing'];

export function countFounderSeats(subs: Row[], now = Date.now(), excludeTenantId?: string) {
  const taken = subs.filter((s) => s.plan === 'founder' && s.tenant_id !== excludeTenantId && (
    TAKEN.includes(String(s.status)) ||
    (s.status === 'incomplete' && now - parseTs((s.updated_date ?? s.created_date) as string | undefined) < RESERVATION_MS)
  )).length;
  return { cap: FOUNDER_CAP, taken: Math.min(taken, FOUNDER_CAP), left: Math.max(0, FOUNDER_CAP - taken) };
}

export async function founderSeats(db: Entities, excludeTenantId?: string) {
  return countFounderSeats(await find(db.Subscription, { plan: 'founder' }), Date.now(), excludeTenantId);
}

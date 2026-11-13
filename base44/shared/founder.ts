// «Programa Beta Fundadores»: max 10 shops at 59 €/year, then 29 €/month for life.
// A seat is taken by a founder subscription that is paid (active / past_due / trialing), by a checkout in
// progress (incomplete, touched in the last RESERVATION_MS) or by a hold (founder_hold_at, same window: used when the
// shop already has a running free trial that must not be touched) — so two shops cannot both take seat 10.
import { find, type Entities, type Row } from './db.ts';
import { parseTs } from './http.ts';

export const FOUNDER_CAP = 10;
export const RESERVATION_MS = 35 * 60e3; // Stripe Checkout sessions for founders expire after 30 min
const TAKEN = ['active', 'past_due', 'trialing'];

const recent = (iso: unknown, now: number) => now - parseTs(iso as string | undefined) < RESERVATION_MS;
const paidFounder = (s: Row) => s.plan === 'founder' && TAKEN.includes(String(s.status));
const pendingFounder = (s: Row, now: number) => s.plan === 'founder' && s.status === 'incomplete' && recent(s.updated_date ?? s.created_date, now);
const held = (s: Row, now: number) => !!s.founder_hold_at && recent(s.founder_hold_at, now);

/** Checkouts in progress that are reserving a seat right now (for the counter and the admin panel). */
export function activeHolds(subs: Row[], now = Date.now(), excludeTenantId?: string) {
  return subs.filter((s) => s.tenant_id !== excludeTenantId && !paidFounder(s) && (pendingFounder(s, now) || held(s, now)))
    .map((s) => ({ tenant_id: s.tenant_id as string, started: s.founder_hold_at ? parseTs(s.founder_hold_at as string) : parseTs((s.updated_date ?? s.created_date) as string | undefined) }));
}

export function countFounderSeats(subs: Row[], now = Date.now(), excludeTenantId?: string) {
  const paid = subs.filter((s) => s.tenant_id !== excludeTenantId && paidFounder(s)).length;
  const taken = paid + activeHolds(subs, now, excludeTenantId).length;
  return { cap: FOUNDER_CAP, taken: Math.min(taken, FOUNDER_CAP), left: Math.max(0, FOUNDER_CAP - taken) };
}

export async function founderSeats(db: Entities, excludeTenantId?: string) {
  const subs = await find(db.Subscription, {});
  return countFounderSeats(subs, Date.now(), excludeTenantId);
}

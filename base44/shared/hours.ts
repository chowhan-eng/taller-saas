// Europe/Madrid opening-hours check, DST-safe via Intl. Ported from WhatsApp Inbox Pro's
// isWithinBusinessHours, reading the tenant's own Tenant.opening_hours
// ({"mon":[["10:00","14:00"],["17:00","20:30"]], ..., "sun":[]}) instead of a global setting.
type Ranges = [string, string][];
const DAY: Record<string, string> = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' };

/** Same default schedule as WhatsApp Inbox Pro when a tenant has no hours for that day. */
const DEFAULT: Record<string, Ranges> = {
  mon: [['09:30', '14:00'], ['17:00', '20:30']], tue: [['09:30', '14:00'], ['17:00', '20:30']],
  wed: [['09:30', '14:00'], ['17:00', '20:30']], thu: [['09:30', '14:00'], ['17:00', '20:30']],
  fri: [['09:30', '14:00'], ['17:00', '20:30']], sat: [['10:00', '14:00']], sun: [],
};

function madridClock(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: DAY[p.weekday], minutes: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

export function isWithinOpeningHours(openingHours: unknown, d: Date = new Date()): boolean {
  const { day, minutes } = madridClock(d);
  const table = (openingHours && typeof openingHours === 'object' ? openingHours : {}) as Record<string, unknown>;
  const ranges = (Array.isArray(table[day]) ? table[day] : DEFAULT[day]) as Ranges;
  return ranges.some(([a, b]) => minutes >= toMin(a) && minutes < toMin(b));
}

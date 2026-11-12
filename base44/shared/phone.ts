/** Normalise a Spanish mobile (6xx/7xx) to E.164 without '+', e.g. "34612345678". Returns null otherwise. */
export function toSpanishMobile(raw: string): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('0034')) d = d.slice(4);
  else if (d.startsWith('34') && d.length === 11) d = d.slice(2);
  return /^[67]\d{8}$/.test(d) ? `34${d}` : null;
}

/** Very small IPv4/IPv6 sanity check so we never send garbage into an `inet` column. */
export function cleanIp(raw: string | null | undefined): string | null {
  const ip = (raw ?? '').split(',')[0].trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(':')) return ip;
  return null;
}

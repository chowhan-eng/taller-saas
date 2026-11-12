// Opt-out detection for inbound WhatsApp messages (RGPD / Meta policy).
// STRICT: the whole message, ignoring case, accents, punctuation and spaces, must be exactly "BAJA" or
// "STOP". A casual "no" (to a budget, to "¿algo más?") is never an opt-out. Ported from WhatsApp Inbox
// Pro's exact-match rule, narrowed to the two keywords the product promises in its templates.
const OPT_OUT_KEYWORDS = new Set(['baja', 'stop']);

export function normalizeKeyword(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isOptOut(text: string): boolean {
  return OPT_OUT_KEYWORDS.has(normalizeKeyword(text));
}

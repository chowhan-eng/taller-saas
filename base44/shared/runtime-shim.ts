// LOCAL TYPE-CHECK ONLY (`npm run check:functions` maps `base44:runtime` here via base44/deno.json).
// On Base44 the platform provides the real `base44:runtime` module; nothing imports this file directly.
export const secrets: { get(name: string): string | undefined } = { get: () => undefined };
export function waitUntil(_p: Promise<unknown>): void {}

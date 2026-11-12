import { describe, expect, it } from 'vitest';
import { classifyMetaError, normalizePhone, parseInbound, verifyMetaSignature } from '../base44/shared/meta.ts';

async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verifyMetaSignature (fail closed)', () => {
  it('accepts the right signature and rejects everything else', async () => {
    const body = '{"entry":[]}';
    expect(await verifyMetaSignature('s3cret', body, await sign('s3cret', body))).toBe(true);
    expect(await verifyMetaSignature('s3cret', body + ' ', await sign('s3cret', body))).toBe(false);
    expect(await verifyMetaSignature('s3cret', body, await sign('other', body))).toBe(false);
    expect(await verifyMetaSignature(undefined, body, await sign('s3cret', body))).toBe(false);
    expect(await verifyMetaSignature('s3cret', body, null)).toBe(false);
  });
});

describe('parseInbound', () => {
  const base = { id: 'wamid.1', from: '34612345678', timestamp: '1794500000' };
  it('text, buttons, lists, contacts, media, unknown', () => {
    expect(parseInbound({ ...base, type: 'text', text: { body: 'Hola' } })).toMatchObject({ type: 'text', body: 'Hola', from: '34612345678' });
    expect(parseInbound({ ...base, type: 'interactive', interactive: { button_reply: { id: 'b1', title: 'Sí' } } })).toMatchObject({ type: 'text', body: 'Sí' });
    expect(parseInbound({ ...base, type: 'button', button: { text: 'Recoger' } })).toMatchObject({ type: 'text', body: 'Recoger' });
    expect(parseInbound({ ...base, type: 'contacts', contacts: [{ name: { formatted_name: 'Ana' }, phones: [{ phone: '+34 600' }] }] }).body).toContain('Ana — +34 600');
    expect(parseInbound({ ...base, type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'pantalla' } })).toMatchObject({ type: 'image', body: 'pantalla', mediaId: 'm1' });
    expect(parseInbound({ ...base, type: 'location' })).toMatchObject({ body: '[location]' });
  });
  it('reactions carry their target', () => {
    expect(parseInbound({ ...base, type: 'reaction', reaction: { message_id: 'wamid.0', emoji: '👍' } }).reaction).toEqual({ targetId: 'wamid.0', emoji: '👍' });
  });
});

describe('helpers', () => {
  it('normalizes Spanish numbers like WhatsApp Inbox Pro', () => {
    expect(normalizePhone('612 345 678')).toBe('34612345678');
    expect(normalizePhone('+34 612345678')).toBe('34612345678');
    expect(normalizePhone('')).toBeNull();
  });
  it('classifies Meta errors', () => {
    expect(classifyMetaError(131047)).toBe('hold');
    expect(classifyMetaError(131026)).toBe('permanent');
    expect(classifyMetaError(130429)).toBe('transient');
  });
});

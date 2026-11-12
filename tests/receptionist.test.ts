import { describe, expect, it } from 'vitest';
import { buildReceptionistPrompt, decideAutoReply, parseReceptionistOutput, type Draft } from '../base44/shared/receptionist.ts';

describe('parseReceptionistOutput', () => {
  it('splits the reply from the control lines', () => {
    const d = parseReceptionistOutput('¡Hola Ana! El cambio de pantalla del iPhone 13 cuesta desde 109 €.\nCONFIDENCE: 0.92\nREQUIRES_HUMAN: false\nCATEGORY: pricing\nSUMMARY: Pregunta precio pantalla');
    expect(d).toEqual({ reply: '¡Hola Ana! El cambio de pantalla del iPhone 13 cuesta desde 109 €.', confidence: 0.92, requiresHuman: false, category: 'pricing', summary: 'Pregunta precio pantalla' });
  });
  it('defaults like generateDraft and rejects empty output', () => {
    expect(parseReceptionistOutput('Hola')).toMatchObject({ confidence: 0.7, requiresHuman: false, category: 'other' });
    expect(parseReceptionistOutput('CONFIDENCE: 0.9')).toBeNull();
    expect(parseReceptionistOutput('')).toBeNull();
  });
});

describe('decideAutoReply (port of evaluateAutoReply)', () => {
  const draft: Draft = { reply: 'x', confidence: 0.9, requiresHuman: false, category: 'pricing', summary: '' };
  const base = { mode: 'live', draft, minConfidence: 0.8, usedToday: 0, dailyCap: 50, automationPaused: false, autoreplyDisabled: false };
  it('live + good draft → sent; shadow → would_send', () => {
    expect(decideAutoReply(base)).toEqual({ decision: 'sent', reasons: [] });
    expect(decideAutoReply({ ...base, mode: 'shadow' })).toEqual({ decision: 'would_send', reasons: [] });
  });
  it('blocks low confidence, requires_human, blocked categories, cap and pauses', () => {
    expect(decideAutoReply({ ...base, draft: { ...draft, confidence: 0.5 } }).reasons[0]).toMatch(/^confidence_0\.50/);
    expect(decideAutoReply({ ...base, draft: { ...draft, requiresHuman: true } }).reasons).toContain('requires_human');
    expect(decideAutoReply({ ...base, draft: { ...draft, category: 'complaint' } }).reasons).toContain('category_complaint_blocked');
    expect(decideAutoReply({ ...base, usedToday: 50 }).reasons).toContain('daily_cap_exceeded');
    expect(decideAutoReply({ ...base, automationPaused: true })).toEqual({ decision: 'blocked', reasons: ['automation_paused'] });
    expect(decideAutoReply({ ...base, autoreplyDisabled: true }).reasons).toEqual(['per_conversation_disabled']);
  });
});

describe('buildReceptionistPrompt', () => {
  it('forbids invented data and asks for the control lines', () => {
    const p = buildReceptionistPrompt({ shopName: 'Taller Ana', customerName: 'Luis', transcript: 'Luis: ¿precio pantalla?', priceList: 'Apple iPhone 13 · Cambio pantalla: desde 109 €' });
    expect(p).toContain('Taller Ana');
    expect(p).toContain('No inventes precios');
    expect(p).toContain('CATEGORY:');
    expect(p).toContain('desde 109 €');
  });
});

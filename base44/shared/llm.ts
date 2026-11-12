// LLM access for the AI receptionist, ported from WhatsApp Inbox Pro's "FREE-LLM drop-in":
// Gemini with the platform's own key when GEMINI_API_KEY is set (no Base44 credits), retried once;
// otherwise Base44's built-in InvokeLLM. Returns '' on failure (degraded), never throws.
export type Llm = (prompt: string, opts?: { temperature?: number }) => Promise<string>;
export type InvokeLLM = (args: { prompt: string }) => Promise<unknown>;

export function makeLlm(secret: (name: string) => string | undefined, invokeBase44: InvokeLLM | null, fetchFn: typeof fetch = fetch): Llm {
  const key = secret('GEMINI_API_KEY');
  const model = secret('GEMINI_MODEL') || 'gemini-2.0-flash';
  return async (prompt, opts = {}) => {
    if (!key) {
      if (!invokeBase44) return '';
      try {
        const r = await invokeBase44({ prompt }) as string | { text?: string; output?: string } | null;
        return String(typeof r === 'string' ? r : r?.text ?? r?.output ?? '').trim();
      } catch { return ''; }
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: opts.temperature ?? 0.3 } });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
        const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('').trim();
        if (text) return text;
      } catch { /* retry once */ }
    }
    return '';
  };
}

/** Base44's built-in InvokeLLM from a request client, if this SDK exposes it. */
export function base44InvokeLLM(client: unknown): InvokeLLM | null {
  const core = (client as { integrations?: { Core?: { InvokeLLM?: InvokeLLM } } })?.integrations?.Core;
  return core?.InvokeLLM ? (args) => core.InvokeLLM!(args) : null;
}

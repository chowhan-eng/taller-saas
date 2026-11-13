// Onboarding actions that need the server. `activateFreeTrial`: the cardless 14-day Starter trial (no Stripe).
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { handleOnboarding } from '../../shared/trial.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('onboardingApi', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = base44.asServiceRole.entities as unknown as Entities;
  const r = await handleOnboarding({ db, user: user ? { id: user.id } : null }, body);
  return json(r.body, r.status);
});

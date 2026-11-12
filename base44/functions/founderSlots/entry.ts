// Public live counter for the landing page and onboarding: «Quedan X de 10 plazas». Counts only.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { founderSeats } from '../../shared/founder.ts';
import type { Entities } from '../../shared/db.ts';

export const config = { public: true };

export default withJsonErrors('founderSlots', async (req) => {
  const db = createClientFromRequest(req).asServiceRole.entities as unknown as Entities;
  return json(await founderSeats(db));
});

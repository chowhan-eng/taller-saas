import { describe, expect, it } from 'vitest';
import { isOptOut } from '../base44/shared/optout.ts';

describe('opt-out keyword (strict BAJA / STOP)', () => {
  it.each(['BAJA', 'baja', 'Baja.', '  stop  ', 'STOP!', 'Bája', '¡Baja!'])('opts out on %j', (t) => expect(isOptOut(t)).toBe(true));
  it.each(['no', 'No.', 'no gracias', 'NO', 'bajar el precio?', 'stop por favor', 'dame de baja', 'darme de baja', 'la pantalla está baja', ''])(
    'does NOT opt out on %j', (t) => expect(isOptOut(t)).toBe(false));
});

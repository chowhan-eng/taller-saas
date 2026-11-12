/**
 * Datos del titular (LSSI art. 10 / RGPD art. 13). Se rellenan en .env.local, nunca en el código.
 * Si falta alguno, `legalLine()` devuelve null y las páginas NO muestran corchetes de plantilla.
 */
export const LEGAL = {
  name: process.env.NEXT_PUBLIC_LEGAL_NAME?.trim() || '',
  cif: process.env.NEXT_PUBLIC_LEGAL_CIF?.trim() || '',
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim() || '',
  email: process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || '',
};

export const legalComplete = () => !!(LEGAL.name && LEGAL.cif && LEGAL.address && LEGAL.email);

export function legalLine(): string | null {
  if (!legalComplete()) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[legal] Faltan NEXT_PUBLIC_LEGAL_* / NEXT_PUBLIC_PRIVACY_EMAIL: obligatorios antes del lanzamiento (LSSI art. 10).');
    }
    return null;
  }
  return `${LEGAL.name} · CIF ${LEGAL.cif} · ${LEGAL.address}`;
}

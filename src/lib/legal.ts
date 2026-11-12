/**
 * Datos del titular (LSSI art. 10 / RGPD art. 13). Se rellenan en .env.local, nunca en el código.
 * Si falta alguno, `legalLine()` devuelve null y las páginas NO muestran corchetes de plantilla.
 */
export const LEGAL = {
  name: import.meta.env.VITE_LEGAL_NAME?.trim() || '',
  cif: import.meta.env.VITE_LEGAL_CIF?.trim() || '',
  address: import.meta.env.VITE_LEGAL_ADDRESS?.trim() || '',
  email: import.meta.env.VITE_PRIVACY_EMAIL?.trim() || '',
};

export const legalComplete = () => !!(LEGAL.name && LEGAL.cif && LEGAL.address && LEGAL.email);

export function legalLine(): string | null {
  if (!legalComplete()) {
    if (import.meta.env.PROD) {
      console.warn('[legal] Faltan VITE_LEGAL_* / VITE_PRIVACY_EMAIL: obligatorios antes del lanzamiento (LSSI art. 10).');
    }
    return null;
  }
  return `${LEGAL.name} · CIF ${LEGAL.cif} · ${LEGAL.address}`;
}

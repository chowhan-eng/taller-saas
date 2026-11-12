#!/usr/bin/env python3
"""
scraper_talleres.py — Prospección de talleres de reparación en España vía Google Places API (New).

NO raspa el HTML de Google Maps (viola sus ToS). Usa la API oficial de pago "Text Search (New)".
Cumplimiento: solo place_id se guarda indefinidamente; el resto se purga a los 30 días
(--purge-older-than 30) y se vuelve a consultar antes de contactar. Revisa los
"Google Maps Platform Service Specific Terms" vigentes.

Este script NO envía mensajes ni marca consentimientos. Solo genera la lista para
visitas en persona, cartas postales y llamadas humanas (ver docs/04 §1.1).

Uso:
  python scraper_talleres.py --provincias "Valencia,Castellón,Alicante" --out leads.csv --check-web
  python scraper_talleres.py --todas --max-pages 2 --out leads_espana.csv
  python scraper_talleres.py --purge-older-than 30 --out leads.csv
Variables (.env): GOOGLE_PLACES_API_KEY, [SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY]
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

PROVINCIAS = [
    "A Coruña", "Álava", "Albacete", "Alicante", "Almería", "Asturias", "Ávila", "Badajoz", "Baleares",
    "Barcelona", "Burgos", "Cáceres", "Cádiz", "Cantabria", "Castellón", "Ceuta", "Ciudad Real", "Córdoba",
    "Cuenca", "Girona", "Granada", "Guadalajara", "Gipuzkoa", "Huelva", "Huesca", "Jaén", "La Rioja",
    "Las Palmas", "León", "Lleida", "Lugo", "Madrid", "Málaga", "Melilla", "Murcia", "Navarra", "Ourense",
    "Palencia", "Pontevedra", "Salamanca", "Santa Cruz de Tenerife", "Segovia", "Sevilla", "Soria",
    "Tarragona", "Teruel", "Toledo", "Valencia", "Valladolid", "Bizkaia", "Zamora", "Zaragoza",
]
TERMINOS = [
    "reparación de móviles", "servicio técnico de móviles", "reparación de consolas",
    "reparación de ordenadores", "reparación de portátiles", "servicio técnico informático",
]
# Cadenas/franquicias: no decide el dueño del local (ajusta la lista)
CADENAS = re.compile(r"\b(phone ?house|media ?markt|fnac|worten|el corte ingl[eé]s|carrefour|movistar|vodafone|orange|"
                     r"yoigo|cex|game|k-tuin|apple store|samsung (store|experience)|mi store|xiaomi store|eurofix)\b", re.I)

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber",
    "places.internationalPhoneNumber", "places.websiteUri", "places.rating", "places.userRatingCount",
    "places.businessStatus", "places.googleMapsUri", "nextPageToken",
])


@dataclass
class Lead:
    place_id: str
    nombre: str
    provincia: str
    direccion: str = ""
    telefono_e164: str = ""
    tipo_telefono: str = ""          # mobile | landline | other | ""
    web: str = ""
    rating: float | None = None
    resenas: int = 0
    web_ok: bool | None = None
    web_https: bool | None = None
    web_menciona_whatsapp: bool | None = None
    pain_score: int = 0
    motivos: list[str] = field(default_factory=list)
    maps_url: str = ""
    fetched_at: str = ""


def normaliza_telefono(raw: str) -> tuple[str, str]:
    """Devuelve (E.164 sin '+', tipo). Móvil español = 6xx/7xx; fijo = 8xx/9xx."""
    d = re.sub(r"\D", "", raw or "")
    if d.startswith("0034"):
        d = d[4:]
    elif d.startswith("34") and len(d) == 11:
        d = d[2:]
    if len(d) != 9:
        return (d, "other") if d else ("", "")
    tipo = "mobile" if d[0] in "67" else "landline" if d[0] in "89" else "other"
    return "34" + d, tipo


def buscar(api_key: str, consulta: str, max_pages: int) -> list[dict]:
    resultados, token, intentos = [], None, 0
    paginas = 0
    while paginas < max_pages:
        body = {"textQuery": consulta, "languageCode": "es", "regionCode": "ES", "pageSize": 20}
        if token:
            body["pageToken"] = token
        r = requests.post(ENDPOINT, json=body, timeout=20,
                          headers={"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": FIELD_MASK})
        if r.status_code == 429 and intentos < 3:
            intentos += 1
            time.sleep(5 * intentos)
            continue
        r.raise_for_status()
        data = r.json()
        resultados.extend(data.get("places", []))
        paginas += 1
        token = data.get("nextPageToken")
        if not token:
            break
        time.sleep(1.5)  # el token tarda en activarse
    return resultados


def revisa_web(url: str) -> tuple[bool, bool, bool]:
    """(responde_rapido, https, menciona_whatsapp). Una sola petición GET, timeout 3 s, sin ejecutar JS."""
    try:
        t0 = time.monotonic()
        r = requests.get(url, timeout=3, allow_redirects=True,
                         headers={"User-Agent": "Mozilla/5.0 (compatible; TallerSaaS-prospeccion/1.0)"})
        rapido = r.ok and (time.monotonic() - t0) < 3
        https = r.url.startswith("https://")
        html = r.text[:400_000].lower()
        wa = ("wa.me/" in html) or ("api.whatsapp.com" in html) or ("whatsapp" in html)
        return rapido, https, wa
    except requests.RequestException:
        return False, url.startswith("https://"), False


def puntua(lead: Lead) -> None:
    s, m = 0, []
    if lead.resenas < 20:
        s += 30; m.append("<20 reseñas")
    elif lead.resenas < 50:
        s += 25; m.append("<50 reseñas")
    if lead.rating is not None and lead.rating < 4.3:
        s += 10; m.append(f"rating {lead.rating}")
    if not lead.web:
        s += 20; m.append("sin web")
    else:
        if lead.web_ok is False or lead.web_https is False:
            s += 10; m.append("web lenta/sin https")
        if lead.web_menciona_whatsapp is False:
            s += 10; m.append("web sin WhatsApp")
    if lead.tipo_telefono == "mobile":
        s += 10; m.append("tel. móvil (autónomo probable)")
    if CADENAS.search(lead.nombre):
        s -= 40; m.append("cadena/franquicia")
    lead.pain_score = max(0, min(100, s))
    lead.motivos = m


def a_lead(p: dict, provincia: str) -> Lead | None:
    if p.get("businessStatus") not in (None, "OPERATIONAL"):
        return None
    tel_raw = p.get("internationalPhoneNumber") or p.get("nationalPhoneNumber") or ""
    tel, tipo = normaliza_telefono(tel_raw)
    return Lead(
        place_id=p["id"], nombre=(p.get("displayName") or {}).get("text", ""), provincia=provincia,
        direccion=p.get("formattedAddress", ""), telefono_e164=tel, tipo_telefono=tipo,
        web=p.get("websiteUri", "") or "", rating=p.get("rating"), resenas=int(p.get("userRatingCount") or 0),
        maps_url=p.get("googleMapsUri", ""), fetched_at=datetime.now(timezone.utc).isoformat(),
    )


def upsert_supabase(leads: list[Lead]) -> None:
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        return
    rows = [{
        "source": "places_api", "google_place_id": l.place_id, "shop_name": l.nombre, "province": l.provincia,
        "phone_e164": l.telefono_e164 or None, "phone_kind": l.tipo_telefono or None, "website": l.web or None,
        "google_rating": l.rating, "google_reviews": l.resenas, "pain_score": l.pain_score,
        "notes": "; ".join(l.motivos),
        # Ningún consentimiento se marca aquí. NUNCA.
    } for l in leads]
    for i in range(0, len(rows), 200):
        r = requests.post(f"{url}/rest/v1/leads?on_conflict=google_place_id", json=rows[i:i + 200], timeout=30,
                          headers={"apikey": key, "Authorization": f"Bearer {key}",
                                   "Content-Type": "application/json",
                                   "Prefer": "resolution=merge-duplicates,return=minimal"})
        if r.status_code >= 300:
            print(f"[supabase] error {r.status_code}: {r.text[:200]}", file=sys.stderr)


def escribe_csv(path: str, filas: list[dict], campos) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as f:  # utf-8-sig: Excel en español lo abre bien
        w = csv.DictWriter(f, fieldnames=list(campos), delimiter=";")
        w.writeheader()
        w.writerows(filas)


def purga_csv(path: str, dias: int) -> None:
    """Cumplimiento ToS: vacía campos de contenido de Places con más de N días; conserva place_id + score."""
    if not os.path.exists(path):
        print("No existe", path)
        return
    limite = datetime.now(timezone.utc) - timedelta(days=dias)
    with open(path, newline="", encoding="utf-8-sig") as f:
        filas = list(csv.DictReader(f, delimiter=";"))
    n = 0
    for fila in filas:
        try:
            if datetime.fromisoformat(fila["fetched_at"]) < limite:
                for k in ("nombre", "direccion", "telefono_e164", "web", "rating", "resenas", "maps_url"):
                    fila[k] = ""
                n += 1
        except (KeyError, ValueError):
            pass
    if filas:
        escribe_csv(path, filas, filas[0].keys())
    print(f"Purgadas {n} filas con más de {dias} días en {path}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provincias", help="Lista separada por comas")
    ap.add_argument("--todas", action="store_true", help="Las 52 provincias")
    ap.add_argument("--max-pages", type=int, default=3, help="Páginas de 20 resultados por consulta (máx 3)")
    ap.add_argument("--check-web", action="store_true", help="Comprueba velocidad/https/WhatsApp de cada web")
    ap.add_argument("--min-score", type=int, default=0)
    ap.add_argument("--out", default="leads_talleres.csv")
    ap.add_argument("--purge-older-than", type=int, help="Solo purga el CSV indicado en --out y sale")
    a = ap.parse_args()

    if a.purge_older_than:
        purga_csv(a.out, a.purge_older_than)
        return

    api_key = os.getenv("GOOGLE_PLACES_API_KEY")
    if not api_key:
        sys.exit("Falta GOOGLE_PLACES_API_KEY en .env (Google Cloud → Places API (New); pon un límite de presupuesto)")
    provincias = PROVINCIAS if a.todas else [p.strip() for p in (a.provincias or "").split(",") if p.strip()]
    if not provincias:
        sys.exit("Indica --provincias o --todas")

    vistos: dict[str, Lead] = {}
    for prov in provincias:
        for term in TERMINOS:
            for p in buscar(api_key, f"{term} en {prov}, España", min(a.max_pages, 3)):
                if p["id"] not in vistos and (lead := a_lead(p, prov)):
                    vistos[p["id"]] = lead
            print(f"[{prov}] {term}: total acumulado {len(vistos)}", file=sys.stderr)

    leads = list(vistos.values())
    for i, l in enumerate(leads, 1):
        if a.check_web and l.web:
            l.web_ok, l.web_https, l.web_menciona_whatsapp = revisa_web(l.web)
            if i % 25 == 0:
                print(f"  webs revisadas: {i}/{len(leads)}", file=sys.stderr)
        puntua(l)

    leads = sorted((l for l in leads if l.pain_score >= a.min_score), key=lambda x: -x.pain_score)
    campos = list(asdict(Lead("", "", "")).keys())
    filas = [{**asdict(l), "motivos": "; ".join(l.motivos)} for l in leads]
    escribe_csv(a.out, filas, campos)
    upsert_supabase(leads)

    moviles = sum(l.tipo_telefono == "mobile" for l in leads)
    fijos = sum(l.tipo_telefono == "landline" for l in leads)
    print(f"\n✔ {len(leads)} talleres → {a.out}  (móviles 6xx/7xx: {moviles} · fijos 8xx/9xx: {fijos})")
    print("Recordatorio: esta lista es para VISITAS, CARTAS y LLAMADAS HUMANAS. No envíes WhatsApp/email en frío.")


if __name__ == "__main__":
    main()

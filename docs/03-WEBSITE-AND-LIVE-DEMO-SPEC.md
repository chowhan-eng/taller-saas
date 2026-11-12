# 03 — Web comercial + Simulador de WhatsApp en vivo ("Caballo de Troya")

> **Objetivo de la web:** que el dueño de un taller pruebe el producto en su propio móvil en 5 segundos y pague con garantía de 30 días.
> **Restricciones del consejo (doc 01):**
> - Sin plan gratuito.
> - El WhatsApp de demo solo sale si el visitante lo pide (casilla clara).
> - La llamada de seguimiento solo se hace con **otra casilla, desmarcada por defecto** (LGT 11/2022 art. 66).
> - No inventamos testimonios ni cifras: hasta tener clientes, la prueba social es **tu taller real**.

---

## 1. Estructura de la página (una sola landing, de arriba abajo)

1. **Hero** + simulador (above the fold en el móvil)
2. "El problema" (3 dolores del mostrador)
3. Cómo funciona (3 pasos)
4. Calculadora de ROI
5. Qué incluye cada plan + precio Fundador
6. Quién está detrás (tu historia + fotos reales de tu taller)
7. FAQ que tumba objeciones
8. CTA final + garantía

Diseño: fondo claro, verde WhatsApp solo en los CTA y una tipografía sólida (Inter / Plus Jakarta Sans). Fotos **reales** de tu mostrador, nada de bancos de imágenes. Velocidad: < 1 s LCP (página estática en Vercel, simulador cargado bajo demanda).

---

## 2. Copy completo en español

### 2.1 Hero
> **Etiqueta superior:** Creado por un técnico con más de 20 años de taller en Valencia, para otros talleres.
>
> # Deja de contestar "¿Ya está mi móvil?"
> ### Tus clientes reciben un WhatsApp automático cuando su reparación entra, tiene presupuesto y está lista. Y al recogerla, les pedimos la reseña de Google por ti.
>
> **[ Pruébalo en tu móvil ahora → ]** (abre el simulador)
> <sub>Sin instalar nada · Sin tarjeta para la prueba · 5 segundos</sub>
>
> ✔ Resguardo e impresión de etiquetas 58/80 mm · ✔ Avisos de WhatsApp con el número de TU taller · ✔ Recordatorio de reseñas · ✔ Garantía de 30 días

### 2.2 Simulador (bloque junto al hero)
> **Recibe ahora el aviso que recibirían tus clientes**
> Tu móvil: [ +34 | 6__ ___ ___ ]
> Nombre de tu taller: [ ____________ ] *(sale en el mensaje)*
> ☐ **Quiero recibir un único WhatsApp de demostración en este número.** *(obligatoria)*
> ☐ Acepto que me llamen para enseñarme el programa (opcional; una persona o un asistente de voz con IA identificado como tal).
> **[ Enviarme el WhatsApp de prueba ]**
> <sub>Usamos tu número solo para esta demo y, si marcas la segunda casilla, para una llamada. Puedes oponerte en cualquier momento. [Política de privacidad]</sub>

Tras el envío:
> 📲 **Mira tu WhatsApp.** Así lo verá tu cliente cuando su iPhone esté listo.
> ¿Te imaginas no tener que coger el teléfono para esto nunca más?
> **[ Quiero esto en mi taller: precio Fundador €29/mes ]**

### 2.3 El problema
> **Si tienes un taller, esto te suena:**
> - 📞 **El teléfono suena 20 veces al día** para preguntar "¿cómo va lo mío?", y cada llamada te saca de la placa que estabas soldando.
> - 🗂️ **Resguardos a mano o en un Excel** que nadie encuentra cuando el cliente vuelve por garantía.
> - ⭐ **Clientes contentos que se van sin dejar reseña**, mientras la cadena de la esquina tiene 3.000.

### 2.4 Cómo funciona
> **1. Das de alta la reparación en 30 segundos.** Teléfono, modelo y avería. Imprime el resguardo y la etiqueta.
> **2. Cambias el estado con un toque.** "Presupuesto", "Listo para recoger"… y tu cliente recibe el WhatsApp **desde el número de tu taller**.
> **3. Al entregar, pedimos la reseña por ti.** 24 horas después, con un enlace directo a tu ficha de Google.

### 2.5 Quién está detrás
> **Hola, soy [Nombre].** Llevo desde 2003 detrás del mostrador de Informática Torrent, en Valencia: móviles, consolas, portátiles, microsoldadura. Más de 1.800 reseñas en Google.
> Este programa lo hice para mi propio taller, porque ninguno de los que probé estaba pensado para cómo trabajamos de verdad: con prisa, con el cliente delante y con el soldador encendido.
> Ahora lo abro a otros talleres. Sin permanencia. Si en 30 días no te ahorra tiempo, te devuelvo el dinero.
> *[Foto real tuya en el mostrador]* *[Enlace a la ficha de Google de tu taller]*

> ⚠️ Cuando tengas clientes, añade aquí **testimonios reales con nombre y permiso por escrito**. Nunca uses testimonios inventados (además de poco ético, es publicidad engañosa).

### 2.6 Planes
| | **Starter** | **Pro** *(muy pronto)* |
|---|---|---|
| Precio Fundador (20 plazas) | **€29/mes** para siempre | €59/mes |
| Precio normal | €39/mes · €390/año | €79/mes · €790/año |
| Resguardos + etiquetas 58/80 mm | ✔ | ✔ |
| Avisos de WhatsApp automáticos | ✔ (400 conversaciones/mes) | ✔ (1.000) |
| Recordatorio de reseñas Google | ✔ | ✔ |
| Técnicos, garantías e informes | — | ✔ |
| Asistente IA de WhatsApp 24/7 (precios y estado) | — | ✔ |
| TPV + Cierre de caja + facturación Verifactu | — | ✔ |
| **Instalación Llave en Mano** (te lo dejamos funcionando por AnyDesk) | €149 · gratis en plan anual | incluida en el anual |

> "Pro" se muestra como **lista de espera** ("Avísame cuando esté") hasta que pase las puertas del doc 01. No se cobra por algo que no existe.

### 2.7 FAQ (objeciones reales del gremio)
**¿Tengo que cambiar mi número de WhatsApp?**
No. Con la conexión oficial de Meta puedes **seguir usando WhatsApp Business en el móvil del taller** y los avisos salen desde ese mismo número. Si lo prefieres, también puedes usar un número nuevo solo para avisos.

**¿Me pueden bloquear WhatsApp?**
Usamos la **API oficial de Meta**, no apps piratas que escanean el QR. Solo enviamos avisos a clientes que han aceptado recibirlos en el resguardo, y la palabra BAJA los da de baja al momento. Además, el sistema se frena solo si detecta un problema de calidad.

**¿Cuánto cuesta cada mensaje?**
Incluimos 400 conversaciones al mes en Starter, de sobra para un taller de unas 150 reparaciones mensuales. Si te pasas, pagas el coste de Meta más un pequeño margen, y te avisamos antes.

**No soy informático… bueno, sí, pero no tengo tiempo.**
El alta dura un minuto. Si te atascas, la **Instalación Llave en Mano** lo deja todo funcionando en una videollamada de 60 minutos.

**¿Sirve con mi impresora térmica?**
Sí, si es de 58 u 80 mm (Epson, Xprinter, Star, la típica china USB…). En el alta imprimes un ticket de prueba para comprobarlo.

**¿Hace facturas? ¿Y Verifactu?**
Starter **no factura**: genera resguardos de depósito, que no son facturas, así que puedes seguir con tu programa de facturación o tu gestoría. El TPV con facturación Verifactu llegará en Pro, conectado a un proveedor certificado.

**¿Mis datos y los de mis clientes?**
Servidores en la Unión Europea. Firmamos contigo el contrato de **Encargado del Tratamiento** (RGPD art. 28). Tus datos son tuyos: los exportas en un clic cuando quieras.

**¿Permanencia?**
Ninguna. Te das de baja desde el panel. Y si en los primeros 30 días no te convence, **te devolvemos el dinero**.

**Ya uso otro programa de taller.**
Si solo quieres los avisos y las reseñas, puedes importar tus clientes desde un CSV. Muchos talleres empiezan así y se pasan del todo cuando ven que es más rápido.

### 2.8 CTA final
> # Tu próximo cliente puede recibir su aviso hoy mismo.
> **[ Empezar con precio Fundador: €29/mes ]** · Garantía de 30 días · Sin permanencia
> <sub>Quedan **X** de 20 plazas Fundador.</sub> *(contador real, leído de la base de datos; nunca un número falso)*

---

## 3. Calculadora de ROI (interactiva)

**Entradas** (sliders con valores por defecto):
| Campo | Por defecto | Rango |
|---|---|---|
| Reparaciones al mes | 120 | 20–600 |
| Llamadas "¿ya está?" por reparación | 1,5 | 0–4 |
| Minutos perdidos por llamada (contestar + buscar + volver al trabajo) | 3 | 1–10 |
| Valor de tu hora (€) | 25 | 10–60 |
| Reseñas nuevas al mes ahora | 3 | 0–50 |

**Fórmulas** (honestas, los supuestos se muestran en pantalla):
```js
const callsAvoided   = repairs * callsPerRepair * 0.6;           // supuesto: el aviso evita el 60 % de las llamadas
const hoursSaved     = callsAvoided * minutesPerCall / 60;
const moneySaved     = hoursSaved * hourValue;
const reviewRequests = repairs * 0.5;                             // supuesto: el 50 % acepta que le pidan reseña
const extraReviews   = Math.round(reviewRequests * 0.15);         // supuesto: el 15 % la deja
const planCost       = 39;
const roi            = moneySaved / planCost;
```
**Salida:**
> Con **120 reparaciones**, te ahorras unas **108 llamadas** y **5,4 horas al mes** (≈ **€135**).
> Podrías sumar unas **9 reseñas nuevas al mes**.
> Starter cuesta €39 → **retorno ≈ 3,5×**.
> <sub>Son estimaciones con los supuestos mostrados; cada taller es distinto.</sub>

**Validación pendiente:** mide en tu propio taller durante 30 días cuántas llamadas "¿ya está?" recibes con y sin avisos, y sustituye el 60 % por tu dato real. Tu dato vende más que cualquier supuesto.

---

## 4. Simulador de WhatsApp en 5 segundos: backend

### 4.1 Requisitos previos
- **WABA propia de la plataforma** (tu SL), con un número dedicado a la demo (p. ej. un móvil prepago nuevo o un número virtual registrado en Cloud API).
- Plantilla **`demo_taller_listo`** (categoría **utility**, idioma `es`), aprobada:
  > ¡Hola! 👋 Esto es una demo de *{{1}}*. Así recibirá tu cliente el aviso: "Tu *iPhone 13* ya está reparado y listo para recoger. Resguardo *2026-000123*." Lo has pedido en tallersaas.es. Responde *INFO* para que te contemos más o *BAJA* para no recibir nada más.

  > Si Meta clasifica esta plantilla como marketing, se acepta: cuesta unos céntimos más.
- **Cloudflare Turnstile** (gratis) en el formulario.

### 4.2 Flujo (secuencia)
```
Navegador            Edge Fn demo-whatsapp              Supabase                 Meta Cloud API      Slack/WA fundador
   │ POST {phone, shop, consentDemo, consentCall, turnstileToken}
   │──────────────────────▶│
   │                       │ 1 verificar Turnstile (siteverify)
   │                       │ 2 validar consentDemo === true
   │                       │ 3 normalizar +34; exigir móvil 6xx/7xx (9 dígitos)
   │                       │ 4 rate limit: ≤1 por teléfono/24h, ≤3 por IP/h, ≤200 global/día
   │                       │──────── select demo_requests ────▶│
   │                       │ 5 upsert lead (source=web_simulator, stage=hot, consentimientos+versión+IP+fecha)
   │                       │──────── insert demo_requests ────▶│
   │                       │ 6 POST /{DEMO_PHONE_ID}/messages template demo_taller_listo [shop]
   │                       │────────────────────────────────────────────────▶│
   │ ◀── 200 {ok:true} ─────│ (respuesta inmediata; envío en <2 s)
   │                       │ 7 notificar al fundador: "🔥 Lead caliente: Taller X, +34 6.., llamada: sí/no"
   │                       │──────────────────────────────────────────────────────────────────▶│
   │                       │ 8 si consentCall: programar voice_callback (now()+5 min) — ver doc 04
```

### 4.3 Edge Function `supabase/functions/demo-whatsapp/index.ts` (esqueleto)
```ts
import { createClient } from 'npm:@supabase/supabase-js@2';

const CONSENT_VERSION = 'demo-v1-2026-11';
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = { 'Access-Control-Allow-Origin': 'https://tallersaas.es', 'Access-Control-Allow-Headers': 'content-type' };

function esMobile(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('0034')) d = d.slice(4); else if (d.startsWith('34') && d.length === 11) d = d.slice(2);
  return /^[67]\d{8}$/.test(d) ? '34' + d : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '0.0.0.0';
  const { phone, shop, consentDemo, consentCall, turnstileToken } = await req.json();

  // 1. Turnstile
  const ts = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: Deno.env.get('TURNSTILE_SECRET')!, response: turnstileToken, remoteip: ip }),
  }).then(r => r.json());
  if (!ts.success) return json({ ok: false, error: 'captcha' }, 400);

  // 2-3. Consentimiento y número
  if (consentDemo !== true) return json({ ok: false, error: 'consent' }, 400);
  const to = esMobile(String(phone ?? ''));
  if (!to) return json({ ok: false, error: 'Introduce un móvil español (6xx o 7xx)' }, 400);
  const shopName = String(shop ?? '').trim().slice(0, 40) || 'tu taller';

  // 4. Rate limits
  const since24h = new Date(Date.now() - 864e5).toISOString();
  const since1h  = new Date(Date.now() - 36e5).toISOString();
  const [{ count: byPhone }, { count: byIp }] = await Promise.all([
    sb.from('demo_requests').select('*', { count: 'exact', head: true }).eq('phone_e164', to).gte('created_at', since24h),
    sb.from('demo_requests').select('*', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since1h),
  ]);
  if ((byPhone ?? 0) >= 1) return json({ ok: true, note: 'Ya te lo enviamos hoy: mira tu WhatsApp 😉' });
  if ((byIp ?? 0) >= 3)   return json({ ok: false, error: 'Demasiados intentos' }, 429);

  // 5. Lead caliente con registro de consentimiento
  const now = new Date().toISOString();
  const { data: lead } = await sb.from('leads').upsert({
    phone_e164: to, phone_kind: 'mobile', shop_name: shopName, source: 'web_simulator', stage: 'hot',
    consent_whatsapp_demo: true, consent_commercial_call: consentCall === true,
    consent_text_version: CONSENT_VERSION, consent_at: now, consent_ip: ip,
  }, { onConflict: 'phone_e164' }).select('id').single();

  const { data: dr } = await sb.from('demo_requests')
    .insert({ lead_id: lead?.id, phone_e164: to, ip, user_agent: req.headers.get('user-agent'), turnstile_ok: true })
    .select('id').single();

  // 6. Envío por Meta
  const r = await fetch(`https://graph.facebook.com/v23.0/${Deno.env.get('DEMO_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('DEMO_WA_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: 'demo_taller_listo', language: { code: 'es' },
                  components: [{ type: 'body', parameters: [{ type: 'text', text: shopName }] }] },
    }),
  }).then(r => r.json());
  await sb.from('demo_requests')
    .update({ wa_message_id: r?.messages?.[0]?.id ?? null, status: r?.messages ? 'sent' : 'failed' })
    .eq('id', dr!.id);

  // 7. Aviso al fundador (Slack/Telegram webhook, gratis)
  fetch(Deno.env.get('FOUNDER_ALERT_WEBHOOK')!, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `🔥 Demo: ${shopName} · +${to} · llamada: ${consentCall ? 'SÍ' : 'no'}` }),
  }).catch(() => {});

  // 8. Callback de voz SOLO con consentimiento explícito (doc 04 §4)
  if (consentCall === true) {
    await sb.rpc('schedule_voice_callback', { p_lead: lead!.id, p_delay_minutes: 5 }).catch(() => {});
  }
  return json({ ok: !!r?.messages });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
```
> `schedule_voice_callback` está definida en la migración `002_sales_engine.sql` (doc 04).

### 4.4 Qué pasa cuando el lead responde en WhatsApp
El webhook de la WABA de demo recibe la respuesta del visitante. Eso **abre la ventana de servicio de 24 h**, así que puedes contestarle gratis con texto libre:
- **"INFO"** → respuesta automática con el vídeo de 90 s y el enlace de pago Fundador + "¿Prefieres que te llame? Responde LLAMADA".
- **"LLAMADA"** → consentimiento de llamada (`consent_commercial_call = true`, `consent_source = 'whatsapp'`) → callback de voz.
- **"BAJA"** → `do_not_contact = true`.
- Cualquier otro texto → al móvil del fundador (bandeja WhatsApp Pro o Telegram).

### 4.5 Medición
Eventos (Plausible o PostHog, sin cookies → sin banner): `sim_view`, `sim_submit`, `sim_delivered` (webhook), `checkout_start`, `checkout_paid`.
**Objetivos iniciales:** visita → envío ≥ 15 % · envío → pago ≥ 8 %.

### 4.6 Abuso y coste
- El tope global de 200 demos al día limita el gasto a unos €5/día como máximo.
- Si alguien envía demos a números de terceros: la plantilla dice "lo has pedido en tallersaas.es", es **un único** mensaje y BAJA funciona → riesgo bajo. Bloquea prefijos premium y números ya marcados como `do_not_contact`.

// Product illustrations drawn inline (no external images, so nothing can break): the 3-pane WhatsApp AI inbox,
// the Reparo auto-quoter comparing suppliers, and the TPV with the CashDro payment. Sample data only.
const F = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export function InboxMockup() {
  return (
    <svg viewBox="0 0 640 400" role="img" aria-label="Bandeja de WhatsApp con IA: lista de conversaciones, chat con borrador de la IA y ficha del cliente" style={{ width: '100%', height: 'auto', fontFamily: F }}>
      <title>Bandeja de WhatsApp con recepcionista IA</title>
      <rect width="640" height="400" rx="14" fill="#0b141a" />
      <rect width="640" height="30" rx="14" fill="#202c33" /><rect y="16" width="640" height="14" fill="#202c33" />
      <circle cx="18" cy="15" r="4.5" fill="#ff5f57" /><circle cx="34" cy="15" r="4.5" fill="#febc2e" /><circle cx="50" cy="15" r="4.5" fill="#28c840" />
      <text x="320" y="19" textAnchor="middle" fontSize="10" fill="#8696a0">WhatsApp Pro · Bandeja</text>
      {/* left list */}
      <rect y="30" width="190" height="370" fill="#111b21" />
      <rect x="10" y="40" width="170" height="22" rx="11" fill="#202c33" /><text x="24" y="55" fontSize="9" fill="#8696a0">Buscar nombre, teléfono…</text>
      {[['Luis G.', 'Ya está mi iPhone?', '3', '2 h 10', '#25d366'], ['María P.', 'Gracias, paso hoy', '', '21 h', '#25d366'], ['Carlos R.', 'Cuánto cuesta la batería', '1', '40 min', '#f59e0b']].map(([n, m, b, w, c], i) => (
        <g key={n} transform={`translate(0 ${72 + i * 62})`}>
          {i === 0 && <rect width="190" height="60" fill="#202c33" />}
          <circle cx="26" cy="30" r="15" fill="#2a3942" /><text x="26" y="34" textAnchor="middle" fontSize="11" fontWeight="700" fill="#e9edef">{n[0]}</text>
          <text x="50" y="24" fontSize="11" fontWeight="600" fill="#e9edef">{n}</text>
          <text x="50" y="39" fontSize="9" fill="#8696a0">{m}</text>
          <rect x="50" y="46" width="44" height="10" rx="3" fill={c} fillOpacity=".2" /><text x="72" y="54" textAnchor="middle" fontSize="7" fontWeight="700" fill={c}>{w}</text>
          {b && <><circle cx="172" cy="24" r="8" fill="#25d366" /><text x="172" y="27" textAnchor="middle" fontSize="9" fontWeight="700" fill="#0b141a">{b}</text></>}
        </g>
      ))}
      {/* chat */}
      <rect x="190" y="30" width="270" height="36" fill="#202c33" /><circle cx="214" cy="48" r="12" fill="#2a3942" /><text x="214" y="52" textAnchor="middle" fontSize="10" fontWeight="700" fill="#e9edef">L</text>
      <text x="234" y="46" fontSize="11" fontWeight="600" fill="#e9edef">Luis G.</text><text x="234" y="58" fontSize="8" fill="#8696a0">+34 612 345 678</text>
      <rect x="388" y="40" width="64" height="16" rx="8" fill="#25d366" fillOpacity=".2" /><text x="420" y="51" textAnchor="middle" fontSize="8" fontWeight="700" fill="#6ee7a1">Ventana 2 h 10</text>
      <rect x="202" y="78" width="150" height="34" rx="8" fill="#202c33" /><text x="212" y="93" fontSize="9.5" fill="#e9edef">Buenas, ¿ya está mi iPhone 13?</text><text x="212" y="105" fontSize="7" fill="#8696a0">10:42</text>
      <rect x="258" y="122" width="190" height="46" rx="8" fill="#005c4b" /><text x="268" y="137" fontSize="9.5" fill="#e9edef">Hola Luis, tu iPhone 13 está listo para</text><text x="268" y="149" fontSize="9.5" fill="#e9edef">recoger. Te esperamos hasta las 20:30.</text>
      <text x="418" y="161" fontSize="7" fill="#8696a0">10:44</text><path d="M428 158l3 3 6-7M434 158l3 3 6-7" stroke="#53bdeb" strokeWidth="1.3" fill="none" />
      <rect x="202" y="178" width="150" height="34" rx="8" fill="#202c33" /><text x="212" y="193" fontSize="9.5" fill="#e9edef">¿Aceptáis tarjeta?</text><text x="212" y="205" fontSize="7" fill="#8696a0">10:45</text>
      {/* AI draft banner */}
      <rect x="196" y="222" width="258" height="104" rx="10" fill="#2e1065" fillOpacity=".55" stroke="#8b5cf6" strokeOpacity=".6" />
      <text x="208" y="239" fontSize="9.5" fontWeight="700" fill="#c4b5fd">✦ Borrador de la IA</text>
      <rect x="318" y="228" width="72" height="15" rx="7" fill="#10b981" fillOpacity=".22" /><text x="354" y="239" textAnchor="middle" fontSize="8" fontWeight="700" fill="#6ee7b7">Confianza 94 %</text>
      <rect x="396" y="228" width="48" height="15" rx="7" fill="#334155" /><text x="420" y="239" textAnchor="middle" fontSize="8" fill="#cbd5e1">pricing</text>
      <text x="208" y="258" fontSize="9.5" fill="#e9edef">Sí, aceptamos tarjeta, efectivo y Bizum.</text><text x="208" y="271" fontSize="9.5" fill="#e9edef">Abrimos de 10:00 a 14:00 y de 17:00 a 20:30.</text>
      <rect x="208" y="284" width="104" height="26" rx="7" fill="#25d366" /><text x="260" y="301" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#0b141a">Aprobar y enviar</text>
      <rect x="320" y="284" width="48" height="26" rx="7" fill="#2a3942" /><text x="344" y="301" textAnchor="middle" fontSize="9" fill="#e9edef">Editar</text>
      <rect x="374" y="284" width="64" height="26" rx="7" fill="#2a3942" /><text x="406" y="301" textAnchor="middle" fontSize="9" fill="#e9edef">Descartar</text>
      <rect x="196" y="350" width="214" height="30" rx="15" fill="#202c33" /><text x="212" y="369" fontSize="9" fill="#8696a0">Escribe un mensaje…</text><circle cx="432" cy="365" r="14" fill="#25d366" /><path d="M426 365h12m-5-5l5 5-5 5" stroke="#0b141a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {/* right context */}
      <rect x="460" y="30" width="180" height="370" fill="#111b21" />
      <circle cx="550" cy="76" r="22" fill="#2a3942" /><text x="550" y="82" textAnchor="middle" fontSize="16" fontWeight="700" fill="#e9edef">L</text>
      <text x="550" y="116" textAnchor="middle" fontSize="12" fontWeight="600" fill="#e9edef">Luis Gómez</text><text x="550" y="130" textAnchor="middle" fontSize="9" fill="#8696a0">+34 612 345 678</text>
      <text x="474" y="158" fontSize="8" fontWeight="700" fill="#8696a0">REPARACIONES</text>
      <rect x="472" y="166" width="156" height="44" rx="8" fill="#202c33" /><text x="482" y="182" fontSize="9.5" fontWeight="700" fill="#e9edef">2026-000123</text>
      <rect x="548" y="173" width="70" height="14" rx="7" fill="#65a30d" /><text x="583" y="183" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff">Listo recoger</text>
      <text x="482" y="199" fontSize="8.5" fill="#8696a0">iPhone 13 · 89,90 €</text>
      <text x="474" y="232" fontSize="8" fontWeight="700" fill="#8696a0">RECEPCIONISTA IA</text>
      <rect x="472" y="240" width="156" height="58" rx="8" fill="#202c33" /><text x="482" y="256" fontSize="9" fill="#e9edef">Confianza</text><text x="618" y="256" textAnchor="end" fontSize="9" fontWeight="700" fill="#e9edef">94 %</text>
      <rect x="482" y="263" width="136" height="5" rx="2.5" fill="#2a3942" /><rect x="482" y="263" width="128" height="5" rx="2.5" fill="#25d366" />
      <text x="482" y="286" fontSize="8.5" fill="#8696a0">Modo: Activo · 12 respuestas hoy</text>
    </svg>
  );
}

export function QuoterMockup() {
  const col = (x: number, name: string, cost: string, pvp: string, extra: string[], best: boolean, note?: string) => (
    <g transform={`translate(${x} 100)`}>
      <rect width="190" height="226" rx="10" fill="#fff" stroke={best ? '#10b981' : '#e2e2e3'} strokeWidth={best ? 2.5 : 1} />
      <text x="14" y="26" fontSize="12" fontWeight="700" fill="#111">{name}</text>
      {best && <><rect x="112" y="12" width="66" height="18" rx="9" fill="#10b981" /><text x="145" y="25" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff">Mejor precio</text></>}
      <text x="14" y="52" fontSize="8.5" fill="#6b7280">Coste sin IVA</text><text x="176" y="52" textAnchor="end" fontSize="13" fontWeight="700" fill="#111">{cost}</text>
      {note && <text x="14" y="68" fontSize="8" fill="#b45309">{note}</text>}
      {[['Pieza + margen (45 %)', extra[0]], ['Mano de obra', '25,00 €'], ['Base imponible', extra[1]], ['IVA 21 %', extra[2]]].map(([k, v], i) => (
        <g key={k} transform={`translate(0 ${92 + i * 20})`}><text x="14" y="0" fontSize="9" fill="#6b7280">{k}</text><text x="176" y="0" textAnchor="end" fontSize="9.5" fill="#111">{v}</text></g>
      ))}
      <line x1="14" y1="178" x2="176" y2="178" stroke="#e2e2e3" /><text x="14" y="200" fontSize="11" fontWeight="700" fill="#111">PVP</text><text x="176" y="202" textAnchor="end" fontSize="17" fontWeight="800" fill="#265b97">{pvp}</text>
      <rect x="14" y="209" width="12" height="12" rx="3" fill={best ? '#265b97' : '#fff'} stroke="#265b97" />{best && <path d="M17 215l2.5 2.5 4-5" stroke="#fff" strokeWidth="1.6" fill="none" />}
      <text x="32" y="219" fontSize="8.5" fill="#6b7280">Ofrecer al cliente</text>
    </g>
  );
  return (
    <svg viewBox="0 0 640 400" role="img" aria-label="Presupuestador de Reparo comparando Androgeek, SpainSellers y MuchoRepuesto con alerta de cambio de precio" style={{ width: '100%', height: 'auto', fontFamily: F }}>
      <title>Presupuestador con comparación de proveedores</title>
      <rect width="640" height="400" rx="14" fill="#f4f4f5" />
      <rect width="640" height="48" rx="14" fill="#fff" /><rect y="30" width="640" height="18" fill="#fff" /><line x1="0" y1="48" x2="640" y2="48" stroke="#e2e2e3" />
      <text x="20" y="30" fontSize="14" fontWeight="700" fill="#111">Presupuestar · 2026-000123</text>
      <rect x="450" y="15" width="170" height="20" rx="10" fill="#265b97" fillOpacity=".12" /><text x="535" y="29" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#265b97">iPhone 13 · Cambio de pantalla</text>
      <rect x="20" y="60" width="600" height="28" rx="8" fill="#fef3c7" stroke="#f59e0b" strokeOpacity=".5" /><text x="32" y="78" fontSize="9.5" fill="#92400e">⚠  Androgeek: la pantalla sube de 37,50 € a 39,65 € desde la última vez que presupuestaste esta pieza</text>
      {col(20, 'Androgeek', '39,65 €', '109,90 €', ['57,49 €', '90,82 €', '19,08 €'], true, 'Precio de distribuidor · sin IVA')}
      {col(225, 'SpainSellers', '44,20 €', '118,90 €', ['64,09 €', '98,26 €', '20,64 €'], false, 'Estimado −20 % (sin sesión)')}
      <g transform="translate(430 100)">
        <rect width="190" height="226" rx="10" fill="#fff" stroke="#e2e2e3" strokeDasharray="5 4" />
        <text x="14" y="26" fontSize="12" fontWeight="700" fill="#111">MuchoRepuesto</text>
        <text x="14" y="56" fontSize="9" fill="#6b7280">Su web no permite consultas</text><text x="14" y="69" fontSize="9" fill="#6b7280">automáticas.</text>
        <rect x="14" y="86" width="162" height="26" rx="8" fill="#265b97" /><text x="95" y="103" textAnchor="middle" fontSize="10" fontWeight="600" fill="#fff">Abrir su web ↗</text>
        <text x="14" y="138" fontSize="9" fill="#6b7280">Apunta el precio a mano y lo</text><text x="14" y="151" fontSize="9" fill="#6b7280">recordamos para la próxima vez.</text>
        <rect x="14" y="170" width="162" height="26" rx="8" fill="#fff" stroke="#d2d2d4" /><text x="24" y="187" fontSize="9.5" fill="#9ca3af">Coste €</text>
      </g>
      <rect x="20" y="342" width="600" height="40" rx="10" fill="#fff" stroke="#e2e2e3" /><text x="36" y="366" fontSize="10" fill="#6b7280">Mensaje para el cliente</text>
      <text x="170" y="366" fontSize="10" fill="#111">«Presupuesto 2026-000123 · 1) Calidad (Soft OLED): 109,90 €. Garantía 3 meses…»</text>
    </svg>
  );
}

export function TpvMockup() {
  const tiles = [['Funda silicona', '9,90 €', '#bae6fd'], ['Cargador 20 W', '14,90 €', '#a7f3d0'], ['Cable USB-C', '6,00 €', '#fde68a'], ['Cristal templado', '7,50 €', '#fecdd3'], ['Auriculares', '12,00 €', '#ddd6fe'], ['SIM prepago', '5,00 €', '#99f6e4']];
  const tabs: [string, number, number][] = [['Venta', 0, 50], ['Devoluciones', 54, 80], ['Stock', 138, 44], ['Caja', 186, 42], ['Cierre de caja', 232, 86], ['CashDro', 322, 60]];
  return (
    <svg viewBox="0 0 640 400" role="img" aria-label="TPV con cobro en efectivo por CashDro, carrito y cierre de caja" style={{ width: '100%', height: 'auto', fontFamily: F }}>
      <title>TPV con CashDro</title>
      <rect width="640" height="400" rx="12" fill="#f0f0f0" stroke="#a0a0a0" />
      <rect width="640" height="34" rx="12" fill="#3a4a4f" /><rect y="20" width="640" height="14" fill="#3a4a4f" />
      <text x="16" y="22" fontSize="12" fontWeight="700" fill="#fff">TPV</text><text x="62" y="22" fontSize="10" fill="#d1d5db">Cajero: Caja 1 · Caja abierta a las 09:58 · Efectivo esperado: 168,40 €</text>
      <circle cx="540" cy="17" r="5" fill="#22c55e" /><text x="550" y="21" fontSize="9" fill="#fff">CashDro conectada</text>
      {tabs.map(([t, dx, w], i) => (
        <g key={t} transform={`translate(${12 + dx} 42)`}><rect width={w} height="22" fill={i === 0 ? '#fff' : '#e2e8f0'} stroke="#a0a0a0" /><text x={w / 2} y="15" textAnchor="middle" fontSize="9.5" fontWeight={i === 0 ? 700 : 400} fill="#0f172a">{t}</text></g>
      ))}
      {tiles.map(([n, p, c], i) => (
        <g key={n} transform={`translate(${12 + (i % 3) * 112} ${76 + Math.floor(i / 3) * 78})`}><rect width="104" height="70" fill={c} stroke="#94a3b8" /><text x="8" y="22" fontSize="10" fontWeight="600" fill="#0f172a">{n}</text><text x="8" y="58" fontSize="13" fontWeight="800" fill="#0f172a">{p}</text></g>
      ))}
      <text x="12" y="250" fontSize="10" fontWeight="700" fill="#0f172a">Reparaciones listas para cobrar</text>
      <rect x="12" y="258" width="328" height="42" fill="#fff" stroke="#94a3b8" /><text x="22" y="276" fontSize="10.5" fontWeight="700" fill="#0f172a">2026-000123</text><text x="22" y="291" fontSize="9" fill="#475569">iPhone 13 · Luis Gómez</text><text x="330" y="284" textAnchor="end" fontSize="13" fontWeight="800" fill="#0f172a">89,90 €</text>
      {/* cart */}
      <rect x="352" y="76" width="276" height="316" fill="#f0f0f0" stroke="#a0a0a0" />
      <text x="362" y="94" fontSize="10.5" fontWeight="700" fill="#0f172a">Ticket actual</text>
      <rect x="360" y="102" width="260" height="92" fill="#fff" />
      {[['Funda silicona', '9,90 €'], ['Cable USB-C', '6,00 €'], ['Cargador 20 W', '14,90 €']].map(([n, p], i) => (
        <g key={n} transform={`translate(0 ${120 + i * 26})`}><text x="368" y="0" fontSize="10" fill="#0f172a">{n}</text><text x="612" y="0" textAnchor="end" fontSize="10" fontWeight="600" fill="#0f172a">{p}</text><line x1="360" y1="9" x2="620" y2="9" stroke="#e2e8f0" /></g>
      ))}
      <text x="368" y="214" fontSize="9" fill="#64748b">Base imponible</text><text x="612" y="214" textAnchor="end" fontSize="9" fill="#64748b">25,29 €</text>
      <text x="368" y="228" fontSize="9" fill="#64748b">IVA</text><text x="612" y="228" textAnchor="end" fontSize="9" fill="#64748b">5,51 €</text>
      <text x="368" y="252" fontSize="15" fontWeight="800" fill="#0f172a">Total</text><text x="612" y="252" textAnchor="end" fontSize="18" fontWeight="800" fill="#0f172a">30,80 €</text>
      <rect x="360" y="266" width="260" height="30" fill="#ecfdf5" stroke="#10b981" /><text x="370" y="285" fontSize="9.5" fontWeight="600" fill="#065f46">CashDro: introducido 20,00 € de 30,80 €…</text>
      <rect x="360" y="308" width="208" height="38" fill="#fad200" stroke="#ca8a04" /><text x="464" y="332" textAnchor="middle" fontSize="14" fontWeight="800" fill="#0f172a">Cobrar 30,80 €</text>
      <rect x="574" y="308" width="46" height="38" fill="#f1f5f9" stroke="#94a3b8" /><text x="597" y="331" textAnchor="middle" fontSize="9.5" fill="#0f172a">Vaciar</text>
      <rect x="360" y="354" width="260" height="30" fill="#fad200" fillOpacity=".3" stroke="#ca8a04" /><text x="370" y="373" fontSize="9.5" fontWeight="700" fill="#0f172a">★ ¿Nos dejas una reseña en Google?</text>
      <rect x="578" y="357" width="36" height="24" fill="#fff" /><path d="M582 361h8v8h-8zM602 361h8v8h-8zM582 373h8v8h-8zM594 365h4v4h-4zM600 373h10v8h-10z" fill="#0f172a" />
    </svg>
  );
}

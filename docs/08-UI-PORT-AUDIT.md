# 08 · Auditoría y port de la UI de producción al `/dashboard`

Fuentes inspeccionadas (solo lectura): `whatsapp-inbox-pro` (local), Reparo (`reparo-812bcab8`), TPV Informática Torrent (Base44).
Leyenda: ✅ portado · 🟡 portado con diferencia (ver nota) · ❌ no portado.

Arquitectura: entrada propia `/dashboard` (Vite + Tailwind 3, aislada de la landing), un tema por módulo (WhatsApp oscuro/verde,
Reparo HelloClient con tokens `--hc-*`, TPV ventana de escritorio). Los datos pasan por funciones con `tenant_id`, control de plan/rol y
cifrado AES-256-GCM; no hay acceso directo del navegador a las entidades.

## WhatsApp Pro
| Pantalla / función original | Estado | Nota |
|---|---|---|
| Lista izquierda con búsqueda | ✅ | nombre, teléfono y texto del último mensaje |
| Pestañas de filtro | ✅ | Todos · Sin leer · En ventana · Atiende humano · Borrador IA |
| Badges de no leídos | ✅ | |
| Cuenta atrás de la ventana de 24 h | ✅ | verde / ámbar (<6 h) / rojo (<1 h) / cerrada |
| Chat con burbujas y separadores por día | ✅ | |
| Ticks enviado/entregado/leído/fallido | ✅ | además "en cola" |
| Reacciones | 🟡 | se muestran las recibidas; **no** se pueden enviar reacciones |
| Compositor plantilla vs texto libre | 🟡 | lo decide la ventana de 24 h (texto libre dentro, plantilla de respaldo fuera); no hay selector manual de plantillas ni botones interactivos |
| Panel derecho cliente/tickets | ✅ | tickets solo con Pro activo; enlace al ticket en Reparo |
| Banner de borrador IA en el chat | ✅ | confianza, tema, "requiere persona", aprobar/editar/regenerar/descartar |
| Selector off / shadow / live | ✅ | |
| Registro de decisiones de la IA | ✅ | sin texto de mensajes, con motivos explicados |
| Horario de atención | ✅ | hasta 3 tramos por día |
| Temas bloqueados | ✅ | 4 fijos e irrevocables + temas extra configurables |
| Conexión, cuota de prueba (barra /50), límite diario, pausa de emergencia | ✅ | |
| Envío de adjuntos / medios, difusiones | ❌ | no existían en el alcance portado |

## Reparo CRM
| Original | Estado | Nota |
|---|---|---|
| Tabla de tickets estilo HelloClient (tipografía 17/14 px, píldoras de estado) | ✅ | |
| Tablero por estados | ✅ | sin arrastrar y soltar (se cambia el estado en el desplegable) |
| Selector de estado agrupado | ✅ | |
| Asignación de técnico | ✅ | filtro y asignación; lista = miembros activos del taller |
| Iconos por tipo de dispositivo | ✅ | |
| Campo PIN / patrón visual | ✅ | PIN enmascarado con revelado (solo titular/admin, queda registrado) y patrón 3×3 |
| Scroll infinito de 20 en lista **y** búsqueda | ✅ | paginación en servidor, 20 por bloque |
| Presupuestos con comparador lado a lado + búsqueda en vivo | 🟡 | **Androgeek en vivo** (precio de distribuidor con la cuenta del taller, público sin ella). **SpainSellers en vivo** (CSV del taller, o categorías públicas + precio de distribuidor; sin cuenta el precio es una *estimación −20 %* marcada). **MuchoRepuesto solo enlace**: su web tiene CAPTCHA y, como en tu Reparo, no se consulta automáticamente. Cuentas cifradas por taller, sesiones nunca compartidas |
| Memoria de precios y alerta de cambio | ✅ | por proveedor y SKU; la búsqueda marca «antes X €» si el coste cambió |
| Mano de obra personalizable + IVA 21 % | ✅ | desglose base / IVA / PVP / beneficio |
| Vista previa e impresión 58 mm y 80 mm (resguardo y etiqueta) | ✅ | |
| Enlace del teléfono → conversación de WhatsApp | ✅ | desde la tabla y desde la ficha |
| Notas internas, fotos, firma en pantalla, informes | ❌ | no portados |

## TPV y CashDro
| Original | Estado | Nota |
|---|---|---|
| Cobrar: rejilla de productos/servicios por familias | ✅ | catálogo propio por taller (`Product`), editable por titular/admin |
| Cobro rápido de reparaciones desde Reparo | ✅ | importe pendiente = presupuesto − señal − ya cobrado |
| Carrito con IVA | ✅ | |
| Reparto Efectivo / Tarjeta (+ Bizum) | ✅ | |
| Aviso de reseña de Google | ✅ | decidido: franja con QR y contador diario (comportamiento actual de producción), visible al terminar el cobro; «Continuar» se activa a los 2 s |
| Sin botón de retirada en Venta | ✅ | las retiradas están en «Caja» y en el Paso 2 del cierre |
| Puente CashDro: URL/IP, estado en vivo, fondo objetivo, niveles | ✅ | config en el navegador; la tarjeta no está integrada con datáfono |
| Cierre: Paso 1 X · Paso 2 Informes · Paso 3 Z | ✅ | 10 casillas, diferencia, fondo de mañana, Disashop independiente, imprimir Z, históricos |
| «Cerrar y enviar informe» por correo | ❌ | no portado |
| Devoluciones (venta completa, línea o importe) | ✅ | pestaña «Devoluciones»: devuelve stock de `Product`, apunta movimientos NEGATIVOS por forma de pago en la caja abierta y el Cierre los resta. El efectivo se entrega a mano (no hay payout automático por CashDro) |
| Stock de productos | ✅ | opcional por producto; la venta lo descuenta y la devolución lo repone |

## Verificación
`tsc` limpio, 136 tests, `deno check` de las 13 funciones y build. **No** se ha probado la UI con datos reales ni con un puente CashDro físico.

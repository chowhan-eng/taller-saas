> **BORRADOR para revisión jurídica (versión `dpa-v1-2026-11`).** Antes de publicarlo debe revisarlo un abogado especialista en protección de datos. En concreto: (1) confirmar con Base44 la ubicación de sus servidores y, si hay transferencia fuera del EEE, el mecanismo del art. 46 RGPD (cláusulas contractuales tipo o Marco de Privacidad de Datos UE-EE. UU.); (2) completar la identificación del Encargado con los datos del titular (los mismos de `VITE_LEGAL_*`); (3) validar los plazos comprometidos (48 h para brechas, 30 días para supresión). Este texto describe solo medidas que el código de Taller SaaS aplica de verdad (ver `docs/07-BASE44-ARCHITECTURE.md` §4). No se debe añadir ninguna promesa que el sistema no cumpla.

# Contrato de Encargado del Tratamiento

**Artículo 28 del Reglamento (UE) 2016/679 (RGPD) y artículo 33 de la Ley Orgánica 3/2018 (LOPDGDD)**

## Partes

- **Responsable del tratamiento** (en adelante, «el Taller»): la persona física o jurídica titular del taller que contrata Taller SaaS, identificada con los datos facilitados en el alta del servicio.
- **Encargado del tratamiento** (en adelante, «Taller SaaS»): el titular del servicio Taller SaaS, identificado en el aviso legal de la web.

El Taller acepta este contrato de forma electrónica durante el alta, como paso previo y obligatorio para usar el servicio. Taller SaaS conserva la fecha, el usuario y la versión aceptada como prueba.

## 1. Objeto

Este contrato regula el tratamiento de datos personales que Taller SaaS realiza **por cuenta del Taller** al prestarle el servicio contratado (resguardos de reparación, avisos de WhatsApp, gestión de clientes y reparaciones y, en el plan Pro, TPV y cierre de caja).

El Taller es y sigue siendo **el único responsable** de los datos de sus clientes. Taller SaaS actúa **exclusivamente como encargado del tratamiento** y no decide sobre los fines ni sobre los medios esenciales del tratamiento.

## 2. Descripción del tratamiento

| | |
|---|---|
| **Finalidad** | Prestar al Taller el servicio contratado: registrar clientes y reparaciones, imprimir resguardos y etiquetas, enviar los avisos de WhatsApp que el Taller configura (estado de la reparación y, con consentimiento del cliente, solicitud de reseña) y, en el plan Pro, registrar ventas y cierres de caja. |
| **Operaciones** | Recogida, registro, conservación, consulta, cifrado y descifrado automáticos, comunicación a los proveedores de mensajería indicados en el anexo y supresión. |
| **Interesados** | Clientes del Taller y, en su caso, empleados del Taller que usan el servicio. |
| **Categorías de datos** | Identificativos (nombre y apellidos), de contacto (teléfono y correo electrónico), últimos cuatro caracteres del DNI cuando el Taller decida registrarlos, datos del dispositivo entregado (marca, modelo, número de serie/IMEI, avería, estado, código o patrón de desbloqueo si el cliente lo facilita), preferencias y consentimientos de comunicación, e importes de presupuestos, señales y ventas. **No se tratan categorías especiales de datos** (art. 9 RGPD). |
| **Duración** | La del contrato del servicio, más el plazo de devolución y supresión de la cláusula 10. |

## 3. Instrucciones del Taller

3.1. Taller SaaS tratará los datos **únicamente siguiendo las instrucciones documentadas del Taller**. Son instrucciones documentadas este contrato, la configuración que el Taller hace en el servicio y las solicitudes escritas que el Taller envíe por correo electrónico.

3.2. Taller SaaS **no usará los datos para fines propios**, ni para fines distintos de prestar el servicio. En particular, Taller SaaS:

- no venderá, cederá, alquilará ni comunicará los datos de los clientes del Taller a terceros, salvo a los subencargados del anexo y en la medida necesaria para prestar el servicio;
- no usará los listados de clientes del Taller para enviarles publicidad, ni propia ni de terceros;
- no elaborará perfiles comerciales de los clientes del Taller;
- no usará los datos de los clientes del Taller para entrenar modelos de inteligencia artificial.

3.3. Si Taller SaaS considera que una instrucción infringe el RGPD u otra norma de protección de datos, informará inmediatamente al Taller (art. 28.3 RGPD).

3.4. Si una norma de la Unión o de un Estado miembro obliga a Taller SaaS a tratar los datos de otra forma, informará al Taller antes del tratamiento, salvo que la propia norma lo prohíba.

## 4. Confidencialidad y acceso del personal

4.1. Taller SaaS garantiza que las personas autorizadas para tratar los datos se han comprometido por escrito a respetar su confidencialidad o están sujetas a una obligación legal de confidencialidad.

4.2. El tratamiento ordinario de los datos es **automático**: el sistema descifra los datos solo dentro de sus funciones de servidor y solo en el momento en que hacen falta para prestar el servicio (por ejemplo, para mostrar una ficha al propio Taller o para enviar un aviso de WhatsApp que el Taller ha configurado).

4.3. El personal de Taller SaaS **no consultará** los datos de los clientes del Taller, salvo en dos casos:

- cuando el Taller lo solicite por escrito para resolver una incidencia de soporte, y solo en lo necesario para resolverla;
- cuando lo exija una obligación legal o una orden de una autoridad competente.

Cada uno de estos accesos se documentará por escrito (fecha, persona, motivo y datos consultados) y esa documentación estará a disposición del Taller cuando la pida.

## 5. Medidas de seguridad (art. 32 RGPD)

Taller SaaS aplica, como mínimo, las siguientes medidas:

1. **Cifrado a nivel de aplicación.** El nombre y el teléfono de los clientes, el código o patrón de desbloqueo de los dispositivos y los textos y teléfonos de los mensajes de WhatsApp se guardan cifrados con **AES-256-GCM** antes de llegar a la base de datos. La base de datos solo contiene el texto cifrado.
2. **Claves separadas de los datos.** La clave maestra se custodia como secreto del entorno de ejecución y nunca se guarda en la base de datos ni se envía al navegador. A partir de ella se deriva una **clave distinta para cada taller** (HKDF-SHA256), y cada dato cifrado queda vinculado a su taller: un dato copiado a otro taller no se puede descifrar.
3. **Búsqueda sin texto en claro.** Para encontrar a un cliente por teléfono (por ejemplo, para atender una solicitud de baja) se usa una huella criptográfica (HMAC-SHA256 con clave propia de cada taller), no el número en claro.
4. **Aislamiento entre talleres.** Las reglas de acceso de la base de datos impiden que el navegador lea o escriba directamente los datos de clientes. Todas las operaciones pasan por funciones de servidor que comprueban, en cada petición, que el usuario pertenece al taller y que su plan incluye el módulo usado.
5. **Comunicaciones cifradas** (HTTPS/TLS) entre el navegador, el servidor y los proveedores.
6. **Minimización.** No se guarda el DNI completo, solo sus cuatro últimos caracteres y solo si el Taller lo decide.
7. **Control de accesos del Taller** mediante cuentas individuales y roles (titular, administrador, mostrador, técnico).

Taller SaaS revisará estas medidas periódicamente y las adaptará al estado de la técnica. Nunca las sustituirá por otras que ofrezcan menos protección.

## 6. Subencargados

6.1. El Taller da una **autorización general** para que Taller SaaS recurra a los subencargados del anexo, que tratan datos solo en lo necesario para prestar el servicio.

6.2. Taller SaaS informará al Taller por correo electrónico, con al menos **30 días** de antelación, de cualquier alta o sustitución de un subencargado. Si el Taller se opone por motivos razonables relacionados con la protección de datos, podrá resolver el contrato sin penalización antes de que el cambio sea efectivo.

6.3. Taller SaaS impondrá a cada subencargado, por contrato, las mismas obligaciones de protección de datos que asume en este contrato, y seguirá siendo responsable ante el Taller de su cumplimiento.

## 7. Transferencias internacionales

Taller SaaS solo transferirá datos fuera del Espacio Económico Europeo cuando exista una decisión de adecuación o las garantías adecuadas del artículo 46 RGPD. El anexo indica, para cada subencargado, la ubicación del tratamiento y la garantía aplicable.

## 8. Derechos de los interesados

8.1. Taller SaaS ayudará al Taller, con las funciones del servicio y con medidas técnicas y organizativas apropiadas, a atender las solicitudes de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad de sus clientes.

8.2. Si un interesado dirige su solicitud directamente a Taller SaaS, Taller SaaS la remitirá al Taller en un plazo máximo de **5 días hábiles**, sin responderla por su cuenta salvo instrucción del Taller.

8.3. Las solicitudes de baja recibidas por WhatsApp (por ejemplo, «BAJA») se aplican automáticamente, bloqueando los envíos a ese cliente, porque así lo configura el Taller al usar el servicio.

## 9. Violaciones de seguridad

9.1. Taller SaaS notificará al Taller, **sin dilación indebida y en un plazo máximo de 48 horas** desde que tenga conocimiento de ella, cualquier violación de la seguridad que afecte a sus datos. La notificación incluirá la información disponible del artículo 33.3 RGPD.

9.2. Taller SaaS ayudará al Taller a cumplir sus obligaciones de notificación a la Agencia Española de Protección de Datos y, en su caso, de comunicación a los interesados (arts. 33 y 34 RGPD).

## 10. Fin del contrato: devolución y supresión

10.1. Al terminar el servicio, el Taller podrá **exportar sus datos** en un formato estructurado y de uso común durante los **30 días** siguientes.

10.2. Pasado ese plazo, Taller SaaS **suprimirá** los datos personales y sus copias, salvo que una norma obligue a conservarlos. En ese caso, los mantendrá bloqueados y solo durante el plazo legal.

10.3. Taller SaaS certificará la supresión por escrito si el Taller lo solicita.

## 11. Asistencia, información y auditoría

11.1. Taller SaaS ayudará al Taller a cumplir sus obligaciones de seguridad, de evaluación de impacto y de consulta previa (arts. 32 a 36 RGPD), teniendo en cuenta la naturaleza del tratamiento y la información de que disponga.

11.2. Taller SaaS pondrá a disposición del Taller la información necesaria para demostrar el cumplimiento de este contrato. También permitirá y facilitará auditorías, incluidas inspecciones, realizadas por el Taller o por un auditor que este designe. Las partes acordarán por escrito la fecha y el alcance, con un preaviso razonable y sin perjudicar la seguridad de los datos de otros talleres.

## 12. Responsabilidad y legislación aplicable

12.1. Cada parte responde de sus incumplimientos conforme al artículo 82 RGPD.

12.2. Si Taller SaaS determina los fines o medios del tratamiento infringiendo este contrato, será considerado responsable del tratamiento en lo que respecta a dicho tratamiento (art. 28.10 RGPD).

12.3. Este contrato se rige por la legislación española y por el RGPD.

---

## Anexo I. Subencargados autorizados

| Subencargado | Servicio | Datos tratados | Ubicación / garantía |
|---|---|---|---|
| Base44 | Alojamiento de la aplicación, base de datos y funciones de servidor | Todos los del servicio (los datos sensibles de clientes, cifrados) | Pendiente de confirmar con el proveedor antes de publicar (ver nota inicial) |
| Meta Platforms Ireland Ltd. (WhatsApp Business Platform) | Envío de los avisos de WhatsApp que el Taller configura | Teléfono del cliente, nombre del taller y contenido del aviso | UE / EE. UU. según Meta (Marco de Privacidad de Datos UE-EE. UU. y cláusulas contractuales tipo) |
| Stripe Payments Europe Ltd. | Cobro de la suscripción del Taller | Datos de facturación del Taller (no de sus clientes) | UE / EE. UU. según Stripe (cláusulas contractuales tipo) |

Si se activa el asistente de voz o cualquier proveedor de inteligencia artificial, se aplicará antes el procedimiento de la cláusula 6.2.

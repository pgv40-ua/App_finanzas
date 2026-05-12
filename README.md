# Verum — Gestor de Gastos con IA

Sistema multiusuario de gestión de gastos en tiempo real. Un bot de Telegram recibe fotos de tickets y facturas (o mensajes de texto del tipo *"McDonald's 250 MXN"*), **Google Gemini Vision 2.5 Flash** extrae automáticamente los datos contables, y todo aparece al instante en un panel web oscuro estilo Linear/Vercel — con autenticación, presupuestos, alertas, asistente conversacional de IA y soporte para empresas con varios trabajadores.

> Antes "App Finanzas". Renombrado a **Verum** con la fase de autenticación + multiempresa.

---

## Lo nuevo en esta versión

Estado: **Fase 2 completada**. Los siguientes módulos son nuevos respecto a la versión anterior:

- **Autenticación completa** — Registro/login con email + contraseña, sesiones por *bearer token*, hashing bcrypt.
- **Multi-tenant** — Cuentas *Particular* (usuario aislado) y *Empresa* (admin + N trabajadores, datos compartidos según rol).
- **Códigos de invitación** — Cada empresa tiene un código rotable que los trabajadores usan al registrarse.
- **Vinculación Telegram ↔ cuenta** — Cada usuario genera un código de 6 dígitos en el panel y lo envía como `/link 123456` al bot. Un bot, muchas cuentas.
- **Asistente conversacional con IA** — Chat con streaming SSE que analiza tu historial de gastos usando Gemini 2.5 Flash; hace cálculos, comparaciones, proyecciones.
- **Presupuestos + alertas** — Presupuesto global o por categoría; el bot avisa por Telegram al llegar al 80 % y al excederse.
- **Detección de anomalías** — Posibles duplicados (mismo proveedor + fecha + importe) y gastos atípicos (> 2,5 × promedio histórico de la categoría).
- **Resúmenes programados** — *Digest* semanal (lunes 8 am) y mensual (día 1 a las 8 am) enviados por Telegram a todos los usuarios vinculados.
- **Gasto desde texto** — Manda `Uber 180 MXN` al bot y se registra sin necesidad de foto.
- **Comandos enriquecidos** — `/stats`, `/budget`, `/last [N]`, `/export`, `/link`, `/unlink`, `/whoami`, `/help`, `/start`.
- **Webhook saliente** — Cada gasto creado se reenvía a `WEBHOOK_URL` (Zapier / Make / n8n).
- **PWA instalable** — Manifest, *service worker* con estrategia *network-first* para HTML/JS y *cache-first* para estáticos, iconos 192/512.
- **Seguridad de servidor** — Helmet con CSP, `express-rate-limit` (200 req / 15 min en `/api/`), validación de inputs.
- **Edición y borrado de gastos** — `PATCH` y `DELETE` desde el panel, con propagación en tiempo real a todos los dispositivos del scope.
- **Branding Verum** — Logos, favicons, login dedicado, paleta verde menta sobre fondo `#0C0C0E`.

---

## Características principales

### Bot de Telegram
- **Procesamiento de fotos** — Envía cualquier ticket o factura; Gemini extrae proveedor, fecha, total, subtotal, IVA, moneda, categoría, líneas de detalle y notas.
- **Procesamiento de texto** — Mensajes tipo `Uber 180`, `Café 65 MXN`, `Spotify 169 mensual` se interpretan también con Gemini.
- **Comandos**:
  | Comando | Función |
  |---|---|
  | `/start` | Bienvenida y estado de vinculación |
  | `/link <código>` | Vincula este Telegram a tu cuenta del panel |
  | `/unlink` | Desvincula la cuenta de este chat |
  | `/whoami` | Muestra cuenta vinculada y Chat ID |
  | `/stats` | Resumen del mes (total, promedio, por categoría) |
  | `/budget` | Estado de presupuestos del mes (🟢 ⚠️ 🔴) |
  | `/last [N]` | Últimas N facturas (1–20, default 5) |
  | `/export` | Envía el CSV del mes como adjunto |
  | `/help` | Lista todos los comandos |
- **Guardado de la imagen original** — Cada ticket se guarda en `public/uploads/{id}.{ext}` para verlo desde el modal del panel.
- **Alertas en hilo** — Si la nueva factura dispara una alerta de presupuesto o una anomalía, llega como mensaje extra al chat (y a los admins de la empresa).

### Panel web
- **Login + registro** en `/login.html` con tres flujos: Particular, Crear empresa, Unirse a empresa (vía código de invitación).
- **Dashboard mensual en vivo** — Socket.IO empuja `expense-added`, `expense-updated`, `expense-deleted`, `budget-updated`, `processing`, `processing-error`. *Skeleton card* mientras Gemini trabaja.
- **Vista anual con gráficos** — Chart.js 4: barras por mes y donut por categoría; KPIs de total, promedio mensual, mes pico y recuento.
- **Selector de mes** con dropdown tipo datepicker que solo navega a meses con datos.
- **Filtros y búsqueda** — Chips de categoría + buscador por proveedor, combinables en tiempo real.
- **Toggle grid / lista** — Vista compacta para escanear muchas facturas rápido.
- **Modal de detalle** — Todos los campos del gasto + la imagen original del ticket, con botones para editar o eliminar.
- **Edición inline** — Cualquier campo del gasto se puede corregir sin reprocesar la imagen.
- **Exportar CSV** — Mes activo en CSV con BOM UTF-8 compatible con Excel y Google Sheets.
- **Presupuestos** — UI para crear/editar/borrar presupuesto global o por categoría, con barra de progreso y porcentaje gastado.
- **Asistente IA** — Chat lateral con streaming token a token; *"¿Cuánto gasté en transporte el mes pasado?"*, *"Proyecta mi gasto anual"*, *"Compara este trimestre con el anterior"*.
- **Panel de administración** (cuentas *Empresa*) — Lista de trabajadores, código de invitación visible y rotable, eliminación de usuarios.
- **Vinculación Telegram** — Botón que genera un código de 6 dígitos (válido 10 min) para enviar al bot.
- **PWA** — Instalable desde Chrome/Edge en escritorio y móvil; funciona offline para la *shell* gracias al *service worker*.

### Backend
- **SQLite** con [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (modo WAL, *foreign keys* activadas).
- **Esquema multi-tenant** — Tablas `companies`, `users`, `sessions`, `link_codes`, `expenses`, `budgets`. Scoping automático según `account_type` y `role`.
- **Sesiones por token** — 7 días, almacenadas en SQLite, purgadas cada hora.
- **Helmet + CSP** estricta; CDN permitido solo para `cdn.jsdelivr.net` (Chart.js) y `fonts.googleapis.com`.
- **Rate limiting** — 200 peticiones / 15 min por IP en todo `/api/`.
- **Sin ORM** — *Prepared statements* directos, fácil de leer y auditar.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Bot de mensajería | [Telegraf](https://telegraf.js.org/) 4 |
| Visión y NLP | [Google Gemini](https://aistudio.google.com/) 2.5 Flash |
| Servidor HTTP | Express 4 + [helmet](https://helmetjs.github.io/) + [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) |
| Tiempo real | Socket.IO 4 con *rooms* por usuario y por empresa |
| Base de datos | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) 12, modo WAL |
| Autenticación | [bcryptjs](https://github.com/dcodeIO/bcrypt.js/) + tokens en SQLite |
| Asistente IA | `@google/generative-ai` con Server-Sent Events |
| Gráficos | [Chart.js](https://www.chartjs.org/) 4.4 (vía CDN) |
| Frontend | Vanilla JS + CSS *custom properties* (sin frameworks) |
| PWA | *Service worker* propio + Web App Manifest |
| Runtime | Node.js 18+ ESM (`"type": "module"`) |

---

## Requisitos previos

- **Node.js 18** o superior
- **Cuenta en Google AI Studio** — para obtener la clave de Gemini ([aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey))
- **Bot de Telegram** — creado con [@BotFather](https://t.me/botfather) en menos de 2 minutos

---

## Instalación

```bash
# 1. Clonar
git clone https://github.com/pgv40-ua/App_finanzas.git
cd App_finanzas

# 2. Instalar dependencias
npm install

# 3. Configurar credenciales
cp .env.example .env       # en Windows: Copy-Item .env.example .env
```

Edita el archivo `.env`:

```env
GEMINI_API_KEY=tu_clave_de_google_ai_studio
TELEGRAM_BOT_TOKEN=tu_token_de_botfather
PORT=3000
BCRYPT_ROUNDS=10
WEBHOOK_URL=                # opcional
```

> La base de datos `app.db` se crea sola en el primer arranque — no hay migraciones que correr.

---

## Configuración del bot de Telegram

1. Abre Telegram y busca **@BotFather**
2. Envía `/newbot` y sigue las instrucciones
3. Copia el token con formato `123456789:AAFxxx...` a `TELEGRAM_BOT_TOKEN`
4. Arranca el servidor (`npm start`)
5. Entra en `http://localhost:3000/login.html`, regístrate y, dentro del panel, **genera tu código de vinculación**
6. En Telegram envía `/link <código>` al bot — ¡listo!

---

## Uso

```bash
npm start         # producción
npm run dev       # desarrollo con --watch (auto-reload al guardar)
```

El servidor arranca en `http://localhost:3000`. Si abres la raíz sin sesión, el frontend te redirige a `/login.html`.

### Flujos de registro

- **Particular** — Email + contraseña + nombre. Tus gastos son privados a tu cuenta.
- **Crear empresa** — Email + contraseña + nombre del admin + nombre de la empresa. Recibes un código de invitación de 8 caracteres para repartir a tus trabajadores.
- **Trabajador** — Email + contraseña + nombre + código de invitación. Tus gastos son visibles para los admins de la empresa.

### Procesando una factura

1. Abre Telegram y vincula tu cuenta con `/link <código>`
2. Envíale una foto de cualquier ticket o factura (o un mensaje de texto del tipo `Uber 180 MXN`)
3. El bot responde confirmando la recepción y, en unos segundos, devuelve el desglose extraído
4. La tarjeta aparece al instante en el panel web de todos tus dispositivos conectados

---

## API REST

Todos los endpoints `/api/*` (excepto `/api/auth/*`) requieren cabecera `Authorization: Bearer <token>`.

### Autenticación
| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/auth/register/particular` | Registro de cuenta personal |
| `POST` | `/api/auth/register/company` | Crear empresa + admin |
| `POST` | `/api/auth/register/worker` | Unirse a empresa con código |
| `POST` | `/api/auth/login` | Login (devuelve token) |
| `POST` | `/api/auth/logout` | Revoca el token actual |
| `GET`  | `/api/me` | Datos del usuario autenticado |

### Gastos
| Método | Endpoint | Descripción |
|---|---|---|
| `GET`    | `/api/expenses?month=YYYY-MM&page=1&limit=50` | Lista paginada |
| `POST`   | `/api/expenses` | Alta manual |
| `PATCH`  | `/api/expenses/:id` | Edición parcial |
| `DELETE` | `/api/expenses/:id` | Baja |
| `GET`    | `/api/export?month=YYYY-MM&token=...` | Descarga CSV (token en *query* para `<a download>`) |

### Presupuestos
| Método | Endpoint | Descripción |
|---|---|---|
| `GET`    | `/api/budgets` | Lista de presupuestos del scope |
| `POST`   | `/api/budgets` | Crear o actualizar (por categoría o global) |
| `DELETE` | `/api/budgets/:id` | Eliminar |

### Vinculación Telegram
| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/telegram/link-code` | Genera código de 6 dígitos (válido 10 min) |

### Administración (solo rol `admin`)
| Método | Endpoint | Descripción |
|---|---|---|
| `GET`    | `/api/admin/invite-code` | Código de invitación actual |
| `POST`   | `/api/admin/invite-code/rotate` | Genera uno nuevo |
| `GET`    | `/api/admin/users` | Lista de trabajadores |
| `DELETE` | `/api/admin/users/:id` | Eliminar trabajador |

### Asistente IA
| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/assistant` | Pregunta con streaming SSE (`text/event-stream`) |
| `GET`  | `/api/assistant/status` | Indica si Gemini está disponible |

---

## Eventos Socket.IO

Conexión autenticada vía `socket.handshake.auth.token`. El servidor une al socket a las salas correspondientes:
- `user:<userId>` — todos los usuarios
- `company:<companyId>` — solo admins de empresa (ven los gastos de todos los trabajadores)

| Evento | Dirección | Payload | Descripción |
|--------|-----------|---------|-------------|
| `init` | server → client | `{ expenses, budgets, connected }` | Snapshot inicial al conectar |
| `bot-ready` | server → client | — | Bot de Telegram conectado |
| `processing` | server → client | `{ from, timestamp }` | Imagen recibida, esperando IA |
| `processing-error` | server → client | `{ from, timestamp }` | Falló el procesamiento |
| `expense-added` | server → client | `Expense` | Nuevo gasto disponible |
| `expense-updated` | server → client | `Expense` | Gasto editado |
| `expense-deleted` | server → client | `{ id }` | Gasto borrado |
| `budget-updated` | server → client | `Budget` | Alta o cambio de presupuesto |
| `budget-deleted` | server → client | `{ id }` | Presupuesto borrado |

---

## Estructura del proyecto

```
Verum/
├── server.js          # Express + Socket.IO + API REST
├── auth.js            # bcrypt, tokens, middlewares de autorización
├── store.js           # Capa SQLite (users, companies, sessions, expenses, budgets...)
├── telegram.js        # Bot Telegraf, comandos, manejo de fotos/texto
├── gemini.js          # Visión + parsing de texto con Gemini 2.5 Flash
├── alerts.js          # Alertas de presupuesto, anomalías y digests programados
├── assistant.js       # Chat con streaming SSE sobre el historial del usuario
├── app.db             # SQLite (auto-generado, en .gitignore)
├── public/
│   ├── index.html     # App shell del dashboard
│   ├── login.html     # Login / registro
│   ├── style.css      # Sistema de diseño dark
│   ├── app.js         # Lógica del cliente — estado, sockets, gráficos, modales, asistente
│   ├── login.js       # Lógica del flujo de auth
│   ├── manifest.json  # Web App Manifest (PWA)
│   ├── sw.js          # Service worker
│   ├── icon-*.png     # Iconos PWA
│   ├── favicon-*.png  # Favicons
│   ├── logo*.png      # Branding Verum
│   └── uploads/       # Imágenes de tickets (auto-generado, en .gitignore)
├── .env.example       # Plantilla de variables de entorno
├── .gitignore
└── package.json
```

---

## Flujo de datos

```
                ┌──────────────────────────┐
   📷 foto ──▶  │  Bot Telegram (Telegraf) │  ─▶  /link <código>  →  asocia chat ↔ user
                └────────────┬─────────────┘
                             │
                             ▼
                  Gemini Vision 2.5 Flash
                  → JSON: vendor, date, total, tax, currency,
                          category, items[], notes
                             │
                             ▼
                       store.js (SQLite)
                  insert en `expenses`  +  guarda imagen en public/uploads/{id}.jpg
                             │
            ┌────────────────┼────────────────┬─────────────────┐
            ▼                ▼                ▼                 ▼
   Socket.IO emite    alerts.js revisa  alerts.js detecta  WEBHOOK_URL (Zapier/
   `expense-added`    presupuestos      anomalías          Make/n8n) si está set
   a user:* y         (80% / 100%)      (duplicado / >2.5×)
   company:*
            │
            ▼
   Panel web actualiza tarjetas, KPIs y gráficos al instante
```

---

## Variables de entorno

| Variable | Descripción | Requerida | Default |
|----------|-------------|-----------|---------|
| `GEMINI_API_KEY` | Clave de Google AI Studio | Sí | — |
| `TELEGRAM_BOT_TOKEN` | Token del bot de BotFather | Sí | — |
| `PORT` | Puerto HTTP del servidor | No | `3000` |
| `BCRYPT_ROUNDS` | Coste del hashing de contraseñas | No | `10` |
| `WEBHOOK_URL` | URL POST a la que reenviar cada gasto creado | No | — |

---

## Seguridad

- Contraseñas con **bcrypt** (coste configurable). Nunca se devuelven al cliente — `auth.js` las elimina con `sanitizeUser`.
- **Sesiones rotables** de 7 días almacenadas en SQLite; logout las revoca al instante.
- **CSP estricta** vía Helmet — solo se permite `cdn.jsdelivr.net` para Chart.js y `fonts.googleapis.com` para fuentes.
- **Rate limiting** global en `/api/` (200 req / 15 min por IP).
- **Aislamiento por scope** — los queries SQL filtran por `user_id` (particulares y trabajadores) o `company_id` (admins); no se confía nunca en datos del cliente para autorizar.
- Códigos de vinculación Telegram con **TTL de 10 minutos** y de un solo uso.
- Códigos de invitación de empresa **rotables** desde el panel admin.

---

## Licencia

MIT

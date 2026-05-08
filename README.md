# App Finanzas — Gestor de Gastos con IA

Sistema de gestión de gastos empresariales en tiempo real. Un bot de Telegram recibe fotografías de facturas y tickets, extrae automáticamente los datos contables mediante **Google Gemini Vision** y los publica al instante en un panel web profesional de estética oscura, sin necesidad de introducir nada manualmente.

---

## Características principales

### Bot & procesamiento
- **Procesamiento automático de facturas** — Envía una foto de cualquier ticket o factura al bot y la IA extrae proveedor, fecha, importe, IVA, categoría y líneas de detalle.
- **Confirmación inmediata en Telegram** — El bot responde al instante con el desglose estructurado cuando termina de procesar.
- **Guardado automático de recibos** — La imagen original del ticket se almacena en disco para poder consultarla desde el panel.
- **Control de acceso** — Lista blanca de Chat IDs (`ALLOWED_CHAT_IDS`) para restringir el bot a usuarios autorizados.

### Panel web
- **Dashboard en tiempo real** — Se actualiza en vivo vía Socket.io sin recargar la página, con skeleton card mientras se procesa.
- **Diseño dark profesional** — Estética oscura estilo Linear/Vercel con sistema de tokens CSS y tipografía Geist + DM Sans.
- **Vista mensual** — Selector de mes con dropdown tipo datepicker que muestra qué meses tienen datos y navega directamente entre años con facturas (sin saltar años vacíos).
- **Vista anual con gráficos** — Gráfica de barras mensual y donut de categorías construidos con Chart.js 4; KPIs de total, promedio, mes pico y recuento.
- **Modal de detalle** — Haz clic en cualquier tarjeta para ver todos los campos del gasto más la fotografía original del ticket.
- **Filtro por categoría** — Sidebar con chips de categoría (Alimentación, Transporte, Hospedaje, Servicios, Tecnología) que filtran las tarjetas en tiempo real.
- **Búsqueda por proveedor** — Input de búsqueda que filtra por nombre de proveedor, combinable con filtro de categoría.
- **Toggle grid/lista** — Alterna entre vista de tarjetas y lista compacta con más datos visibles.
- **Exportar CSV** — Descarga las facturas del mes seleccionado en formato CSV con BOM UTF-8 compatible con Excel.

### Backend
- **Persistencia en SQLite** — Los gastos se guardan en `expenses.db` con `better-sqlite3`; sobreviven reinicios del servidor.
- **Sin ORM, sin migraciones** — Esquema mínimo de tabla única con blob JSON; fácil de leer y auditar.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Bot de mensajería | [Telegraf](https://telegraf.js.org/) v4 (API oficial de Telegram) |
| Visión artificial | [Google Gemini](https://aistudio.google.com/) 2.5 Flash |
| Servidor | Node.js 18+ · Express 4 |
| Tiempo real | Socket.io 4 |
| Base de datos | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Gráficos | [Chart.js](https://www.chartjs.org/) 4.4 |
| Frontend | Vanilla JS · CSS custom properties (sin frameworks) |
| Runtime | Node.js ESM (`"type": "module"`) |

---

## Requisitos previos

- **Node.js 18** o superior
- **Cuenta en Google AI Studio** — para obtener la clave de Gemini ([aistudio.google.com](https://aistudio.google.com/app/apikey))
- **Bot de Telegram** — creado con [@BotFather](https://t.me/botfather) en menos de 2 minutos

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/pgv40-ua/App_finanzas.git
cd App_finanzas

# 2. Instalar dependencias
npm install

# 3. Configurar las credenciales
cp .env.example .env
```

Edita el archivo `.env` con tus claves:

```env
GEMINI_API_KEY=tu_clave_de_google_ai_studio
TELEGRAM_BOT_TOKEN=tu_token_de_botfather
ALLOWED_CHAT_IDS=123456789,987654321   # opcional — Chat IDs autorizados
PORT=3000
```

> **`ALLOWED_CHAT_IDS`** — Lista separada por comas de los Chat IDs que pueden usar el bot. Si se deja vacío, cualquier usuario puede enviar facturas. Obtén tu ID enviando `/whoami` al bot.

---

## Configuración del bot de Telegram

1. Abre Telegram y busca **@BotFather**
2. Envía `/newbot` y sigue las instrucciones
3. BotFather te dará un token con formato `123456789:AAFxxx...`
4. Pega ese token en `TELEGRAM_BOT_TOKEN` dentro de tu `.env`
5. Envía `/whoami` al bot para obtener tu Chat ID y añadirlo a `ALLOWED_CHAT_IDS`

---

## Uso

```bash
npm start
```

El servidor arranca en `http://localhost:3000`. Abre esa URL en el navegador para ver el panel web.

Para procesar una factura:
1. Busca tu bot en Telegram por el username que elegiste
2. Envíale una fotografía de cualquier ticket o factura
3. El bot responderá confirmando que está procesando
4. En unos segundos recibirás el desglose completo y la tarjeta aparecerá en el panel web en tiempo real

---

## Panel web — vistas y funcionalidades

### Dashboard mensual
- **KPIs**: total del mes, número de facturas con promedio, última factura recibida.
- **Selector de mes**: haz clic en el mes/año del encabezado para abrir el datepicker. Los meses con facturas muestran un indicador. Las flechas de año saltan directamente al año anterior/siguiente que tenga datos.
- **Filtros**: selecciona una categoría en la barra lateral o escribe en el buscador para filtrar instantáneamente.
- **Modal de detalle**: haz clic en cualquier tarjeta para ver todos los campos y la fotografía original del ticket.

### Vista anual
- Accede desde la barra lateral con el botón **Por año**.
- Navega entre años con `←` y `→`; solo se permiten años con al menos una factura.
- **Gráfica de barras** — gasto total por mes.
- **Gráfica donut** — distribución por categoría con leyenda y porcentajes.
- **KPIs anuales**: total, promedio mensual, mes pico y total de facturas.

### Exportar CSV
El botón de descarga en la cabecera exporta las facturas del mes activo en formato CSV con BOM UTF-8 (compatible con Excel y Google Sheets directamente).

---

## Estructura del proyecto

```
App_finanzas/
├── server.js          # Punto de entrada — Express + Socket.io + API CSV
├── telegram.js        # Bot de Telegram (Telegraf) + guardado de imágenes
├── gemini.js          # Integración con Gemini Vision — extracción de JSON
├── store.js           # Persistencia SQLite con better-sqlite3
├── test-gemini.js     # Script de diagnóstico para verificar la API de Gemini
├── expenses.db        # Base de datos SQLite (generada automáticamente, en .gitignore)
├── public/
│   ├── index.html     # Panel web — app shell con sidebar y dos vistas
│   ├── style.css      # Sistema de diseño dark profesional
│   ├── app.js         # Lógica del cliente — estado, socket, gráficos, modales
│   └── uploads/       # Imágenes de tickets guardadas en disco (auto-generado)
├── .env.example       # Plantilla de variables de entorno
└── package.json
```

---

## Flujo de datos

```
Usuario envía foto  →  Bot de Telegram recibe imagen
        │
        ▼
  Gemini Vision extrae JSON estructurado
  { vendor, date, total, tax, category, items[] }
        │
        ▼
  store.js guarda el gasto en SQLite
  Imagen guardada en public/uploads/{id}.jpg
        │
        ├──▶  Socket.io emite "expense-added" al panel web
        │          └──▶ Tarjeta aparece en tiempo real
        │
        └──▶  Bot responde al usuario con el resumen completo
```

---

## Eventos Socket.io

| Evento | Dirección | Descripción |
|--------|-----------|-------------|
| `init` | server → client | Estado inicial al conectar (gastos existentes + estado del bot) |
| `bot-ready` | server → client | Bot de Telegram conectado y listo |
| `processing` | server → client | Imagen recibida, procesando (muestra skeleton card) |
| `expense-added` | server → client | Gasto procesado con éxito (incluye campo `imageMime`) |
| `processing-error` | server → client | Error durante el procesamiento |

---

## Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `GEMINI_API_KEY` | Clave de Google AI Studio | Sí |
| `TELEGRAM_BOT_TOKEN` | Token del bot de BotFather | Sí |
| `ALLOWED_CHAT_IDS` | Chat IDs autorizados, separados por coma | No |
| `PORT` | Puerto del servidor (por defecto: 3000) | No |

---

## Script de diagnóstico

Si tienes problemas con la API de Gemini, ejecuta:

```bash
node test-gemini.js
```

El script prueba automáticamente los modelos disponibles en tu clave y reporta cuáles están operativos.

---

## Licencia

MIT

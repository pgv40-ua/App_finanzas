# App Finanzas — Gestor de Gastos con IA

Sistema de gestión de gastos empresariales en tiempo real. Un bot de Telegram recibe fotografías de facturas y tickets, extrae automáticamente los datos contables mediante **Google Gemini Vision** y los publica al instante en un panel web corporativo, sin necesidad de introducir nada manualmente.

---

## Características principales

- **Procesamiento automático de facturas** — Envía una foto de cualquier ticket o factura al bot y la IA extrae proveedor, fecha, importe, IVA, categoría y líneas de detalle.
- **Confirmación inmediata en Telegram** — El bot acusa recibo al instante y devuelve un resumen estructurado cuando termina de procesar.
- **Panel web en tiempo real** — Dashboard corporativo que se actualiza en vivo vía Socket.io sin recargar la página.
- **Filtro por mes** — Navega mes a mes para revisar el histórico de gastos y ver el total acumulado de cada período.
- **Sin base de datos** — Almacenamiento en memoria, arquitectura ligera pensada para demo y uso personal.
- **Sin riesgo de cuenta** — Usa la API oficial de Telegram, sin bots no oficiales ni riesgo de suspensión.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Bot de mensajería | [Telegraf](https://telegraf.js.org/) v4 (API oficial de Telegram) |
| Visión artificial | [Google Gemini](https://aistudio.google.com/) 2.5 Flash |
| Servidor | Node.js 18+ · Express 4 |
| Tiempo real | Socket.io 4 |
| Frontend | Vanilla JS · CSS custom (sin frameworks) |
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
PORT=3000
```

---

## Configuración del bot de Telegram

1. Abre Telegram y busca **@BotFather**
2. Envía `/newbot` y sigue las instrucciones
3. BotFather te dará un token con formato `123456789:AAFxxx...`
4. Pega ese token en `TELEGRAM_BOT_TOKEN` dentro de tu `.env`

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
4. En unos segundos recibirás el desglose completo y la tarjeta aparecerá en el panel web

---

## Estructura del proyecto

```
App_finanzas/
├── server.js          # Punto de entrada — Express + Socket.io
├── telegram.js        # Bot de Telegram (Telegraf) + pipeline de procesamiento
├── gemini.js          # Integración con Gemini Vision — extracción de JSON
├── store.js           # Almacén en memoria de gastos
├── test-gemini.js     # Script de diagnóstico para verificar la API de Gemini
├── public/
│   ├── index.html     # Panel web — estructura HTML
│   ├── style.css      # Estilos — diseño corporativo monochrome
│   └── app.js         # Cliente Socket.io — lógica del dashboard
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
  store.js guarda el gasto en memoria
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
| `expense-added` | server → client | Gasto procesado con éxito |
| `processing-error` | server → client | Error durante el procesamiento |

---

## Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `GEMINI_API_KEY` | Clave de Google AI Studio | Sí |
| `TELEGRAM_BOT_TOKEN` | Token del bot de BotFather | Sí |
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

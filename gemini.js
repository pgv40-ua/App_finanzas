// gemini.js — invoice parsing via Gemini Vision
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

const PROMPT = `Analiza esta imagen de factura o recibo y extrae los datos contables.
Responde ÚNICAMENTE con un objeto JSON válido, sin explicaciones ni markdown.
El JSON debe tener exactamente esta estructura:
{
  "vendor": "nombre del comercio o proveedor",
  "date": "fecha en formato YYYY-MM-DD o null si no está clara",
  "total": numero_decimal,
  "currency": "MXN o el código ISO de la moneda",
  "subtotal": numero_decimal_o_null,
  "tax": numero_decimal_o_null,
  "category": "Alimentación|Transporte|Hospedaje|Servicios|Tecnología|Otro",
  "items": [{"description": "...", "amount": numero}],
  "notes": "observación breve o null"
}
Si la imagen no es una factura o recibo, devuelve: {"error": "no es una factura válida"}`

const TEXT_PROMPT = `Extrae datos de gasto de este mensaje de texto.
Responde ÚNICAMENTE con un objeto JSON válido, sin explicaciones ni markdown.
Estructura:
{
  "vendor": "nombre del proveedor o servicio",
  "date": "YYYY-MM-DD o null",
  "total": numero_decimal,
  "currency": "MXN u otro código ISO",
  "subtotal": null,
  "tax": null,
  "category": "Alimentación|Transporte|Hospedaje|Servicios|Tecnología|Otro",
  "items": [],
  "notes": "texto original como referencia"
}
Si no puedes extraer un monto numérico, devuelve: {"error": "no se pudo extraer el monto"}`

export async function parseTextExpense(text) {
  const result = await model.generateContent([TEXT_PROMPT, `Mensaje: "${text}"`])
  const raw    = result.response.text()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed.error) return { error: parsed.error }
    return parsed
  } catch {
    return { error: 'No se pudo interpretar el texto como gasto' }
  }
}

export async function parseInvoice(buffer, mimetype = 'image/jpeg') {
  const imagePart = {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType: mimetype,
    },
  }

  const result = await model.generateContent([PROMPT, imagePart])
  const raw = result.response.text()

  // Gemini sometimes wraps JSON in markdown fences — strip them
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(cleaned)
    if (parsed.error) {
      return { error: parsed.error, raw: cleaned }
    }
    return parsed
  } catch {
    // Return partial object so the pipeline does not crash
    return {
      vendor: 'Desconocido',
      date: null,
      total: null,
      currency: 'MXN',
      subtotal: null,
      tax: null,
      category: 'Otro',
      items: [],
      notes: `No se pudo parsear la respuesta: ${cleaned.slice(0, 200)}`,
    }
  }
}

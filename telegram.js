// telegram.js — Telegram bot via Telegraf
import { Telegraf } from 'telegraf'
import { parseInvoice } from './gemini.js'
import { add } from './store.js'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, 'public', 'uploads')

function mimeToExt(mime) {
  const map = { 'image/png':'png', 'image/gif':'gif', 'image/webp':'webp' }
  return map[mime] ?? 'jpg'
}

let connected = false

export function isConnected() {
  return connected
}

export async function connectToTelegram(io) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error('[TG] TELEGRAM_BOT_TOKEN not set in .env')
    return
  }

  const allowedIds = process.env.ALLOWED_CHAT_IDS
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean) ?? []

  const bot = new Telegraf(token)

  bot.command('whoami', ctx => ctx.reply(`Tu Chat ID es: ${ctx.chat.id}`))

  async function handleMedia(ctx, fileId, mimetype) {
    if (allowedIds.length > 0 && !allowedIds.includes(String(ctx.chat.id))) {
      await ctx.reply('No estás autorizado para usar este bot.').catch(() => {})
      return
    }

    const from = String(ctx.chat.id)
    const timestamp = new Date().toISOString()

    try {
      await ctx.reply('Imagen recibida. Procesando con Gemini Vision, un momento...')
      io.emit('processing', { from, timestamp })

      const file = await ctx.telegram.getFile(fileId)
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`

      const res = await fetch(url)
      const buffer = Buffer.from(await res.arrayBuffer())

      const data = await parseInvoice(buffer, mimetype)

      const expense = add({ ...data, from, timestamp, imageMime: mimetype })

      // Persist receipt image for the detail view
      try {
        await mkdir(UPLOADS_DIR, { recursive: true })
        await writeFile(join(UPLOADS_DIR, `${expense.id}.${mimeToExt(mimetype)}`), buffer)
      } catch (e) {
        console.warn('[TG] Could not save image:', e.message)
      }

      io.emit('expense-added', expense)

      let replyText
      if (data.error) {
        replyText = `No pude procesar la imagen: ${data.error}`
      } else {
        const lines = ['Gasto registrado correctamente.', '']
        if (data.vendor)             lines.push(`Proveedor: ${data.vendor}`)
        if (data.date)               lines.push(`Fecha: ${data.date}`)
        lines.push(`Total: ${data.currency ?? 'MXN'} ${data.total ?? 'N/A'}`)
        if (data.subtotal != null)   lines.push(`Subtotal: ${data.currency ?? 'MXN'} ${data.subtotal}`)
        if (data.tax != null)        lines.push(`IVA: ${data.currency ?? 'MXN'} ${data.tax}`)
        if (data.category)           lines.push(`Categoría: ${data.category}`)
        if (data.items?.length > 0)  lines.push(`Artículos: ${data.items.length} línea(s)`)
        if (data.notes)              lines.push(`Nota: ${data.notes}`)
        replyText = lines.join('\n')
      }
      await ctx.reply(replyText)
    } catch (err) {
      console.error('[TG] Error processing media:', err.message, err.stack)
      io.emit('processing-error', { from, timestamp })
      await ctx.reply('Ocurrió un error al procesar tu imagen. Intenta de nuevo.').catch(() => {})
    }
  }

  // Photos (compressed by Telegram)
  bot.on('photo', async (ctx) => {
    const photo = ctx.message.photo.at(-1) // largest available size
    await handleMedia(ctx, photo.file_id, 'image/jpeg')
  })

  // Documents sent as files (PNG, JPG, etc.)
  bot.on('document', async (ctx) => {
    const doc = ctx.message.document
    if (!doc.mime_type?.startsWith('image/')) return
    await handleMedia(ctx, doc.file_id, doc.mime_type)
  })

  // Prevent crashes from unhandled middleware errors
  bot.catch((err, ctx) => {
    console.error('[TG] Unhandled handler error:', err.message, err.stack)
  })

  // bot.launch() resolves only when the bot stops, so don't await it
  bot.launch().catch(err => {
    console.error('[TG] Fatal launch error:', err.message)
  })

  connected = true
  console.log('[TG] Bot running.')
  io.emit('bot-ready')

  process.once('SIGINT',  () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

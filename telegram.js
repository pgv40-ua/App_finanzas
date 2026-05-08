// telegram.js — Telegram bot via Telegraf
import { Telegraf } from 'telegraf'
import { parseInvoice } from './gemini.js'
import { add } from './store.js'

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

  const bot = new Telegraf(token)

  async function handleMedia(ctx, fileId, mimetype) {
    const from = String(ctx.chat.id)
    const timestamp = new Date().toISOString()

    await ctx.reply('Imagen recibida. Procesando con Gemini Vision, un momento...')
    io.emit('processing', { from, timestamp })

    try {
      const file = await ctx.telegram.getFile(fileId)
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`

      const res = await fetch(url)
      const buffer = Buffer.from(await res.arrayBuffer())

      const data = await parseInvoice(buffer, mimetype)

      const expense = add({ ...data, from, timestamp })
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
      console.error('[TG] Error processing media:', err.message)
      await ctx.reply('Ocurrió un error al procesar tu imagen. Intenta de nuevo.')
      io.emit('processing-error', { from, timestamp })
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

  // bot.launch() resolves only when the bot stops, so don't await it
  bot.launch().catch(err => {
    console.error('[TG] Fatal:', err.message)
  })

  connected = true
  console.log('[TG] Bot running.')
  io.emit('bot-ready')

  process.once('SIGINT',  () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

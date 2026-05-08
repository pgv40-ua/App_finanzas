// whatsapp.js — Baileys singleton with Socket.io integration
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrTerminal from 'qrcode-terminal'
import qrcode from 'qrcode'
import pino from 'pino'
import { parseInvoice } from './gemini.js'
import { add } from './store.js'

let sockInstance = null
let connected = false
const logger = pino({ level: 'silent' })

export function isConnected() {
  return connected
}

export async function connectToWhatsApp(io) {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

  const sock = makeWASocket({
    auth: state,
    logger,
  })

  sockInstance = sock

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      // Debug in terminal
      qrTerminal.generate(qr, { small: true })

      // Deliver to web panel as base64 PNG
      try {
        const dataUrl = await qrcode.toDataURL(qr, { width: 280, margin: 2 })
        io.emit('qr', dataUrl)
      } catch (err) {
        console.error('[WA] QR generation error:', err.message)
      }
    }

    if (connection === 'close') {
      connected = false
      const statusCode = /** @type {Boom} */ (lastDisconnect?.error)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        console.log('[WA] Reconnecting...')
        connectToWhatsApp(io)
      } else {
        console.log('[WA] Logged out. Delete auth_info_baileys/ and restart.')
        io.emit('whatsapp-disconnected')
      }
    }

    if (connection === 'open') {
      connected = true
      console.log('[WA] Connected.')
      io.emit('whatsapp-ready')
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const m of messages) {
      // Guard: skip messages sent by the bot itself to avoid echo loops
      if (m.key.fromMe) continue

      const from = m.key.remoteJid
      const msg = m.message

      // Detect image or image-type document (PDF receipts use documentMessage)
      const mediaMsg =
        msg?.imageMessage ||
        (msg?.documentMessage?.mimetype?.startsWith('image/') ? msg.documentMessage : null)

      if (!mediaMsg) continue

      const mimetype = mediaMsg.mimetype || 'image/jpeg'
      const timestamp = m.messageTimestamp
        ? new Date(Number(m.messageTimestamp) * 1000).toISOString()
        : new Date().toISOString()

      // Immediate feedback to the sender
      await sock.sendMessage(from, {
        text: 'Imagen recibida. Procesando con Gemini Vision, un momento...',
      })

      // Notify the panel immediately so the skeleton card appears
      io.emit('processing', { from, timestamp })

      try {
        // Download media — 4th arg with reuploadRequest handles expired CDN links
        const buffer = await downloadMediaMessage(
          m,
          'buffer',
          {},
          { logger, reuploadRequest: sock.updateMediaMessage }
        )

        // Extract accounting data with Gemini Vision
        const data = await parseInvoice(buffer, mimetype)

        // Persist and broadcast
        const expense = add({ ...data, from, timestamp })
        io.emit('expense-added', expense)

        // Detailed reply to WhatsApp user
        let confirmText
        if (data.error) {
          confirmText = `No pude procesar la imagen: ${data.error}`
        } else {
          const lines = ['Gasto registrado correctamente.', '']
          if (data.vendor)           lines.push(`Proveedor: ${data.vendor}`)
          if (data.date)             lines.push(`Fecha: ${data.date}`)
          lines.push(`Total: ${data.currency ?? 'MXN'} ${data.total ?? 'N/A'}`)
          if (data.subtotal != null) lines.push(`Subtotal: ${data.currency ?? 'MXN'} ${data.subtotal}`)
          if (data.tax != null)      lines.push(`IVA: ${data.currency ?? 'MXN'} ${data.tax}`)
          if (data.category)         lines.push(`Categoría: ${data.category}`)
          if (data.items?.length > 0) lines.push(`Artículos: ${data.items.length} línea(s)`)
          if (data.notes)            lines.push(`Nota: ${data.notes}`)
          confirmText = lines.join('\n')
        }

        await sock.sendMessage(from, { text: confirmText })
      } catch (err) {
        console.error('[WA] Error processing media:', err.message)
        await sock.sendMessage(from, {
          text: 'Ocurrió un error al procesar tu imagen. Intenta de nuevo.',
        })
        io.emit('processing-error', { from, timestamp })
      }
    }
  })
}

export function getSock() {
  if (!sockInstance) throw new Error('WhatsApp not connected yet')
  return sockInstance
}

// telegram.js — Telegram bot via Telegraf (multi-tenant)
import { Telegraf } from 'telegraf'
import { parseInvoice, parseTextExpense } from './gemini.js'
import {
  addExpense, getExpensesForUser, getBudgetsForUser,
  getUserByChatId, consumeLinkCode, linkTelegram, unlinkTelegram, getUserById,
} from './store.js'
import { setBotRef, checkBudgetsOnExpense, checkAnomaly } from './alerts.js'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, 'public', 'uploads')

async function sendWebhook(expense) {
  const url = process.env.WEBHOOK_URL
  if (!url) return
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Verum': '1' },
    body: JSON.stringify(expense),
    signal: AbortSignal.timeout(5000),
  }).catch(err => console.warn('[Webhook] Failed:', err.message))
}

function mimeToExt(mime) {
  const map = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
  return map[mime] ?? 'jpg'
}

function toMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number)
  const name = new Date(y, m - 1, 1).toLocaleString('es-ES', { month: 'long' })
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`
}

function buildCSV(expenses) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = ['Fecha', 'Proveedor', 'Total', 'Moneda', 'Subtotal', 'IVA', 'Categoría', 'Notas', 'Autor']
  const lines  = expenses.map(e => [
    e.date ?? e.receivedAt?.slice(0, 10) ?? '',
    e.vendor ?? '', e.total ?? '', e.currency ?? 'MXN',
    e.subtotal ?? '', e.tax ?? '', e.category ?? '',
    e.notes ?? '', e.ownerName ?? '',
  ].map(escape).join(','))
  return [header.join(','), ...lines].join('\r\n')
}

let connected = false
export function isConnected() { return connected }

const LINK_PROMPT =
  '🔒 Aún no has vinculado tu cuenta.\n\n' +
  '1. Entra en el panel web y regístrate o inicia sesión.\n' +
  '2. En tu perfil, genera un código de vinculación.\n' +
  '3. Envíame `/link 123456` con tu código.'

export async function connectToTelegram({ io, emitExpenseEvent }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn('[TG] TELEGRAM_BOT_TOKEN not set — bot disabled')
    return
  }

  const bot = new Telegraf(token)
  setBotRef(bot)

  function userFromCtx(ctx) {
    return getUserByChatId(String(ctx.chat.id))
  }

  function scopeLabel(user) {
    if (user.account_type === 'company' && user.role === 'admin') return ' _(vista empresa)_'
    return ''
  }

  // ── Commands ─────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    const user = userFromCtx(ctx)
    if (!user) return ctx.reply(LINK_PROMPT, { parse_mode: 'Markdown' })
    ctx.reply(
      `👋 Hola ${user.name}!\n\n` +
      'Envíame una foto de cualquier factura o recibo y la registraré automáticamente.\n' +
      'Usa /help para ver todos los comandos disponibles.'
    )
  })

  bot.command('whoami', (ctx) => {
    const user = userFromCtx(ctx)
    if (!user) return ctx.reply(`Tu Chat ID es: \`${ctx.chat.id}\`\n\n${LINK_PROMPT}`, { parse_mode: 'Markdown' })
    ctx.reply(
      `👤 *${user.name}*\n` +
      `Email: ${user.email}\n` +
      `Tipo: ${user.account_type === 'particular' ? 'Particular' : `Empresa (${user.role})`}\n` +
      `Chat ID: \`${ctx.chat.id}\``,
      { parse_mode: 'Markdown' }
    )
  })

  bot.command('help', (ctx) => ctx.reply(
    '📋 *Comandos disponibles:*\n\n' +
    '📸 *Enviar foto* — Registra una factura automáticamente\n' +
    '`/link <código>` — Vincula este chat a tu cuenta\n' +
    '`/unlink` — Desvincula tu cuenta\n' +
    '`/stats` — Resumen del mes actual\n' +
    '`/budget` — Estado de presupuestos\n' +
    '`/last [N]` — Últimas facturas (default: 5)\n' +
    '`/export` — Exportar CSV del mes actual\n' +
    '`/whoami` — Ver tu cuenta vinculada\n' +
    '`/help` — Mostrar este mensaje',
    { parse_mode: 'Markdown' }
  ))

  bot.command('link', async (ctx) => {
    const parts = ctx.message.text.split(/\s+/)
    const code  = parts[1]?.trim()
    if (!code) return ctx.reply('Uso: `/link 123456` con el código generado en el panel web.', { parse_mode: 'Markdown' })

    if (userFromCtx(ctx)) {
      return ctx.reply('Este Telegram ya está vinculado. Usa /unlink primero si quieres cambiarlo.')
    }

    const userId = consumeLinkCode(code)
    if (!userId) return ctx.reply('❌ Código inválido o caducado. Genera uno nuevo en el panel web.')

    const existing = getUserById(userId)
    if (existing?.telegram_chat_id) {
      return ctx.reply('Esa cuenta ya tiene otro Telegram vinculado. Desvincúlalo primero desde el panel.')
    }

    try {
      const user = linkTelegram(userId, ctx.chat.id)
      ctx.reply(
        `✅ Cuenta vinculada correctamente.\n\nHola *${user.name}*, ya puedes enviarme facturas.`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      console.error('[TG] /link error:', err.message)
      ctx.reply('No se pudo vincular: ' + err.message)
    }
  })

  bot.command('unlink', async (ctx) => {
    const user = userFromCtx(ctx)
    if (!user) return ctx.reply('No hay ninguna cuenta vinculada a este chat.')
    unlinkTelegram(user.id)
    ctx.reply('🔓 Cuenta desvinculada. Vuelve a generar un código en el panel para reconectar.')
  })

  bot.command('stats', (ctx) => {
    const user = userFromCtx(ctx)
    if (!user) return ctx.reply(LINK_PROMPT, { parse_mode: 'Markdown' })

    const month = toMonthKey()
    const expenses = getExpensesForUser(user).filter(e => (e.date ?? e.receivedAt)?.slice(0, 7) === month)
    if (!expenses.length) return ctx.reply(`Sin facturas registradas en ${monthLabel(month)}.`)

    const total = expenses.reduce((s, e) => s + (Number(e.total) || 0), 0)
    const currency = expenses[0]?.currency ?? 'MXN'
    const catTotals = {}
    expenses.forEach(e => {
      const c = e.category || 'Otro'
      catTotals[c] = (catTotals[c] || 0) + (Number(e.total) || 0)
    })
    const catLines = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `  • ${c}: ${currency} ${v.toFixed(2)}`)
      .join('\n')

    ctx.reply(
      `📊 *Resumen — ${monthLabel(month)}*${scopeLabel(user)}\n\n` +
      `Total: *${currency} ${total.toFixed(2)}*\n` +
      `Facturas: ${expenses.length}\n` +
      `Promedio: ${currency} ${(total / expenses.length).toFixed(2)}\n\n` +
      `*Por categoría:*\n${catLines}`,
      { parse_mode: 'Markdown' }
    )
  })

  bot.command('budget', (ctx) => {
    const user = userFromCtx(ctx)
    if (!user) return ctx.reply(LINK_PROMPT, { parse_mode: 'Markdown' })

    const budgets = getBudgetsForUser(user)
    if (!budgets.length) return ctx.reply('No hay presupuestos configurados.\nPuedes crearlos desde el panel web.')

    const month = toMonthKey()
    const expenses = getExpensesForUser(user).filter(e => (e.date ?? e.receivedAt)?.slice(0, 7) === month)

    const lines = budgets.map(b => {
      const relevant = b.category ? expenses.filter(e => e.category === b.category) : expenses
      const spent = relevant.reduce((s, e) => s + (Number(e.total) || 0), 0)
      const pct   = spent / b.amount
      const bar   = pct >= 1 ? '🔴' : pct >= 0.8 ? '⚠️' : '🟢'
      const label = b.category ?? 'Global'
      return `${bar} *${label}*: ${b.currency} ${spent.toFixed(2)} / ${b.amount.toFixed(2)} (${Math.round(pct * 100)}%)`
    })

    ctx.reply(`📋 *Presupuestos — ${monthLabel(month)}*${scopeLabel(user)}\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
  })

  bot.command('last', (ctx) => {
    const user = userFromCtx(ctx)
    if (!user) return ctx.reply(LINK_PROMPT, { parse_mode: 'Markdown' })

    const args = ctx.message.text.split(' ')
    const n    = Math.min(Math.max(parseInt(args[1]) || 5, 1), 20)
    const list = getExpensesForUser(user).slice(0, n)
    if (!list.length) return ctx.reply('No hay facturas registradas.')

    const lines = list.map((e, i) => {
      const date = e.date ?? e.receivedAt?.slice(0, 10) ?? '—'
      const amt  = e.total != null ? `${e.currency ?? 'MXN'} ${Number(e.total).toFixed(2)}` : 'N/A'
      const who  = user.role === 'admin' && e.ownerName ? ` _(${e.ownerName})_` : ''
      return `${i + 1}. *${e.vendor ?? 'Desconocido'}* — ${amt} (${date})${who}`
    })

    ctx.reply(`🧾 *Últimas ${n} facturas:*${scopeLabel(user)}\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
  })

  bot.command('export', async (ctx) => {
    const user = userFromCtx(ctx)
    if (!user) return ctx.reply(LINK_PROMPT, { parse_mode: 'Markdown' })

    const month    = toMonthKey()
    const expenses = getExpensesForUser(user).filter(e => (e.date ?? e.receivedAt)?.slice(0, 7) === month)
    if (!expenses.length) return ctx.reply(`Sin facturas en ${monthLabel(month)} para exportar.`)

    try {
      const csv    = buildCSV(expenses)
      const buffer = Buffer.from('﻿' + csv, 'utf8')
      await ctx.replyWithDocument(
        { source: buffer, filename: `gastos-${month}.csv` },
        { caption: `📁 Gastos de ${monthLabel(month)} — ${expenses.length} facturas` }
      )
    } catch (err) {
      console.error('[TG] /export error:', err.message)
      ctx.reply('Error al generar el archivo CSV.').catch(() => {})
    }
  })

  // ── Media handler ─────────────────────────────────────────────

  async function handleMedia(ctx, fileId, mimetype) {
    const user = userFromCtx(ctx)
    if (!user) {
      await ctx.reply(LINK_PROMPT, { parse_mode: 'Markdown' }).catch(() => {})
      return
    }

    const timestamp = new Date().toISOString()

    try {
      await ctx.reply('Imagen recibida. Procesando con Gemini Vision, un momento...')
      io.to(`user:${user.id}`).emit('processing', { from: user.id, timestamp })

      const file = await ctx.telegram.getFile(fileId)
      const url  = `https://api.telegram.org/file/bot${token}/${file.file_path}`
      const res    = await fetch(url)
      const buffer = Buffer.from(await res.arrayBuffer())

      const data    = await parseInvoice(buffer, mimetype)
      const expense = addExpense(user, { ...data, from: 'telegram', timestamp, imageMime: mimetype })

      try {
        await mkdir(UPLOADS_DIR, { recursive: true })
        await writeFile(join(UPLOADS_DIR, `${expense.id}.${mimeToExt(mimetype)}`), buffer)
      } catch (e) {
        console.warn('[TG] Could not save image:', e.message)
      }

      emitExpenseEvent(io, 'expense-added', expense)
      checkBudgetsOnExpense(user, expense)
      sendWebhook(expense)

      const anomaly = checkAnomaly(expense, getExpensesForUser(user))
      if (anomaly) ctx.reply(anomaly.message, { parse_mode: 'Markdown' }).catch(() => {})

      let replyText
      if (data.error) {
        replyText = `No pude procesar la imagen: ${data.error}`
      } else {
        const lines = ['✅ Gasto registrado correctamente.', '']
        if (data.vendor)            lines.push(`🏪 Proveedor: ${data.vendor}`)
        if (data.date)              lines.push(`📅 Fecha: ${data.date}`)
        lines.push(`💰 Total: ${data.currency ?? 'MXN'} ${data.total ?? 'N/A'}`)
        if (data.subtotal != null)  lines.push(`   Subtotal: ${data.currency ?? 'MXN'} ${data.subtotal}`)
        if (data.tax != null)       lines.push(`   IVA: ${data.currency ?? 'MXN'} ${data.tax}`)
        if (data.category)          lines.push(`🏷️ Categoría: ${data.category}`)
        if (data.items?.length > 0) lines.push(`📋 Artículos: ${data.items.length} línea(s)`)
        if (data.notes)             lines.push(`📝 Nota: ${data.notes}`)
        replyText = lines.join('\n')
      }
      await ctx.reply(replyText)
    } catch (err) {
      console.error('[TG] Error processing media:', err.message, err.stack)
      io.to(`user:${user.id}`).emit('processing-error', { from: user.id, timestamp })
      await ctx.reply('Ocurrió un error al procesar tu imagen. Intenta de nuevo.').catch(() => {})
    }
  }

  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return
    const user = userFromCtx(ctx)
    if (!user) return ctx.reply(LINK_PROMPT, { parse_mode: 'Markdown' })

    const text      = ctx.message.text.trim()
    const timestamp = new Date().toISOString()

    try {
      await ctx.reply('Procesando gasto…')
      io.to(`user:${user.id}`).emit('processing', { from: user.id, timestamp })

      const data = await parseTextExpense(text)
      if (data.error) {
        io.to(`user:${user.id}`).emit('processing-error', { from: user.id, timestamp })
        return ctx.reply('No pude interpretar ese texto como gasto. Intenta: "McDonald\'s 250 MXN"')
      }

      const expense = addExpense(user, { ...data, from: 'telegram', timestamp })
      emitExpenseEvent(io, 'expense-added', expense)
      checkBudgetsOnExpense(user, expense)

      const anomaly = checkAnomaly(expense, getExpensesForUser(user))
      if (anomaly) ctx.reply(anomaly.message, { parse_mode: 'Markdown' }).catch(() => {})

      const lines = ['✅ Gasto registrado desde texto.', '']
      if (data.vendor)   lines.push(`🏪 Proveedor: ${data.vendor}`)
      if (data.date)     lines.push(`📅 Fecha: ${data.date}`)
      lines.push(`💰 Total: ${data.currency ?? 'MXN'} ${data.total}`)
      if (data.category) lines.push(`🏷️ Categoría: ${data.category}`)
      lines.push('', '_(Sin imagen — registrado como gasto manual)_')
      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' })
    } catch (err) {
      console.error('[TG] Error parsing text expense:', err.message)
      io.to(`user:${user.id}`).emit('processing-error', { from: user.id, timestamp })
      await ctx.reply('Ocurrió un error. Intenta de nuevo.').catch(() => {})
    }
  })

  bot.on('photo', async (ctx) => {
    const photo = ctx.message.photo.at(-1)
    await handleMedia(ctx, photo.file_id, 'image/jpeg')
  })

  bot.on('document', async (ctx) => {
    const doc = ctx.message.document
    if (!doc.mime_type?.startsWith('image/')) return
    await handleMedia(ctx, doc.file_id, doc.mime_type)
  })

  bot.catch((err) => console.error('[TG] Unhandled handler error:', err.message, err.stack))

  bot.launch().catch(err => console.error('[TG] Fatal launch error:', err.message))

  connected = true
  console.log('[TG] Bot running.')
  io.emit('bot-ready')

  process.once('SIGINT',  () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

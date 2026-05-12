// alerts.js — Budget alerts, anomaly detection, scheduled digests (per-user)

import {
  getBudgetsForUser, getExpensesForUser, getUserById,
  listUsersWithTelegram, listCompanyAdmins,
} from './store.js'

let botRef = null
const sentAlerts = new Set() // prevent duplicate alerts within same month per owner

export function setBotRef(bot) {
  botRef = bot
}

function sendChat(chatId, text) {
  if (!botRef || !chatId) return
  botRef.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(() => {})
}

// Notify the expense author + all company admins (if applicable)
function notifyTargets(user, text) {
  if (user.telegram_chat_id) sendChat(user.telegram_chat_id, text)
  if (user.account_type === 'company' && user.role === 'worker' && user.company_id) {
    for (const admin of listCompanyAdmins(user.company_id)) {
      if (admin.id !== user.id && admin.telegram_chat_id) sendChat(admin.telegram_chat_id, text)
    }
  }
}

// ── Budget alerts ────────────────────────────────────────────
export function checkBudgetsOnExpense(user, expense) {
  if (!botRef || !user || !expense) return

  const month = (expense.date ?? expense.receivedAt)?.slice(0, 7)
  if (!month) return

  const budgets = getBudgetsForUser(user)
  if (!budgets.length) return

  const monthExpenses = getExpensesForUser(user)
    .filter(e => (e.date ?? e.receivedAt)?.slice(0, 7) === month)

  for (const budget of budgets) {
    const relevant = budget.category
      ? monthExpenses.filter(e => e.category === budget.category)
      : monthExpenses

    const total = relevant.reduce((s, e) => s + (Number(e.total) || 0), 0)
    const pct   = total / budget.amount
    const label = budget.category ?? 'Presupuesto global'

    const ownerKey = `${budget.owner_type}:${budget.owner_id}`
    const key100   = `100:${month}:${budget.id}:${ownerKey}`
    const key80    = `80:${month}:${budget.id}:${ownerKey}`

    if (pct >= 1.0 && !sentAlerts.has(key100)) {
      sentAlerts.add(key100)
      notifyTargets(user,
        `🚨 *Presupuesto excedido: ${label}*\n` +
        `Gastado: ${budget.currency} ${total.toFixed(2)} / ${budget.amount.toFixed(2)} ` +
        `(${Math.round(pct * 100)}%)`)
    } else if (pct >= 0.8 && !sentAlerts.has(key80)) {
      sentAlerts.add(key80)
      notifyTargets(user,
        `⚠️ *Alerta: ${label} al ${Math.round(pct * 100)}%*\n` +
        `Gastado: ${budget.currency} ${total.toFixed(2)} / ${budget.amount.toFixed(2)}`)
    }
  }
}

// ── Anomaly detection (per-scope) ────────────────────────────
export function checkAnomaly(expense, scopedExpenses) {
  if (!expense?.total || !expense?.category) return null

  if (expense.vendor && expense.date) {
    const dup = scopedExpenses.find(e =>
      e.id !== expense.id &&
      e.vendor === expense.vendor &&
      e.date   === expense.date &&
      Math.abs(Number(e.total) - Number(expense.total)) / (Number(expense.total) || 1) < 0.05
    )
    if (dup) return {
      type: 'duplicate',
      message: `⚠️ Posible duplicado: ya hay un gasto de *${expense.vendor}* por ${expense.currency ?? 'MXN'} ${expense.total} en ${expense.date}.`,
    }
  }

  const prior = scopedExpenses.filter(e =>
    e.id !== expense.id && e.category === expense.category && e.total != null
  )
  if (prior.length >= 3) {
    const avg       = prior.reduce((s, e) => s + Number(e.total), 0) / prior.length
    const threshold = avg * 2.5
    if (Number(expense.total) > threshold) {
      return {
        type: 'anomaly',
        message:
          `📈 Gasto inusualmente alto en *${expense.category}*: ` +
          `${expense.currency ?? 'MXN'} ${Number(expense.total).toFixed(2)} ` +
          `(promedio histórico: ${Number(avg).toFixed(2)})`,
      }
    }
  }

  return null
}

// ── Scheduled digests (per user with Telegram linked) ────────

let lastDigestKey = ''

export function initDigests() {
  setInterval(() => {
    const now = new Date()
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`
    if (lastDigestKey === key) return

    const h              = now.getHours()
    const isMonday       = now.getDay() === 1
    const isFirstOfMonth = now.getDate() === 1

    if (h === 8 && isMonday)       { lastDigestKey = key; sendWeeklyDigest() }
    if (h === 8 && isFirstOfMonth) { lastDigestKey = key; sendMonthlyDigest() }
  }, 30 * 60 * 1000)
}

function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number)
  const name = new Date(y, m - 1, 1).toLocaleString('es-ES', { month: 'long' })
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`
}

function buildDigestText(title, expenses) {
  const total    = expenses.reduce((s, e) => s + (Number(e.total) || 0), 0)
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

  return (
    `${title}\n\n` +
    `Total: *${currency} ${total.toFixed(2)}*\n` +
    `Facturas: ${expenses.length}\n\n` +
    `*Por categoría:*\n${catLines}`
  )
}

function sendDigestForUser(user, title, monthKey) {
  const expenses = getExpensesForUser(user).filter(e => (e.date ?? e.receivedAt)?.slice(0, 7) === monthKey)
  if (!expenses.length) return
  sendChat(user.telegram_chat_id, buildDigestText(title, expenses))
}

function sendWeeklyDigest() {
  const now   = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  for (const u of listUsersWithTelegram()) {
    sendDigestForUser(u, `📊 *Resumen semanal — ${monthLabel(month)}*`, month)
  }
}

function sendMonthlyDigest() {
  const now  = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
  for (const u of listUsersWithTelegram()) {
    sendDigestForUser(u, `📅 *Cierre mensual — ${monthLabel(month)}*`, month)
  }
}

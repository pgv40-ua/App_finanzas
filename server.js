// server.js — Express + Socket.io entry point
import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { connectToTelegram, isConnected } from './telegram.js'
import {
  createUser, getUserByEmail, getUserById, getCompanyById, createCompany,
  getCompanyByInviteCode, rotateInviteCode, listCompanyUsers, removeUser,
  addExpense, getExpensesForUser, getExpenseForUser, updateExpenseForUser, removeExpenseForUser,
  getBudgetsForUser, setBudgetForUser, deleteBudgetForUser,
  createLinkCode,
} from './store.js'
import {
  hashPassword, verifyPassword, issueToken, revokeToken,
  authMiddleware, requireRole, sanitizeUser, userFromToken,
} from './auth.js'
import { setBotRef, checkBudgetsOnExpense, checkAnomaly, initDigests } from './alerts.js'
import { streamAssistant, isEnabled as isAssistantEnabled } from './assistant.js'

// ── Helpers ───────────────────────────────────────────────────
async function sendWebhook(expense) {
  const url = process.env.WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Verum': '1' },
      body: JSON.stringify(expense),
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    console.warn('[Webhook] Failed:', err.message)
  }
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function roomForExpense(expense) {
  // Returns the *primary* owner room. The company admin room is fanned out separately.
  return `user:${expense.userId}`
}

function emitExpenseEvent(io, event, expense) {
  io.to(`user:${expense.userId}`).emit(event, expense)
  if (expense.companyId) io.to(`company:${expense.companyId}`).emit(event, expense)
}

// ── Express setup ─────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", 'cdn.jsdelivr.net'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc:    ["'self'", 'fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
}))

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false })
app.use('/api/', apiLimiter)

app.use(express.json({ limit: '256kb' }))
app.use(express.static(join(__dirname, 'public')))

// ── Auth: register / login / logout / me ─────────────────────

function attachCompany(user) {
  const safe = sanitizeUser(user)
  if (safe?.company_id) safe.company = getCompanyById(safe.company_id)
  return safe
}

app.post('/api/auth/register/particular', (req, res) => {
  const { email, password, name } = req.body ?? {}
  if (!isValidEmail(email))       return res.status(400).json({ error: 'Email inválido' })
  if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
  if (!name?.trim())              return res.status(400).json({ error: 'El nombre es obligatorio' })
  if (getUserByEmail(email))      return res.status(409).json({ error: 'Ese email ya está registrado' })

  const user  = createUser({ email, passwordHash: hashPassword(password), name, accountType: 'particular' })
  const token = issueToken(user.id)
  res.status(201).json({ token, user: attachCompany(user) })
})

app.post('/api/auth/register/company', (req, res) => {
  const { companyName, adminEmail, adminPassword, adminName } = req.body ?? {}
  if (!companyName?.trim())         return res.status(400).json({ error: 'El nombre de la empresa es obligatorio' })
  if (!isValidEmail(adminEmail))    return res.status(400).json({ error: 'Email inválido' })
  if (!adminPassword || adminPassword.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
  if (!adminName?.trim())           return res.status(400).json({ error: 'El nombre del administrador es obligatorio' })
  if (getUserByEmail(adminEmail))   return res.status(409).json({ error: 'Ese email ya está registrado' })

  const company = createCompany({ name: companyName.trim() })
  const user    = createUser({
    email: adminEmail,
    passwordHash: hashPassword(adminPassword),
    name: adminName,
    accountType: 'company',
    companyId: company.id,
    role: 'admin',
  })
  const token = issueToken(user.id)
  res.status(201).json({ token, user: attachCompany(user), inviteCode: company.inviteCode })
})

app.post('/api/auth/register/worker', (req, res) => {
  const { email, password, name, inviteCode } = req.body ?? {}
  if (!isValidEmail(email))      return res.status(400).json({ error: 'Email inválido' })
  if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' })
  if (!name?.trim())             return res.status(400).json({ error: 'El nombre es obligatorio' })
  if (!inviteCode?.trim())       return res.status(400).json({ error: 'Código de invitación requerido' })

  const company = getCompanyByInviteCode(inviteCode.trim())
  if (!company)                  return res.status(400).json({ error: 'Código de invitación no válido' })
  if (getUserByEmail(email))     return res.status(409).json({ error: 'Ese email ya está registrado' })

  const user = createUser({
    email,
    passwordHash: hashPassword(password),
    name,
    accountType: 'company',
    companyId: company.id,
    role: 'worker',
  })
  const token = issueToken(user.id)
  res.status(201).json({ token, user: attachCompany(user) })
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })
  const user = getUserByEmail(email)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' })
  }
  const token = issueToken(user.id)
  res.json({ token, user: attachCompany(user) })
})

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  revokeToken(req.token)
  res.json({ ok: true })
})

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: attachCompany(req.user) })
})

// ── CSV export (token via query for browser download) ────────
app.get('/api/export', authMiddleware, (req, res) => {
  const { month } = req.query
  const all = getExpensesForUser(req.user)
  const rows = month
    ? all.filter(e => (e.date ?? e.receivedAt)?.slice(0, 7) === month)
    : all

  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = ['Fecha', 'Proveedor', 'Total', 'Moneda', 'Subtotal', 'IVA', 'Categoría', 'Notas', 'Autor']
  const lines  = rows.map(e => [
    e.date ?? e.receivedAt?.slice(0, 10) ?? '',
    e.vendor ?? '', e.total ?? '', e.currency ?? 'MXN',
    e.subtotal ?? '', e.tax ?? '', e.category ?? '',
    e.notes ?? '', e.ownerName ?? '',
  ].map(escape).join(','))

  const csv      = [header.join(','), ...lines].join('\r\n')
  const filename = month ? `gastos-${month}.csv` : 'gastos.csv'
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send('﻿' + csv)
})

// ── Expense CRUD ─────────────────────────────────────────────
app.get('/api/expenses', authMiddleware, (req, res) => {
  const all   = getExpensesForUser(req.user)
  const page  = Math.max(1, parseInt(req.query.page)  || 1)
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50))
  const month = req.query.month
  const filtered = month ? all.filter(e => (e.date ?? e.receivedAt)?.slice(0, 7) === month) : all
  res.json({ total: filtered.length, page, limit, items: filtered.slice((page - 1) * limit, page * limit) })
})

app.post('/api/expenses', authMiddleware, (req, res) => {
  const { vendor, date, total, currency, subtotal, tax, category, notes, items } = req.body ?? {}
  if (!total || isNaN(Number(total))) {
    return res.status(400).json({ error: 'El campo total es requerido y debe ser numérico' })
  }
  const expense = addExpense(req.user, {
    vendor: vendor?.trim() || 'Sin proveedor',
    date: date || null,
    total: Number(total),
    currency: currency?.trim() || 'MXN',
    subtotal: subtotal != null ? Number(subtotal) : null,
    tax: tax != null ? Number(tax) : null,
    category: category || 'Otro',
    notes: notes?.trim() || null,
    items: Array.isArray(items) ? items : [],
    from: 'manual',
    timestamp: new Date().toISOString(),
  })
  emitExpenseEvent(io, 'expense-added', expense)
  checkBudgetsOnExpense(req.user, expense)
  sendWebhook(expense)
  const anomaly = checkAnomaly(expense, getExpensesForUser(req.user))
  res.status(201).json({ ...expense, _anomaly: anomaly ?? undefined })
})

app.patch('/api/expenses/:id', authMiddleware, (req, res) => {
  const { vendor, date, total, currency, subtotal, tax, category, notes } = req.body ?? {}
  const patch = {}
  if (vendor   !== undefined) patch.vendor   = vendor?.trim() || 'Sin proveedor'
  if (date     !== undefined) patch.date     = date || null
  if (total    !== undefined) patch.total    = Number(total)
  if (currency !== undefined) patch.currency = currency?.trim() || 'MXN'
  if (subtotal !== undefined) patch.subtotal = subtotal != null ? Number(subtotal) : null
  if (tax      !== undefined) patch.tax      = tax != null ? Number(tax) : null
  if (category !== undefined) patch.category = category || 'Otro'
  if (notes    !== undefined) patch.notes    = notes?.trim() || null

  const updated = updateExpenseForUser(req.user, req.params.id, patch)
  if (!updated) return res.status(404).json({ error: 'Gasto no encontrado' })
  emitExpenseEvent(io, 'expense-updated', updated)
  res.json(updated)
})

app.delete('/api/expenses/:id', authMiddleware, (req, res) => {
  const existing = getExpenseForUser(req.user, req.params.id)
  if (!existing) return res.status(404).json({ error: 'Gasto no encontrado' })
  removeExpenseForUser(req.user, req.params.id)
  io.to(`user:${existing.userId}`).emit('expense-deleted', { id: req.params.id })
  if (existing.companyId) io.to(`company:${existing.companyId}`).emit('expense-deleted', { id: req.params.id })
  res.json({ ok: true })
})

// ── Budgets ──────────────────────────────────────────────────
app.get('/api/budgets', authMiddleware, (req, res) => {
  res.json(getBudgetsForUser(req.user))
})

app.post('/api/budgets', authMiddleware, (req, res) => {
  const { category, amount, currency } = req.body ?? {}
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'El importe debe ser un número positivo' })
  }
  const budget = setBudgetForUser(req.user, {
    category: category || null,
    amount: Number(amount),
    currency: currency?.trim() || 'MXN',
  })
  // emit to budget owner's room
  const room = budget.owner_type === 'company' ? `company:${budget.owner_id}` : `user:${budget.owner_id}`
  io.to(room).emit('budget-updated', budget)
  res.status(201).json(budget)
})

app.delete('/api/budgets/:id', authMiddleware, (req, res) => {
  const ok = deleteBudgetForUser(req.user, req.params.id)
  if (!ok) return res.status(404).json({ error: 'Presupuesto no encontrado' })
  const room = req.user.account_type === 'company' && req.user.role === 'admin'
    ? `company:${req.user.company_id}` : `user:${req.user.id}`
  io.to(room).emit('budget-deleted', { id: req.params.id })
  res.json({ ok: true })
})

// ── Telegram linking ─────────────────────────────────────────
app.post('/api/telegram/link-code', authMiddleware, (req, res) => {
  const { code, expiresAt } = createLinkCode(req.user.id)
  res.json({ code, expiresAt })
})

// ── Admin endpoints ──────────────────────────────────────────
app.get('/api/admin/invite-code', authMiddleware, requireRole('admin'), (req, res) => {
  const company = getCompanyById(req.user.company_id)
  res.json({ inviteCode: company?.invite_code ?? null })
})

app.post('/api/admin/invite-code/rotate', authMiddleware, requireRole('admin'), (req, res) => {
  const code = rotateInviteCode(req.user.company_id)
  res.json({ inviteCode: code })
})

app.get('/api/admin/users', authMiddleware, requireRole('admin'), (req, res) => {
  res.json(listCompanyUsers(req.user.company_id))
})

app.delete('/api/admin/users/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const target = getUserById(req.params.id)
  if (!target || target.company_id !== req.user.company_id) {
    return res.status(404).json({ error: 'Usuario no encontrado' })
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' })
  }
  removeUser(target.id)
  res.json({ ok: true })
})

// ── AI Assistant ─────────────────────────────────────────────
app.post('/api/assistant', authMiddleware, async (req, res) => {
  if (!isAssistantEnabled()) {
    return res.status(503).json({ error: 'Asistente no configurado. Añade GEMINI_API_KEY a tu .env' })
  }
  const { message, history = [] } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'Mensaje requerido' })
  await streamAssistant(message.trim(), history, getExpensesForUser(req.user), res)
})

app.get('/api/assistant/status', authMiddleware, (req, res) => {
  res.json({ enabled: isAssistantEnabled() })
})

// ── Socket.io: auth in handshake + rooms ─────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token
  const user  = userFromToken(token)
  if (!user) return next(new Error('unauthorized'))
  socket.data.user = user
  next()
})

io.on('connection', (socket) => {
  const u = socket.data.user
  socket.join(`user:${u.id}`)
  if (u.account_type === 'company' && u.role === 'admin' && u.company_id) {
    socket.join(`company:${u.company_id}`)
  }
  socket.emit('init', {
    expenses:  getExpensesForUser(u),
    budgets:   getBudgetsForUser(u),
    connected: isConnected(),
  })
})

const PORT = process.env.PORT ?? 3000
httpServer.listen(PORT, () => {
  console.log(`[Server] Running at http://localhost:${PORT}`)
})

// Start Telegram bot with helpers it needs
connectToTelegram({ io, emitExpenseEvent }).catch((err) => {
  console.error('[TG] Fatal startup error:', err.message)
})

initDigests()

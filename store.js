// store.js — SQLite persistence layer (multi-tenant)
import Database from 'better-sqlite3'
import { randomBytes, randomInt } from 'crypto'

const db = new Database('app.db')
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── Schema ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    name              TEXT NOT NULL,
    account_type      TEXT NOT NULL CHECK (account_type IN ('particular','company')),
    company_id        TEXT REFERENCES companies(id) ON DELETE SET NULL,
    role              TEXT CHECK (role IN ('admin','worker')),
    telegram_chat_id  TEXT UNIQUE,
    created_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS link_codes (
    code        TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
    data        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id          TEXT PRIMARY KEY,
    owner_type  TEXT NOT NULL CHECK (owner_type IN ('user','company')),
    owner_id    TEXT NOT NULL,
    category    TEXT,
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'MXN'
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_user    ON expenses(user_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_company ON expenses(company_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_chat       ON users(telegram_chat_id);
  CREATE INDEX IF NOT EXISTS idx_budgets_owner    ON budgets(owner_type, owner_id);
`)

// ── ID helpers ────────────────────────────────────────────────
const newId = () => randomBytes(8).toString('hex')
const newInviteCode = () => randomBytes(4).toString('hex').toUpperCase()
const nowIso = () => new Date().toISOString()

// ── Companies ────────────────────────────────────────────────
const insertCompanyStmt = db.prepare(
  'INSERT INTO companies (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)'
)
const getCompanyByIdStmt     = db.prepare('SELECT * FROM companies WHERE id = ?')
const getCompanyByInviteStmt = db.prepare('SELECT * FROM companies WHERE invite_code = ?')
const updateInviteCodeStmt   = db.prepare('UPDATE companies SET invite_code = ? WHERE id = ?')

export function createCompany({ name }) {
  const id = newId()
  let inviteCode = newInviteCode()
  for (let i = 0; i < 5 && getCompanyByInviteStmt.get(inviteCode); i++) inviteCode = newInviteCode()
  insertCompanyStmt.run(id, name, inviteCode, nowIso())
  return { id, name, inviteCode }
}

export function getCompanyById(id) {
  return getCompanyByIdStmt.get(id) ?? null
}

export function getCompanyByInviteCode(code) {
  return getCompanyByInviteStmt.get(String(code ?? '').toUpperCase()) ?? null
}

export function rotateInviteCode(companyId) {
  let code = newInviteCode()
  for (let i = 0; i < 5 && getCompanyByInviteStmt.get(code); i++) code = newInviteCode()
  updateInviteCodeStmt.run(code, companyId)
  return code
}

// ── Users ────────────────────────────────────────────────────
const insertUserStmt = db.prepare(`
  INSERT INTO users (id, email, password_hash, name, account_type, company_id, role, telegram_chat_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
`)
const getUserByIdStmt    = db.prepare('SELECT * FROM users WHERE id = ?')
const getUserByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?')
const getUserByChatStmt  = db.prepare('SELECT * FROM users WHERE telegram_chat_id = ?')
const setChatIdStmt      = db.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?')
const listCompanyUsersStmt = db.prepare(
  'SELECT id, email, name, role, telegram_chat_id, created_at FROM users WHERE company_id = ? ORDER BY role DESC, created_at ASC'
)
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?')

export function createUser({ email, passwordHash, name, accountType, companyId = null, role = null }) {
  const id = newId()
  insertUserStmt.run(id, email.toLowerCase().trim(), passwordHash, name.trim(), accountType, companyId, role, nowIso())
  return getUserByIdStmt.get(id)
}

export function getUserById(id) {
  return getUserByIdStmt.get(id) ?? null
}

export function getUserByEmail(email) {
  if (!email) return null
  return getUserByEmailStmt.get(email.toLowerCase().trim()) ?? null
}

export function getUserByChatId(chatId) {
  if (chatId == null) return null
  return getUserByChatStmt.get(String(chatId)) ?? null
}

export function linkTelegram(userId, chatId) {
  setChatIdStmt.run(String(chatId), userId)
  return getUserById(userId)
}

export function unlinkTelegram(userId) {
  setChatIdStmt.run(null, userId)
  return getUserById(userId)
}

export function listCompanyUsers(companyId) {
  return listCompanyUsersStmt.all(companyId)
}

export function removeUser(id) {
  return deleteUserStmt.run(id).changes > 0
}

// ── Sessions ─────────────────────────────────────────────────
const insertSessionStmt = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
const getSessionStmt    = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?')
const purgeSessionsStmt = db.prepare('DELETE FROM sessions WHERE expires_at < ?')

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function createSession(userId, ttlMs = SESSION_TTL_MS) {
  const token = randomBytes(32).toString('hex')
  insertSessionStmt.run(token, userId, Date.now() + ttlMs)
  return token
}

export function getSessionUser(token) {
  if (!token) return null
  const row = getSessionStmt.get(token)
  if (!row) return null
  if (Date.now() > row.expires_at) {
    deleteSessionStmt.run(token)
    return null
  }
  return getUserById(row.user_id)
}

export function destroySession(token) {
  if (!token) return
  deleteSessionStmt.run(token)
}

export function purgeExpiredSessions() {
  purgeSessionsStmt.run(Date.now())
}

// ── Link codes (Telegram linking) ────────────────────────────
const insertLinkCodeStmt = db.prepare('INSERT INTO link_codes (code, user_id, expires_at) VALUES (?, ?, ?)')
const getLinkCodeStmt    = db.prepare('SELECT user_id, expires_at FROM link_codes WHERE code = ?')
const deleteLinkCodeStmt = db.prepare('DELETE FROM link_codes WHERE code = ?')
const purgeLinkCodesStmt = db.prepare('DELETE FROM link_codes WHERE expires_at < ?')
const deleteUserLinkCodesStmt = db.prepare('DELETE FROM link_codes WHERE user_id = ?')

const LINK_TTL_MS = 10 * 60 * 1000

export function createLinkCode(userId) {
  purgeLinkCodesStmt.run(Date.now())
  deleteUserLinkCodesStmt.run(userId)
  let code = String(randomInt(100000, 1000000))
  for (let i = 0; i < 5 && getLinkCodeStmt.get(code); i++) code = String(randomInt(100000, 1000000))
  insertLinkCodeStmt.run(code, userId, Date.now() + LINK_TTL_MS)
  return { code, expiresAt: Date.now() + LINK_TTL_MS }
}

export function consumeLinkCode(code) {
  if (!code) return null
  const row = getLinkCodeStmt.get(String(code))
  if (!row) return null
  deleteLinkCodeStmt.run(String(code))
  if (Date.now() > row.expires_at) return null
  return row.user_id
}

// ── Expenses ─────────────────────────────────────────────────
const insertExpenseStmt = db.prepare('INSERT INTO expenses (id, user_id, company_id, data) VALUES (?, ?, ?, ?)')
const getExpenseByIdStmt = db.prepare('SELECT user_id, company_id, data FROM expenses WHERE id = ?')
const updateExpenseStmt  = db.prepare('UPDATE expenses SET data = ? WHERE id = ?')
const deleteExpenseStmt  = db.prepare('DELETE FROM expenses WHERE id = ?')
const selectByUserStmt   = db.prepare('SELECT data FROM expenses WHERE user_id = ? ORDER BY rowid DESC')
const selectByCompanyStmt = db.prepare('SELECT data FROM expenses WHERE company_id = ? ORDER BY rowid DESC')

function expenseScopeQuery(user) {
  if (user.account_type === 'company' && user.role === 'admin') {
    return selectByCompanyStmt.all(user.company_id)
  }
  return selectByUserStmt.all(user.id)
}

export function addExpense(user, payload) {
  const id   = `${Date.now()}-${randomBytes(2).toString('hex')}`
  const full = {
    ...payload,
    id,
    userId: user.id,
    ownerName: user.name,
    companyId: user.company_id ?? null,
    receivedAt: payload.receivedAt ?? nowIso(),
  }
  insertExpenseStmt.run(id, user.id, user.company_id ?? null, JSON.stringify(full))
  return full
}

export function getExpensesForUser(user) {
  return expenseScopeQuery(user).map(r => JSON.parse(r.data))
}

export function getExpenseForUser(user, id) {
  const row = getExpenseByIdStmt.get(id)
  if (!row) return null
  if (!canAccessExpense(user, row)) return null
  return JSON.parse(row.data)
}

export function updateExpenseForUser(user, id, patch) {
  const row = getExpenseByIdStmt.get(id)
  if (!row) return null
  if (!canAccessExpense(user, row)) return null
  const existing = JSON.parse(row.data)
  const updated  = { ...existing, ...patch, id }
  updateExpenseStmt.run(JSON.stringify(updated), id)
  return updated
}

export function removeExpenseForUser(user, id) {
  const row = getExpenseByIdStmt.get(id)
  if (!row) return false
  if (!canAccessExpense(user, row)) return false
  deleteExpenseStmt.run(id)
  return true
}

function canAccessExpense(user, row) {
  if (user.account_type === 'particular') return row.user_id === user.id
  if (user.role === 'admin') return row.company_id === user.company_id
  return row.user_id === user.id
}

// ── Budgets ──────────────────────────────────────────────────
const insertBudgetStmt = db.prepare(
  'INSERT INTO budgets (id, owner_type, owner_id, category, amount, currency) VALUES (?, ?, ?, ?, ?, ?)'
)
const updateBudgetAmountStmt = db.prepare('UPDATE budgets SET amount = ?, currency = ? WHERE id = ?')
const getBudgetByOwnerCategoryStmt = db.prepare(
  "SELECT * FROM budgets WHERE owner_type = ? AND owner_id = ? AND IFNULL(category, '') = IFNULL(?, '')"
)
const getBudgetByIdStmt = db.prepare('SELECT * FROM budgets WHERE id = ?')
const listBudgetsByOwnerStmt = db.prepare(
  'SELECT * FROM budgets WHERE owner_type = ? AND owner_id = ? ORDER BY category ASC NULLS LAST'
)
const deleteBudgetStmt = db.prepare('DELETE FROM budgets WHERE id = ?')

function budgetOwnerFor(user) {
  if (user.account_type === 'company' && user.role === 'admin') {
    return { type: 'company', id: user.company_id }
  }
  return { type: 'user', id: user.id }
}

export function getBudgetsForUser(user) {
  const o = budgetOwnerFor(user)
  return listBudgetsByOwnerStmt.all(o.type, o.id)
}

export function setBudgetForUser(user, { category, amount, currency = 'MXN' }) {
  const o = budgetOwnerFor(user)
  const cat = category ?? null
  const existing = getBudgetByOwnerCategoryStmt.get(o.type, o.id, cat)
  if (existing) {
    updateBudgetAmountStmt.run(Number(amount), currency, existing.id)
    return { ...existing, amount: Number(amount), currency }
  }
  const id = newId()
  insertBudgetStmt.run(id, o.type, o.id, cat, Number(amount), currency)
  return { id, owner_type: o.type, owner_id: o.id, category: cat, amount: Number(amount), currency }
}

export function deleteBudgetForUser(user, id) {
  const o   = budgetOwnerFor(user)
  const row = getBudgetByIdStmt.get(id)
  if (!row) return false
  if (row.owner_type !== o.type || row.owner_id !== o.id) return false
  return deleteBudgetStmt.run(id).changes > 0
}

// ── Misc utilities used by alerts/digests ────────────────────
const listUsersWithChatStmt = db.prepare(
  "SELECT id, email, name, account_type, company_id, role, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL"
)

export function listUsersWithTelegram() {
  return listUsersWithChatStmt.all()
}

const listCompanyAdminsStmt = db.prepare(
  "SELECT * FROM users WHERE company_id = ? AND role = 'admin'"
)

export function listCompanyAdmins(companyId) {
  return listCompanyAdminsStmt.all(companyId)
}

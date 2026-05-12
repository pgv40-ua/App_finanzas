// auth.js — password hashing, sessions, and request guards
import bcrypt from 'bcryptjs'
import { createSession, getSessionUser, destroySession, purgeExpiredSessions } from './store.js'

const ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10

// Purge expired sessions every hour
setInterval(() => { try { purgeExpiredSessions() } catch {} }, 60 * 60 * 1000).unref?.()

export function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), ROUNDS)
}

export function verifyPassword(plain, hash) {
  if (!plain || !hash) return false
  try { return bcrypt.compareSync(String(plain), hash) } catch { return false }
}

export function issueToken(userId) {
  return createSession(userId)
}

export function revokeToken(token) {
  destroySession(token)
}

export function userFromToken(token) {
  return getSessionUser(token)
}

export function sanitizeUser(user) {
  if (!user) return null
  const { password_hash, ...safe } = user
  return safe
}

// ── Express middlewares ─────────────────────────────────────

function extractToken(req) {
  const header = req.headers.authorization ?? ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return req.query?.token ?? null
}

export function authMiddleware(req, res, next) {
  const token = extractToken(req)
  const user  = getSessionUser(token)
  if (!user) return res.status(401).json({ error: 'No autorizado' })
  req.user  = user
  req.token = token
  next()
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acceso restringido' })
    }
    next()
  }
}

export function requireAccountType(type) {
  return (req, res, next) => {
    if (req.user?.account_type !== type) {
      return res.status(403).json({ error: 'Acceso restringido' })
    }
    next()
  }
}

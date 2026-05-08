import Database from 'better-sqlite3'

const db = new Database('expenses.db')

db.exec(`CREATE TABLE IF NOT EXISTS expenses (
  id   TEXT PRIMARY KEY,
  data TEXT NOT NULL
)`)

const insertStmt    = db.prepare('INSERT INTO expenses (id, data) VALUES (?, ?)')
const selectAllStmt = db.prepare('SELECT data FROM expenses ORDER BY rowid DESC')

export function add(expense) {
  const id   = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const full = { ...expense, id, receivedAt: new Date().toISOString() }
  insertStmt.run(id, JSON.stringify(full))
  return full
}

export function getAll() {
  return selectAllStmt.all().map(row => JSON.parse(row.data))
}

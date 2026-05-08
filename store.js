// store.js — in-memory expense store (no database needed for demo)
const expenses = []

export function add(expense) {
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    receivedAt: new Date().toISOString(),
    ...expense,
  }
  expenses.unshift(record)
  return record
}

export function getAll() {
  return [...expenses]
}

// server.js — Express + Socket.io entry point
// dotenv/config must be the very first import so process.env is populated
import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { connectToTelegram, isConnected } from './telegram.js'
import { getAll } from './store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const httpServer = createServer(app)

// Socket.io attached to the same HTTP server — no CORS issues on localhost
const io = new Server(httpServer)

// Serve the web panel from public/
app.use(express.static(join(__dirname, 'public')))

// CSV export — GET /api/export?month=YYYY-MM
app.get('/api/export', (req, res) => {
  const { month } = req.query
  const all = getAll()

  const rows = month
    ? all.filter(e => {
        const d = e.date ?? e.receivedAt
        return d && d.slice(0, 7) === month
      })
    : all

  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`

  const header = ['Fecha', 'Proveedor', 'Total', 'Moneda', 'Subtotal', 'IVA', 'Categoría', 'Notas', 'Chat ID']
  const lines  = rows.map(e => [
    e.date ?? e.receivedAt?.slice(0, 10) ?? '',
    e.vendor   ?? '',
    e.total    ?? '',
    e.currency ?? 'MXN',
    e.subtotal ?? '',
    e.tax      ?? '',
    e.category ?? '',
    e.notes    ?? '',
    e.from     ?? '',
  ].map(escape).join(','))

  const csv      = [header.join(','), ...lines].join('\r\n')
  const filename = month ? `gastos-${month}.csv` : 'gastos.csv'

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send('﻿' + csv) // UTF-8 BOM so Excel opens it correctly
})

io.on('connection', (socket) => {
  console.log('[IO] Client connected:', socket.id)
  // Send current state immediately so page loads with data on reload
  socket.emit('init', {
    expenses: getAll(),
    connected: isConnected(),
  })
})

const PORT = process.env.PORT ?? 3000

httpServer.listen(PORT, () => {
  console.log(`[Server] Running at http://localhost:${PORT}`)
})

// Start Telegram bot — pass io so it can push real-time events
connectToTelegram(io).catch((err) => {
  console.error('[TG] Fatal startup error:', err.message)
})

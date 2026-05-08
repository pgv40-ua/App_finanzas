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

// assistant.js — Gemini AI streaming assistant for expense analysis

import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

export function isEnabled() {
  return !!process.env.GEMINI_API_KEY
}

export async function streamAssistant(message, history, expenses, res) {
  const today  = new Date().toISOString().slice(0, 10)
  const sample = expenses.slice(0, 300)

  const systemInstruction =
    `Eres un asistente financiero experto integrado en un sistema de gestión de gastos empresariales.\n` +
    `Hoy es ${today}. Responde siempre en español, de forma concisa, clara y útil.\n` +
    `Cuando menciones montos usa la misma moneda de los datos. Puedes hacer cálculos, ` +
    `comparaciones, detectar tendencias y hacer proyecciones basadas en el historial.\n\n` +
    `HISTORIAL COMPLETO DE GASTOS (${expenses.length} registros totales, mostrando los últimos ${sample.length}):\n` +
    JSON.stringify(sample, null, 2)

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction,
    })

    // Gemini uses 'model' instead of 'assistant' for the AI role
    const geminiHistory = history.slice(-10).map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }))

    const chat   = model.startChat({ history: geminiHistory })
    const result = await chat.sendMessageStream(message)

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`)
    }
  } catch (err) {
    console.error('[AI] Stream error:', err.message)
    res.write(`data: ${JSON.stringify({ error: 'Error al conectar con el asistente. Verifica tu GEMINI_API_KEY.' })}\n\n`)
  }

  res.write('data: [DONE]\n\n')
  res.end()
}

// test-gemini.js — standalone Gemini vision diagnostic
import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MODELS_TO_TEST = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash']

const PROMPT = `Di exactamente: {"vendor":"TEST_OK","total":1.00,"currency":"MXN","date":null,"subtotal":null,"tax":null,"category":"Otro","items":[],"notes":"test"}`

async function testModel(modelName, imagePart) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: modelName })
  try {
    const result = await model.generateContent([PROMPT, imagePart])
    const text = result.response.text().trim()
    console.log(`  ✅ ${modelName} — OK`)
    console.log(`     Response: ${text.slice(0, 120)}`)
    return true
  } catch (err) {
    console.log(`  ❌ ${modelName} — FAIL: ${err.message?.slice(0, 150)}`)
    return false
  }
}

async function main() {
  console.log('\n=== Gemini API Diagnostic ===')
  console.log(`API Key: ${process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.slice(0, 10) + '...' : 'NOT SET'}`)

  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not set in .env')
    process.exit(1)
  }

  // Use a tiny 1x1 white PNG as test image (no external file needed)
  const tiny1x1png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  const imagePart = { inlineData: { data: tiny1x1png.toString('base64'), mimeType: 'image/png' } }

  console.log('\nTesting models with a minimal image:\n')
  let anyPassed = false
  for (const m of MODELS_TO_TEST) {
    const ok = await testModel(m, imagePart)
    if (ok) anyPassed = true
  }

  if (!anyPassed) {
    console.log('\n⚠️  All models failed. Possible causes:')
    console.log('   1. API key is invalid or revoked')
    console.log('   2. Billing not enabled on Google AI Studio')
    console.log('   3. Regional restriction on your account')
    console.log('\n   Check: https://aistudio.google.com/app/apikey')
  } else {
    console.log('\n✅ At least one model works — Gemini is operational.')
  }
  console.log()
}

main()

// login.js — login + register flow (extracted to satisfy CSP)

const $ = (id) => document.getElementById(id)

function setError(el, msg)  { el.textContent = msg; el.classList.add('visible') }
function clearError(el)     { el.classList.remove('visible'); el.textContent = '' }

// If already authenticated, redirect to dashboard
const stored = localStorage.getItem('em_token')
if (stored) {
  fetch('/api/me', { headers: { Authorization: 'Bearer ' + stored } })
    .then(r => { if (r.ok) window.location.replace('/') })
    .catch(() => {})
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn))
    $('pane-login').classList.toggle('hidden',    btn.dataset.tab !== 'login')
    $('pane-register').classList.toggle('hidden', btn.dataset.tab !== 'register')
  })
})

// Account-type selector
let regType = 'particular'
document.querySelectorAll('.type-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.type-card').forEach(c => c.classList.toggle('active', c === card))
    regType = card.dataset.type
    $('fieldCompanyName').classList.toggle('hidden', regType !== 'company')
    $('fieldInvite').classList.toggle('hidden',     regType !== 'worker')
    $('regNameLabel').textContent = regType === 'company' ? 'Tu nombre (administrador)' : 'Tu nombre'
    clearError($('registerError'))
  })
})

// Login
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('loginBtn'); const err = $('loginError')
  clearError(err); btn.disabled = true; btn.classList.add('loading')
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('loginEmail').value.trim(), password: $('loginPassword').value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión')
    localStorage.setItem('em_token', data.token)
    localStorage.setItem('em_user',  JSON.stringify(data.user))
    window.location.replace('/')
  } catch (ex) {
    setError(err, ex.message)
    btn.disabled = false; btn.classList.remove('loading')
  }
})

// Register
$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('registerBtn'); const err = $('registerError'); const okMsg = $('registerSuccess')
  clearError(err); okMsg.classList.remove('visible')
  btn.disabled = true; btn.classList.add('loading')
  try {
    let endpoint, payload
    const name     = $('regName').value.trim()
    const email    = $('regEmail').value.trim()
    const password = $('regPassword').value

    if (regType === 'particular') {
      endpoint = '/api/auth/register/particular'
      payload  = { name, email, password }
    } else if (regType === 'company') {
      endpoint = '/api/auth/register/company'
      payload  = {
        companyName:   $('companyName').value.trim(),
        adminEmail:    email,
        adminPassword: password,
        adminName:     name,
      }
    } else {
      endpoint = '/api/auth/register/worker'
      payload  = { name, email, password, inviteCode: $('inviteCode').value.trim() }
    }

    const res  = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'No se pudo crear la cuenta')

    localStorage.setItem('em_token', data.token)
    localStorage.setItem('em_user',  JSON.stringify(data.user))

    if (data.inviteCode) {
      okMsg.innerHTML = `Empresa creada. Tu código de invitación es <code>${data.inviteCode}</code>. Compártelo con tus trabajadores. Redirigiendo…`
      okMsg.classList.add('visible')
      setTimeout(() => window.location.replace('/'), 3500)
    } else {
      window.location.replace('/')
    }
  } catch (ex) {
    setError(err, ex.message)
    btn.disabled = false; btn.classList.remove('loading')
  }
})

// app.js — Socket.io client and real-time UI logic
const socket = io()

// ── DOM refs ─────────────────────────────────────────────
const expenseGrid   = document.getElementById('expense-grid')
const emptyState    = document.getElementById('empty-state')
const statCount     = document.getElementById('stat-count')
const statTotal     = document.getElementById('stat-total')
const statLast      = document.getElementById('stat-last')
const statsRow      = document.querySelector('.stats-row')
const expSection    = document.querySelector('.expenses-section')
const monthLabel    = document.getElementById('month-label')
const monthPrev     = document.getElementById('month-prev')
const monthNext     = document.getElementById('month-next')
const dashDot       = document.getElementById('dash-dot')
const dashStatus    = document.getElementById('dash-status')

// ── State ─────────────────────────────────────────────────────
const allExpenses = []
let selectedMonth = toMonthKey(new Date())
let skeletonEl    = null

// ── Section entry animations ──────────────────────────────────
const sectionObserver = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('visible')),
  { threshold: 0.05 }
)

// ── Card entry animation ──────────────────────────────────────
const cardObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('visible')
        cardObserver.unobserve(e.target)
      }
    })
  },
  { threshold: 0.05 }
)

// ── Helpers ───────────────────────────────────────────────────
function sanitize(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
}

function categoryClass(cat = '') {
  const map = {
    'Alimentación': 'cat-alimentacion',
    'Transporte':   'cat-transporte',
    'Hospedaje':    'cat-hospedaje',
    'Servicios':    'cat-servicios',
    'Tecnología':   'cat-tecnologia',
  }
  return map[cat] ?? ''
}

function formatAmount(expense) {
  if (expense.total == null) return 'N/A'
  const n = Number(expense.total).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${expense.currency ?? ''} ${n}`.trim()
}

function formatDate(expense) {
  if (expense.date) return expense.date
  if (expense.receivedAt) return expense.receivedAt.slice(0, 10)
  return '—'
}

function toMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getExpenseMonth(expense) {
  const dateStr = expense.date || (expense.receivedAt ? expense.receivedAt.slice(0, 10) : null)
  return dateStr ? dateStr.slice(0, 7) : null
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const d = new Date(year, month - 1, 1)
  const name = d.toLocaleString('es-ES', { month: 'long' })
  return `${name.charAt(0).toUpperCase() + name.slice(1)} ${year}`
}

function buildCard(expense, stagger = 0) {
  const card = document.createElement('div')
  card.className = 'expense-card'
  card.dataset.id = expense.id
  card.style.setProperty('--stagger', stagger)

  const catClass = categoryClass(expense.category)

  card.innerHTML = `
    <div class="card-top">
      <span class="card-vendor">${sanitize(expense.vendor ?? 'Desconocido')}</span>
      <span class="amount-badge">${sanitize(formatAmount(expense))}</span>
    </div>
    <div class="card-meta">
      <span class="card-date">${sanitize(formatDate(expense))}</span>
      ${expense.category
        ? `<span class="category-tag ${catClass}">${sanitize(expense.category)}</span>`
        : ''}
    </div>
    ${expense.notes
      ? `<p class="card-notes">${sanitize(expense.notes)}</p>`
      : ''}
  `
  return card
}

// ── Stats update (for selected month) ────────────────────────
function updateStatsForMonth(month) {
  const filtered = allExpenses.filter(e => getExpenseMonth(e) === month)
  const total = filtered.reduce((sum, e) => sum + (e.total != null ? Number(e.total) : 0), 0)
  const last = filtered[0]

  statCount.textContent = filtered.length
  statTotal.textContent = `$${total.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  statLast.textContent = last
    ? new Date(last.receivedAt ?? Date.now()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : '—'
}

// ── Full month render (clears grid and rebuilds) ──────────────
function renderForMonth(month) {
  if (monthLabel) monthLabel.textContent = formatMonthLabel(month)

  const filtered = allExpenses.filter(e => getExpenseMonth(e) === month)

  Array.from(expenseGrid.children).forEach(el => {
    if (!el.classList.contains('skeleton-card')) el.remove()
  })

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden')
  } else {
    emptyState.classList.add('hidden')
    filtered.forEach((expense, i) => {
      const card = buildCard(expense, i)
      card.classList.add('visible')
      expenseGrid.appendChild(card)
      cardObserver.observe(card)
    })
  }

  updateStatsForMonth(month)
}

function setConnected() {
  dashDot.classList.remove('status-dot--amber', 'status-dot--red')
  dashDot.classList.add('status-dot--green')
  dashStatus.textContent = 'Conectado'
}

// ── Skeleton card ─────────────────────────────────────────────
function showSkeleton() {
  if (skeletonEl) skeletonEl.remove()
  skeletonEl = document.createElement('div')
  skeletonEl.className = 'skeleton-card'
  skeletonEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:14px;">
      <div class="skeleton-line" style="width:55%;height:16px;border-radius:4px;"></div>
      <div class="skeleton-line" style="width:28%;height:20px;border-radius:9999px;"></div>
    </div>
    <div class="skeleton-line" style="width:38%;height:12px;border-radius:4px;"></div>
    <div class="skeleton-processing">
      <span>Procesando con Gemini</span>
    </div>
  `
  expenseGrid.prepend(skeletonEl)
  emptyState.classList.add('hidden')
}

function removeSkeleton() {
  if (skeletonEl) {
    skeletonEl.remove()
    skeletonEl = null
  }
}

// ── Month navigation ──────────────────────────────────────────
monthPrev.addEventListener('click', () => {
  const [y, m] = selectedMonth.split('-').map(Number)
  selectedMonth = toMonthKey(new Date(y, m - 2, 1))
  renderForMonth(selectedMonth)
})

monthNext.addEventListener('click', () => {
  const [y, m] = selectedMonth.split('-').map(Number)
  selectedMonth = toMonthKey(new Date(y, m, 1))
  renderForMonth(selectedMonth)
})

// ── Init: page load ───────────────────────────────────────────
// Trigger section animations immediately (no QR screen transition)
requestAnimationFrame(() => {
  sectionObserver.observe(statsRow)
  sectionObserver.observe(expSection)
})
renderForMonth(selectedMonth)

// ── Socket events ─────────────────────────────────────────────

socket.on('init', ({ expenses, connected }) => {
  if (expenses && expenses.length > 0) {
    allExpenses.push(...expenses)
    renderForMonth(selectedMonth)
  }
  if (connected) setConnected()
})

socket.on('bot-ready', setConnected)

socket.on('processing', () => {
  if (selectedMonth === toMonthKey(new Date())) showSkeleton()
})

socket.on('expense-added', (expense) => {
  allExpenses.unshift(expense)
  removeSkeleton()

  const expMonth = getExpenseMonth(expense)
  if (expMonth === selectedMonth) {
    const card = buildCard(expense, 0)
    expenseGrid.prepend(card)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => card.classList.add('visible'))
    })
    cardObserver.observe(card)
    emptyState.classList.add('hidden')
    updateStatsForMonth(selectedMonth)
  }
})

socket.on('processing-error', () => {
  removeSkeleton()
})

socket.on('whatsapp-disconnected', () => {
  dashDot.classList.remove('status-dot--green')
  dashDot.classList.add('status-dot--red')
  dashStatus.textContent = 'Desconectado'
})

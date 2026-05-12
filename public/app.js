// app.js — Verum client

// ── Auth ──────────────────────────────────────────────────────
const token = localStorage.getItem('em_token') ?? ''
if (!token) window.location.replace('/login.html')

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  })
  if (res.status === 401) {
    localStorage.removeItem('em_token')
    localStorage.removeItem('em_user')
    window.location.replace('/login.html')
  }
  return res
}

function logout() {
  apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  localStorage.removeItem('em_token')
  localStorage.removeItem('em_user')
  window.location.replace('/login.html')
}

const socket = io({ auth: { token } })
socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') logout()
})

// ── State ─────────────────────────────────────────────────────
const state = {
  user:             null,
  allExpenses:      [],
  budgets:          [],
  selectedMonth:    toMonthKey(new Date()),
  selectedYear:     String(new Date().getFullYear()),
  selectedCategory: '',
  selectedUser:     '',   // filter by ownerId (admin only)
  searchQuery:      '',
  viewMode:         'grid',   // 'grid' | 'list'
  activeView:       'dashboard',
}

// Verify token & load profile; redirect to login on 401
apiFetch('/api/me').then(async r => {
  if (!r.ok) return
  const { user } = await r.json()
  state.user = user
  try { localStorage.setItem('em_user', JSON.stringify(user)) } catch {}
  applyUserToUI(user)
}).catch(() => {})

function applyUserToUI(user) {
  const headerName = document.getElementById('userName')
  const headerMeta = document.getElementById('userMeta')
  if (headerName) headerName.textContent = user.name
  if (headerMeta) {
    headerMeta.textContent = user.account_type === 'particular'
      ? 'Particular'
      : `${user.company?.name ?? 'Empresa'} · ${user.role === 'admin' ? 'Admin' : 'Trabajador'}`
  }
  const isAdmin = user.account_type === 'company' && user.role === 'admin'
  document.body.classList.toggle('is-admin', isAdmin)
  const adminNav = document.querySelector('.nav-item[data-view="admin"]')
  if (adminNav) adminNav.classList.toggle('hidden', !isAdmin)
}

// ── DOM refs ──────────────────────────────────────────────────
const $ = id => document.getElementById(id)
const $$ = sel => document.querySelectorAll(sel)

const expenseGrid   = $('expenseGrid')
const emptyState    = $('emptyState')
const skeletonCard  = $('skeletonCard')
const monthLabel    = $('monthLabel')
const monthTrigger  = $('monthTrigger')
const monthPicker   = $('monthPicker')
const pickerYear    = $('pickerYear')
const pickerMonths  = $('pickerMonths')
const exportBtn     = $('exportBtn')
const searchInput   = $('searchInput')
const btnGrid       = $('btnGrid')
const btnList       = $('btnList')
const statusDot     = $('statusDot')
const statusText    = $('statusText')
const topbarDot     = $('topbarDot')

// KPI refs
const kpiTotal      = $('kpiTotal')
const kpiSub        = $('kpiSub')
const kpiCount      = $('kpiCount')
const kpiAvg        = $('kpiAvg')
const kpiLast       = $('kpiLast')
const kpiLastVendor = $('kpiLastVendor')

// Annual refs
const annualTotal   = $('annualTotal')
const annualAvg     = $('annualAvg')
const annualPeak    = $('annualPeakMonth')
const annualPeakVal = $('annualPeakVal')
const annualCount   = $('annualCount')
const yearLabel     = $('yearLabel')
const annualEmpty   = $('annualEmpty')

// Sidebar / mobile
const sidebar        = $('sidebar')
const sidebarOverlay = $('sidebarOverlay')
const topbarMenu     = $('topbarMenu')

let barChart   = null
let donutChart = null
let skeletonEl = null

// ── Helpers ───────────────────────────────────────────────────
function sanitize(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function toMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

function getExpenseMonth(e) {
  const s = e.date || (e.receivedAt ? e.receivedAt.slice(0,10) : null)
  return s ? s.slice(0,7) : null
}

function getExpenseYear(e) {
  return (getExpenseMonth(e) || '').slice(0,4)
}

function formatMonthLabel(mk) {
  const [y, m] = mk.split('-').map(Number)
  const name = new Date(y, m-1, 1).toLocaleString('es-ES', { month: 'long' })
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`
}

function formatDate(e) {
  return e.date || (e.receivedAt ? e.receivedAt.slice(0,10) : '—')
}

function formatCurrency(val, currency) {
  const n = Number(val).toLocaleString('es-MX', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
  return currency ? `${currency} ${n}` : `$${n}`
}

function categoryClass(cat='') {
  const map = {
    'Alimentación':'cat-alimentacion','Transporte':'cat-transporte',
    'Hospedaje':'cat-hospedaje','Servicios':'cat-servicios','Tecnología':'cat-tecnologia'
  }
  return map[cat] ?? ''
}

function catKeyToColor(key) {
  const map = {
    'cat-alimentacion':'#34D399','cat-transporte':'#60A5FA',
    'cat-hospedaje':'#F87171','cat-servicios':'#71717A','cat-tecnologia':'#A78BFA'
  }
  return map[key] || '#818CF8'
}

// Count-up animation for a numeric string
function animateValue(el, targetText, duration=450) {
  const num = parseFloat(targetText.replace(/[^0-9.-]/g,''))
  if (isNaN(num)) { el.textContent = targetText; return }
  const prefix = targetText.match(/^[^0-9-]*/)?.[0] ?? ''
  const suffix = targetText.match(/[^0-9.]+$/)?.[0] ?? ''
  const start = Date.now()
  const from = 0
  function tick() {
    const elapsed = Date.now() - start
    const progress = Math.min(elapsed / duration, 1)
    const ease = 1 - Math.pow(1-progress, 3)
    const current = from + (num - from) * ease
    const formatted = current.toLocaleString('es-MX', {
      minimumFractionDigits: suffix.includes(',') || targetText.includes('.') ? 2 : 0,
      maximumFractionDigits: 2
    })
    el.textContent = `${prefix}${formatted}${suffix}`
    if (progress < 1) requestAnimationFrame(tick)
    else el.textContent = targetText
  }
  requestAnimationFrame(tick)
}

// ── Card builder ──────────────────────────────────────────────
function buildCard(expense, stagger=0) {
  const card = document.createElement('div')
  const catCls = categoryClass(expense.category)
  card.className = `expense-card ${catCls}`
  card.dataset.id = expense.id
  card.style.setProperty('--stagger', stagger)
  const amount = expense.total != null
    ? formatCurrency(expense.total, expense.currency)
    : 'N/A'
  const isAdmin   = state.user?.account_type === 'company' && state.user?.role === 'admin'
  const multiUser = isAdmin && [...new Set(state.allExpenses.map(e => e.userId).filter(Boolean))].length > 1
  card.innerHTML = `
    <div class="card-top">
      <span class="card-vendor">${sanitize(expense.vendor ?? 'Desconocido')}</span>
      <span class="amount-badge">${sanitize(amount)}</span>
    </div>
    <div class="card-meta">
      <span class="card-date">${sanitize(formatDate(expense))}</span>
      ${expense.category
        ? `<span class="category-tag ${catCls}">${sanitize(expense.category)}</span>`
        : ''}
      ${multiUser && expense.ownerName
        ? `<span class="card-user-badge" title="${sanitize(expense.ownerName)}">${sanitize(expense.ownerName[0].toUpperCase())}</span>`
        : ''}
    </div>
    ${expense.notes ? `<p class="card-notes">${sanitize(expense.notes)}</p>` : ''}
  `
  card.addEventListener('click', () => openExpenseModal(expense))
  return card
}

// ── Expense Detail Modal ──────────────────────────────────────
function mimeToExt(mime) {
  const map = { 'image/png':'png', 'image/gif':'gif', 'image/webp':'webp' }
  return map[mime] ?? 'jpg'
}

function openExpenseModal(expense) {
  const modal     = $('expenseModal')
  const imgEl     = $('modalReceiptImg')
  const noImg     = $('modalNoImage')
  const catCls    = categoryClass(expense.category)
  const amount    = expense.total != null
    ? formatCurrency(expense.total, expense.currency) : 'N/A'

  // Vendor + badges
  $('modalVendor').textContent = expense.vendor ?? 'Desconocido'
  $('modalAmount').textContent = amount

  const catBadge = $('modalCatBadge')
  if (expense.category) {
    catBadge.textContent = expense.category
    catBadge.className = `modal-cat-badge category-tag ${catCls}`
    catBadge.classList.remove('hidden')
  } else {
    catBadge.classList.add('hidden')
  }

  // Date & metadata
  $('modalDate').textContent = expense.date ?? '—'
  if (expense.receivedAt) {
    $('modalReceived').textContent = new Date(expense.receivedAt)
      .toLocaleString('es-ES', { dateStyle:'medium', timeStyle:'short' })
    $('modalReceivedRow').classList.remove('hidden')
  } else {
    $('modalReceivedRow').classList.add('hidden')
  }
  if (expense.from) {
    $('modalFrom').textContent = expense.from
    $('modalFromRow').classList.remove('hidden')
  } else {
    $('modalFromRow').classList.add('hidden')
  }

  // Amounts
  if (expense.subtotal != null) {
    $('modalSubtotal').textContent = formatCurrency(expense.subtotal, expense.currency)
    $('modalSubtotalRow').classList.remove('hidden')
  } else {
    $('modalSubtotalRow').classList.add('hidden')
  }
  if (expense.tax != null) {
    $('modalTax').textContent = formatCurrency(expense.tax, expense.currency)
    $('modalTaxRow').classList.remove('hidden')
  } else {
    $('modalTaxRow').classList.add('hidden')
  }
  $('modalTotal').textContent = amount

  // Items list
  const itemsSec = $('modalItemsSection')
  const itemsEl  = $('modalItems')
  if (expense.items && expense.items.length > 0) {
    itemsEl.innerHTML = expense.items.map(it => `
      <li class="modal-item">
        <span class="modal-item-desc">${sanitize(it.description ?? '')}</span>
        <span class="modal-item-amount">${it.amount != null ? formatCurrency(it.amount, expense.currency) : ''}</span>
      </li>
    `).join('')
    itemsSec.classList.remove('hidden')
  } else {
    itemsSec.classList.add('hidden')
  }

  // Notes
  const notesSec = $('modalNotesSection')
  if (expense.notes) {
    $('modalNotes').textContent = expense.notes
    notesSec.classList.remove('hidden')
  } else {
    notesSec.classList.add('hidden')
  }

  // Receipt image
  if (expense.imageMime) {
    const ext = mimeToExt(expense.imageMime)
    imgEl.src = `/uploads/${expense.id}.${ext}`
    imgEl.classList.remove('hidden')
    noImg.classList.add('hidden')
    imgEl.onerror = () => {
      imgEl.classList.add('hidden')
      noImg.classList.remove('hidden')
    }
  } else {
    imgEl.classList.add('hidden')
    noImg.classList.remove('hidden')
  }

  // Store current expense id for delete action
  modal.dataset.currentId = expense.id

  // Show modal
  modal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function closeExpenseModal() {
  $('expenseModal').classList.add('hidden')
  document.body.style.overflow = ''
  $('modalReceiptImg').src = ''
}

// Modal close handlers
$('modalClose').addEventListener('click', closeExpenseModal)
$('expenseModal').addEventListener('click', (e) => {
  if (e.target === $('expenseModal')) closeExpenseModal()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeExpenseModal()
    closePicker()
  }
})

// ── Filtered expense list ─────────────────────────────────────
function filterExpenses(month, cat, query, userId = '') {
  return state.allExpenses.filter(e => {
    if (getExpenseMonth(e) !== month) return false
    if (cat    && categoryClass(e.category) !== cat) return false
    if (userId && e.userId !== userId) return false
    if (query) {
      const vendor = (e.vendor ?? '').toLowerCase()
      if (!vendor.includes(query.toLowerCase())) return false
    }
    return true
  })
}

function buildUserFilters() {
  const section = $('userFilterSection')
  if (!section) return
  const isAdmin = state.user?.account_type === 'company' && state.user?.role === 'admin'
  if (!isAdmin) { section.classList.add('hidden'); return }

  const owners = new Map()
  for (const e of state.allExpenses) {
    if (e.userId && !owners.has(e.userId)) owners.set(e.userId, e.ownerName || '—')
  }
  if (owners.size <= 1) { section.classList.add('hidden'); return }

  section.classList.remove('hidden')
  const container = $('userFilters')
  container.innerHTML = ''

  const allBtn = document.createElement('button')
  allBtn.className  = `cat-filter-btn${state.selectedUser === '' ? ' active' : ''}`
  allBtn.dataset.user = ''
  allBtn.innerHTML = `<span class="cat-dot" style="background:var(--text-3)"></span><span>Todos</span>`
  container.appendChild(allBtn)

  for (const [uid, name] of owners) {
    const btn = document.createElement('button')
    btn.className  = `cat-filter-btn${state.selectedUser === uid ? ' active' : ''}`
    btn.dataset.user = uid
    btn.innerHTML = `<span class="cat-dot user-dot">${sanitize(name[0]?.toUpperCase() ?? '?')}</span><span>${sanitize(name)}</span>`
    container.appendChild(btn)
  }

  container.querySelectorAll('.cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      state.selectedUser = btn.dataset.user
      renderForMonth(state.selectedMonth)
    })
  })
}

// ── Dashboard: KPI update ─────────────────────────────────────
function updateKPIs(filtered) {
  const total = filtered.reduce((s,e) => s + (e.total != null ? Number(e.total) : 0), 0)
  const count = filtered.length
  const last = filtered[0]
  const avg = count > 0 ? total / count : 0

  const totalStr = formatCurrency(total, filtered[0]?.currency)
  animateValue(kpiTotal, totalStr)
  kpiSub.textContent = count > 0
    ? `promedio ${formatCurrency(avg, filtered[0]?.currency)} por factura`
    : ''

  animateValue(kpiCount, String(count))
  kpiAvg.textContent = count > 0
    ? `${count === 1 ? '1 factura' : `${count} facturas`} este mes`
    : 'sin facturas'

  if (last) {
    const d = new Date(last.receivedAt ?? Date.now())
    kpiLast.textContent = d.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })
    kpiLastVendor.textContent = last.vendor ?? ''
  } else {
    kpiLast.textContent = '—'
    kpiLastVendor.textContent = ''
  }
}

// ── Dashboard: Full render ────────────────────────────────────
function renderForMonth(month) {
  monthLabel.textContent = formatMonthLabel(month)
  const filtered = filterExpenses(month, state.selectedCategory, state.searchQuery, state.selectedUser)

  // Remove non-skeleton cards
  Array.from(expenseGrid.children).forEach(el => {
    if (el !== skeletonCard && !el.classList.contains('skeleton-card')) el.remove()
  })

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden')
    const noResults = state.searchQuery || state.selectedCategory
    $('emptyTitle').textContent = noResults ? 'Sin resultados' : 'Sin facturas este mes'
    $('emptySub').textContent   = noResults
      ? 'Prueba con otra búsqueda o categoría'
      : 'Envía una foto de factura por Telegram para empezar'
  } else {
    emptyState.classList.add('hidden')
    filtered.forEach((expense, i) => {
      const card = buildCard(expense, i)
      expenseGrid.appendChild(card)
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('visible')))
    })
  }

  updateKPIs(filtered)
}

// ── Annual View ───────────────────────────────────────────────
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function renderAnnualView(year) {
  yearLabel.textContent = year
  $('annualEmptyYear').textContent = year
  const years = yearsWithData()
  $('prevYear').disabled = !years.some(y => y < year)
  $('nextYear').disabled = !years.some(y => y > year)

  const yearExpenses = state.allExpenses.filter(e => getExpenseYear(e) === year)

  if (yearExpenses.length === 0) {
    annualEmpty.classList.remove('hidden')
    annualTotal.textContent = '—'
    annualAvg.textContent   = '—'
    annualPeak.textContent  = '—'
    annualCount.textContent = '—'
    annualPeakVal.textContent = ''
    if (barChart) { barChart.destroy(); barChart = null }
    if (donutChart) { donutChart.destroy(); donutChart = null }
    return
  }

  annualEmpty.classList.add('hidden')

  // Monthly totals
  const monthTotals = Array(12).fill(0)
  yearExpenses.forEach(e => {
    const m = getExpenseMonth(e)
    if (m) {
      const idx = parseInt(m.slice(5,7), 10) - 1
      monthTotals[idx] += e.total != null ? Number(e.total) : 0
    }
  })

  // Category totals
  const catTotals = {}
  yearExpenses.forEach(e => {
    const c = e.category || 'Otro'
    catTotals[c] = (catTotals[c] || 0) + (e.total != null ? Number(e.total) : 0)
  })

  const total = yearExpenses.reduce((s,e) => s + (e.total != null ? Number(e.total) : 0), 0)
  const monthsWithData = monthTotals.filter(v => v > 0).length
  const avg = monthsWithData > 0 ? total / monthsWithData : 0
  const peakIdx = monthTotals.indexOf(Math.max(...monthTotals))
  const currency = yearExpenses[0]?.currency

  animateValue(annualTotal, formatCurrency(total, currency))
  animateValue(annualAvg, formatCurrency(avg, currency))
  annualPeak.textContent = MONTHS_ES[peakIdx]
  annualPeakVal.textContent = formatCurrency(monthTotals[peakIdx], currency)
  animateValue(annualCount, String(yearExpenses.length))

  buildCharts(monthTotals, catTotals, currency)
}

function buildCharts(monthTotals, catTotals, currency) {
  const gridColor = 'rgba(255,255,255,0.05)'
  const tickColor = '#52525B'
  const font = { family: "'Geist Mono', monospace", size: 11 }

  // ── Bar Chart ──────────────────────────────────────────────
  const barCtx = $('barChart').getContext('2d')
  if (barChart) barChart.destroy()

  const barGrad = barCtx.createLinearGradient(0, 0, 0, 220)
  barGrad.addColorStop(0, 'rgba(129,140,248,0.9)')
  barGrad.addColorStop(1, 'rgba(129,140,248,0.3)')

  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: MONTHS_ES,
      datasets: [{
        data: monthTotals,
        backgroundColor: barGrad,
        borderRadius: 4,
        borderSkipped: false,
        hoverBackgroundColor: 'rgba(129,140,248,1)',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1C1C1F',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#A1A1AA',
          bodyColor: '#F4F4F5',
          padding: 10,
          callbacks: {
            label: ctx => ` ${formatCurrency(ctx.raw, currency)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: gridColor },
          ticks: { color: tickColor, font }
        },
        y: {
          grid: { color: gridColor },
          border: { color: 'transparent' },
          ticks: {
            color: tickColor, font,
            callback: v => v === 0 ? '0' : formatCurrency(v, currency)
          }
        }
      }
    }
  })

  // ── Donut Chart ────────────────────────────────────────────
  const donutCtx = $('donutChart').getContext('2d')
  if (donutChart) donutChart.destroy()

  const catEntries = Object.entries(catTotals).sort((a,b) => b[1]-a[1])
  const catLabels  = catEntries.map(([k]) => k)
  const catValues  = catEntries.map(([,v]) => v)
  const catColors  = catLabels.map(l => catKeyToColor(categoryClass(l)))

  donutChart = new Chart(donutCtx, {
    type: 'doughnut',
    data: {
      labels: catLabels,
      datasets: [{
        data: catValues,
        backgroundColor: catColors,
        borderColor: '#141416',
        borderWidth: 2,
        hoverBorderColor: '#1C1C1F',
        hoverOffset: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1C1C1F',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#A1A1AA',
          bodyColor: '#F4F4F5',
          padding: 10,
          callbacks: {
            label: ctx => ` ${formatCurrency(ctx.raw, currency)}`
          }
        }
      }
    }
  })

  // Legend
  const legend = $('donutLegend')
  const totalSum = catValues.reduce((s,v) => s+v, 0)
  legend.innerHTML = catEntries.map(([label, val], i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${catColors[i]}"></span>
      <span class="legend-label">${sanitize(label)}</span>
      <span class="legend-val">${Math.round(val/totalSum*100)}%</span>
    </div>
  `).join('')
}

// ── View switcher ─────────────────────────────────────────────
function switchView(viewId) {
  state.activeView = viewId
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'))
  document.querySelector(`#view-${viewId}`).classList.remove('hidden')
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId)
  })
  if (viewId === 'annual')  renderAnnualView(state.selectedYear)
  if (viewId === 'budgets') renderBudgets()
}

// ── Status helpers ────────────────────────────────────────────
function setConnectionState(state_) {
  statusDot.className = `status-dot ${state_}`
  topbarDot.className = `status-dot ${state_}`
  const labels = { connected:'Conectado', disconnected:'Desconectado', '':'Conectando…' }
  statusText.textContent = labels[state_] ?? 'Conectando…'
}

// ── Skeleton ──────────────────────────────────────────────────
function showSkeleton() {
  if (skeletonEl) skeletonEl.remove()
  skeletonEl = document.createElement('div')
  skeletonEl.className = 'skeleton-card'
  skeletonEl.innerHTML = `
    <div class="skel skel-h"></div>
    <div class="skel skel-m"></div>
    <div class="skel skel-b"></div>
  `
  expenseGrid.prepend(skeletonEl)
  emptyState.classList.add('hidden')
}

function removeSkeleton() {
  if (skeletonEl) { skeletonEl.remove(); skeletonEl = null }
  if (skeletonCard) skeletonCard.remove()
}

// ── Month Picker ──────────────────────────────────────────────
let pickerNavYear = new Date().getFullYear()

function monthsWithData() {
  const set = new Set()
  state.allExpenses.forEach(e => { const m = getExpenseMonth(e); if (m) set.add(m) })
  return set
}

function yearsWithData() {
  const set = new Set()
  state.allExpenses.forEach(e => { const y = getExpenseYear(e); if (y) set.add(y) })
  return [...set].sort()
}

function buildPickerMonths() {
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  pickerYear.textContent = pickerNavYear
  const withData = monthsWithData()
  const years = yearsWithData()
  const cur = String(pickerNavYear)
  $('pickerPrevYear').disabled = !years.some(y => y < cur)
  $('pickerNextYear').disabled = !years.some(y => y > cur)
  pickerMonths.innerHTML = ''
  MONTHS.forEach((name, idx) => {
    const key = `${pickerNavYear}-${String(idx+1).padStart(2,'0')}`
    const btn = document.createElement('button')
    btn.className = 'picker-month-btn'
    btn.textContent = name
    if (key === state.selectedMonth) btn.classList.add('active')
    if (withData.has(key)) btn.classList.add('has-data')
    btn.addEventListener('click', () => {
      state.selectedMonth = key
      closePicker()
      renderForMonth(state.selectedMonth)
    })
    pickerMonths.appendChild(btn)
  })
}

function openPicker() {
  const [y] = state.selectedMonth.split('-').map(Number)
  pickerNavYear = y
  buildPickerMonths()
  monthPicker.classList.remove('hidden')
  monthTrigger.classList.add('open')
  monthTrigger.setAttribute('aria-expanded', 'true')
}

function closePicker() {
  monthPicker.classList.add('hidden')
  monthTrigger.classList.remove('open')
  monthTrigger.setAttribute('aria-expanded', 'false')
}

function togglePicker() {
  monthPicker.classList.contains('hidden') ? openPicker() : closePicker()
}

// ── Event listeners ───────────────────────────────────────────

// Navigation
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view)
    sidebar.classList.remove('open')
    sidebarOverlay.classList.add('hidden')
  })
})

// Category filters
$$('.cat-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.cat-filter-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    state.selectedCategory = btn.dataset.cat
    renderForMonth(state.selectedMonth)
  })
})

// Month picker toggle
monthTrigger.addEventListener('click', (e) => { e.stopPropagation(); togglePicker() })

// Picker year navigation — jump to nearest year that has expenses
$('pickerPrevYear').addEventListener('click', () => {
  const prev = yearsWithData().filter(y => y < String(pickerNavYear)).at(-1)
  if (prev) { pickerNavYear = parseInt(prev); buildPickerMonths() }
})
$('pickerNextYear').addEventListener('click', () => {
  const next = yearsWithData().find(y => y > String(pickerNavYear))
  if (next) { pickerNavYear = parseInt(next); buildPickerMonths() }
})

// Close picker when clicking outside
document.addEventListener('click', (e) => {
  if (!$('monthPickerWrap').contains(e.target)) closePicker()
})

// Year navigation — jump to nearest year that has expenses
$('prevYear').addEventListener('click', () => {
  const prev = yearsWithData().filter(y => y < state.selectedYear).at(-1)
  if (prev) { state.selectedYear = prev; renderAnnualView(state.selectedYear) }
})
$('nextYear').addEventListener('click', () => {
  const next = yearsWithData().find(y => y > state.selectedYear)
  if (next) { state.selectedYear = next; renderAnnualView(state.selectedYear) }
})

// Search
searchInput.addEventListener('input', () => {
  state.searchQuery = searchInput.value.trim()
  renderForMonth(state.selectedMonth)
})

// View toggle (grid/list)
btnGrid.addEventListener('click', () => {
  state.viewMode = 'grid'
  btnGrid.classList.add('active')
  btnList.classList.remove('active')
  expenseGrid.classList.remove('list-mode')
})
btnList.addEventListener('click', () => {
  state.viewMode = 'list'
  btnList.classList.add('active')
  btnGrid.classList.remove('active')
  expenseGrid.classList.add('list-mode')
})

// Export CSV
exportBtn.addEventListener('click', () => {
  window.location.href = `/api/export?month=${state.selectedMonth}&token=${encodeURIComponent(token)}`
})

// Mobile sidebar toggle
topbarMenu.addEventListener('click', () => {
  sidebar.classList.toggle('open')
  sidebarOverlay.classList.toggle('hidden')
})
sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.remove('open')
  sidebarOverlay.classList.add('hidden')
})

// ── Socket events ─────────────────────────────────────────────
socket.on('init', ({ expenses, budgets, connected }) => {
  removeSkeleton()
  state.allExpenses = Array.isArray(expenses) ? [...expenses] : []
  state.budgets     = budgets ?? []
  buildUserFilters()
  renderForMonth(state.selectedMonth)
  if (connected) setConnectionState('connected')
})

socket.on('bot-ready', () => setConnectionState('connected'))

socket.on('processing', () => {
  if (state.selectedMonth === toMonthKey(new Date()) && state.activeView === 'dashboard') {
    showSkeleton()
  }
})

socket.on('expense-added', (expense) => {
  state.allExpenses.unshift(expense)
  removeSkeleton()
  const expMonth = getExpenseMonth(expense)
  if (expMonth === state.selectedMonth && state.activeView === 'dashboard') {
    const filtered = filterExpenses(state.selectedMonth, state.selectedCategory, state.searchQuery, state.selectedUser)
    const inFilter = filtered.some(e => e.id === expense.id)
    if (inFilter) {
      const card = buildCard(expense, 0)
      expenseGrid.prepend(card)
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('visible')))
      emptyState.classList.add('hidden')
    }
    updateKPIs(filterExpenses(state.selectedMonth, state.selectedCategory, state.searchQuery, state.selectedUser))
  }
  if (state.activeView === 'budgets') renderBudgets()
})

socket.on('processing-error', () => removeSkeleton())

socket.on('whatsapp-disconnected', () => setConnectionState('disconnected'))

socket.on('expense-deleted', ({ id }) => {
  state.allExpenses = state.allExpenses.filter(e => e.id !== id)
  const card = expenseGrid.querySelector(`[data-id="${id}"]`)
  if (card) card.remove()
  renderForMonth(state.selectedMonth)
  if (state.activeView === 'budgets') renderBudgets()
})

socket.on('expense-updated', (updated) => {
  const idx = state.allExpenses.findIndex(e => e.id === updated.id)
  if (idx !== -1) state.allExpenses[idx] = updated
  renderForMonth(state.selectedMonth)
  if (state.activeView === 'budgets') renderBudgets()
})

socket.on('budget-updated', (budget) => {
  const idx = state.budgets.findIndex(b => b.id === budget.id)
  if (idx !== -1) state.budgets[idx] = budget
  else state.budgets.push(budget)
  if (state.activeView === 'budgets') renderBudgets()
})

socket.on('budget-deleted', ({ id }) => {
  state.budgets = state.budgets.filter(b => b.id !== id)
  if (state.activeView === 'budgets') renderBudgets()
})

// ── PDF Print ─────────────────────────────────────────────────
$('printBtn').addEventListener('click', () => {
  $('printMeta').textContent =
    `${formatMonthLabel(state.selectedMonth)} · Generado el ${new Date().toLocaleDateString('es-MX')}`
  window.print()
})

// ── AI Chat Assistant ─────────────────────────────────────────
let chatHistory  = []
let chatStreaming = false

// Check if assistant is enabled on load
apiFetch('/api/assistant/status').then(r => r.json()).then(({ enabled }) => {
  if (enabled) $('chatFab').classList.remove('hidden')
}).catch(() => {})

function openChat() {
  $('chatPanel').classList.remove('hidden')
  $('chatFab').classList.add('chat-fab-open')
  setTimeout(() => $('chatInput').focus(), 100)
}

function closeChat() {
  $('chatPanel').classList.add('hidden')
  $('chatFab').classList.remove('chat-fab-open')
}

$('chatFab').addEventListener('click', () => {
  $('chatPanel').classList.contains('hidden') ? openChat() : closeChat()
})
$('chatClose').addEventListener('click', closeChat)

function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

function appendUserMessage(text) {
  const msgs = $('chatMessages')
  const div  = document.createElement('div')
  div.className = 'chat-msg chat-msg-user'
  div.innerHTML  = `<div class="chat-bubble">${sanitize(text)}</div>`
  msgs.appendChild(div)
  msgs.scrollTop = msgs.scrollHeight
}

function appendAssistantMessage() {
  const msgs = $('chatMessages')
  const div  = document.createElement('div')
  div.className = 'chat-msg chat-msg-assistant'
  div.innerHTML  = `<div class="chat-bubble chat-bubble-streaming"><span class="chat-dots"><span></span><span></span><span></span></span></div>`
  msgs.appendChild(div)
  msgs.scrollTop = msgs.scrollHeight
  return div.querySelector('.chat-bubble')
}

function setChatLoading(loading) {
  chatStreaming = loading
  const btn   = $('chatSend')
  const input = $('chatInput')
  btn.disabled   = loading
  input.disabled = loading
  $('chatSubtitle').textContent = loading ? 'Escribiendo…' : 'Pregunta sobre tus gastos'
}

async function sendChatMessage() {
  const input   = $('chatInput')
  const message = input.value.trim()
  if (!message || chatStreaming) return

  input.value = ''
  appendUserMessage(message)
  setChatLoading(true)

  const bubble = appendAssistantMessage()
  let fullText = ''

  try {
    const res = await apiFetch('/api/assistant', {
      method: 'POST',
      body: JSON.stringify({ message, history: chatHistory }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      bubble.innerHTML = `<em>${sanitize(data.error ?? 'Error al conectar con el asistente.')}</em>`
      setChatLoading(false)
      return
    }

    // Stream SSE response
    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let   buffer  = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') break
        try {
          const parsed = JSON.parse(payload)
          if (parsed.error) {
            bubble.innerHTML = `<em>${sanitize(parsed.error)}</em>`
          } else if (parsed.text) {
            fullText += parsed.text
            bubble.innerHTML = renderMarkdown(fullText)
            $('chatMessages').scrollTop = $('chatMessages').scrollHeight
          }
        } catch {}
      }
    }

    if (fullText) {
      chatHistory.push({ role: 'user', content: message })
      chatHistory.push({ role: 'assistant', content: fullText })
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20)
    }
  } catch (err) {
    bubble.innerHTML = `<em>Error de conexión: ${sanitize(err.message)}</em>`
  } finally {
    setChatLoading(false)
    $('chatMessages').scrollTop = $('chatMessages').scrollHeight
  }
}

$('chatSend').addEventListener('click', sendChatMessage)
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage() }
})

// ── Delete expense ────────────────────────────────────────────
let pendingDeleteId = null

$('modalDeleteBtn').addEventListener('click', () => {
  pendingDeleteId = $('expenseModal').dataset.currentId
  closeExpenseModal()
  $('confirmModal').classList.remove('hidden')
  document.body.style.overflow = 'hidden'
})

$('confirmCancel').addEventListener('click', () => {
  $('confirmModal').classList.add('hidden')
  document.body.style.overflow = ''
  pendingDeleteId = null
})

$('confirmModal').addEventListener('click', (e) => {
  if (e.target === $('confirmModal')) {
    $('confirmModal').classList.add('hidden')
    document.body.style.overflow = ''
    pendingDeleteId = null
  }
})

$('confirmOk').addEventListener('click', async () => {
  if (!pendingDeleteId) return
  const id = pendingDeleteId
  pendingDeleteId = null
  $('confirmModal').classList.add('hidden')
  document.body.style.overflow = ''
  await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' })
})

// ── Edit expense ──────────────────────────────────────────────
$('modalEditBtn').addEventListener('click', () => {
  const id = $('expenseModal').dataset.currentId
  const expense = state.allExpenses.find(e => e.id === id)
  if (!expense) return
  closeExpenseModal()
  openManualModal(expense)
})

// ── Manual expense entry ───────────────────────────────────────
let editingExpenseId = null

function openManualModal(expense = null) {
  editingExpenseId = expense?.id ?? null
  $('manualForm').reset()
  $('formError').classList.add('hidden')

  if (expense) {
    $('manualTitle').textContent = 'Editar gasto'
    $('manualSubmitBtn').querySelector('span').textContent = 'Guardar cambios'
    $('fVendor').value   = expense.vendor ?? ''
    $('fDate').value     = expense.date ?? new Date().toISOString().slice(0, 10)
    $('fTotal').value    = expense.total ?? ''
    $('fCurrency').value = expense.currency ?? 'EUR'
    $('fSubtotal').value = expense.subtotal ?? ''
    $('fTax').value      = expense.tax ?? ''
    $('fCategory').value = expense.category ?? 'Otro'
    $('fNotes').value    = expense.notes ?? ''
  } else {
    $('manualTitle').textContent = 'Nuevo gasto'
    $('manualSubmitBtn').querySelector('span').textContent = 'Guardar gasto'
    $('fDate').value = new Date().toISOString().slice(0, 10)
  }

  $('manualModal').classList.remove('hidden')
  document.body.style.overflow = 'hidden'
  setTimeout(() => $('fVendor').focus(), 50)
}

function closeManualModal() {
  $('manualModal').classList.add('hidden')
  document.body.style.overflow = ''
  editingExpenseId = null
}

$('addExpenseBtn').addEventListener('click', () => openManualModal())
$('manualClose').addEventListener('click', closeManualModal)
$('manualCancelBtn').addEventListener('click', closeManualModal)
$('manualModal').addEventListener('click', (e) => {
  if (e.target === $('manualModal')) closeManualModal()
})

$('manualForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('manualSubmitBtn')
  const errEl = $('formError')
  btn.disabled = true
  btn.classList.add('loading')
  errEl.classList.add('hidden')

  const body = {
    vendor:   $('fVendor').value.trim() || 'Sin proveedor',
    date:     $('fDate').value || null,
    total:    parseFloat($('fTotal').value),
    currency: $('fCurrency').value,
    subtotal: $('fSubtotal').value ? parseFloat($('fSubtotal').value) : null,
    tax:      $('fTax').value ? parseFloat($('fTax').value) : null,
    category: $('fCategory').value,
    notes:    $('fNotes').value.trim() || null,
  }

  try {
    const isEdit = !!editingExpenseId
    const res = await apiFetch(
      isEdit ? `/api/expenses/${editingExpenseId}` : '/api/expenses',
      { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify(body) }
    )
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error ?? 'Error al guardar')
    }
    const saved = await res.json()
    btn.disabled = false
    btn.classList.remove('loading')
    closeManualModal()
    if (!isEdit && saved._anomaly) {
      setTimeout(() => alert(saved._anomaly.message.replace(/\*/g, '')), 300)
    }
  } catch (err) {
    errEl.textContent = err.message
    errEl.classList.remove('hidden')
    btn.disabled = false
    btn.classList.remove('loading')
  }
})

// ── Budgets view ──────────────────────────────────────────────
const CAT_COLORS = {
  'Alimentación': '#34D399', 'Transporte': '#60A5FA',
  'Hospedaje': '#F87171', 'Servicios': '#71717A',
  'Tecnología': '#A78BFA', 'Otro': '#818CF8',
}
const DEFAULT_COLOR = '#818CF8'

function catColor(cat) { return CAT_COLORS[cat] ?? DEFAULT_COLOR }

function renderBudgets() {
  const grid    = $('budgetsGrid')
  const empty   = $('budgetsEmpty')
  const month   = toMonthKey(new Date())

  const monthExpenses = state.allExpenses.filter(
    e => (e.date ?? e.receivedAt?.slice(0, 10))?.slice(0, 7) === month
  )

  grid.innerHTML = ''

  if (!state.budgets.length) {
    empty.classList.remove('hidden')
    grid.classList.add('hidden')
    return
  }

  empty.classList.add('hidden')
  grid.classList.remove('hidden')

  state.budgets.forEach(b => {
    const relevant = b.category
      ? monthExpenses.filter(e => e.category === b.category)
      : monthExpenses
    const spent = relevant.reduce((s, e) => s + (Number(e.total) || 0), 0)
    const pct   = Math.min(spent / b.amount, 1)
    const over  = spent > b.amount
    const warn  = !over && pct >= 0.8
    const color = over ? '#F87171' : warn ? '#FBBF24' : catColor(b.category ?? '')

    const card = document.createElement('div')
    card.className = 'budget-card'
    card.innerHTML = `
      <div class="budget-card-header">
        <div class="budget-cat-info">
          <span class="budget-dot" style="background:${color}"></span>
          <span class="budget-label">${sanitize(b.category ?? 'Global')}</span>
          ${over ? '<span class="budget-badge budget-badge-red">Excedido</span>'
                 : warn ? '<span class="budget-badge budget-badge-amber">Alerta</span>' : ''}
        </div>
        <button class="budget-del-btn" data-id="${b.id}" aria-label="Eliminar presupuesto">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5h9M4.5 3.5V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M10.5 3.5l-.5 7a1 1 0 01-1 .9H4a1 1 0 01-1-.9l-.5-7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="budget-amounts">
        <span class="budget-spent" style="color:${color}">${b.currency} ${spent.toFixed(2)}</span>
        <span class="budget-limit">/ ${b.amount.toFixed(2)}</span>
      </div>
      <div class="budget-track">
        <div class="budget-fill" style="width:${(pct*100).toFixed(1)}%; background:${color}"></div>
      </div>
      <div class="budget-footer">
        <span class="budget-pct" style="color:${color}">${Math.round(pct*100)}% usado</span>
        <span class="budget-remaining" style="color:${over ? '#F87171' : 'var(--text-3)'}">
          ${over
            ? `+${b.currency} ${(spent - b.amount).toFixed(2)} sobre el límite`
            : `${b.currency} ${(b.amount - spent).toFixed(2)} disponible`}
        </span>
      </div>
    `
    grid.appendChild(card)
  })

  // Delete handlers
  grid.querySelectorAll('.budget-del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      await apiFetch(`/api/budgets/${id}`, { method: 'DELETE' })
    })
  })
}


// ── Budget modal ──────────────────────────────────────────────
function openBudgetModal() {
  $('budgetForm').reset()
  $('budgetFormError').classList.add('hidden')
  $('budgetModal').classList.remove('hidden')
  document.body.style.overflow = 'hidden'
  setTimeout(() => $('bAmount').focus(), 50)
}

function closeBudgetModal() {
  $('budgetModal').classList.add('hidden')
  document.body.style.overflow = ''
}

$('addBudgetBtn').addEventListener('click', openBudgetModal)
$('budgetModalClose').addEventListener('click', closeBudgetModal)
$('budgetCancelBtn').addEventListener('click', closeBudgetModal)
$('budgetModal').addEventListener('click', (e) => {
  if (e.target === $('budgetModal')) closeBudgetModal()
})

$('budgetForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('budgetSubmitBtn')
  const errEl = $('budgetFormError')
  btn.disabled = true
  btn.classList.add('loading')
  errEl.classList.add('hidden')

  const body = {
    category: $('bCategory').value || null,
    amount:   parseFloat($('bAmount').value),
    currency: $('bCurrency').value,
  }

  try {
    const res = await apiFetch('/api/budgets', { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error ?? 'Error al guardar')
    }
    closeBudgetModal()
  } catch (err) {
    errEl.textContent = err.message
    errEl.classList.remove('hidden')
    btn.disabled = false
    btn.classList.remove('loading')
  }
})

// ── PWA: Service Worker + Install prompt ──────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

let deferredInstallPrompt = null

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstallPrompt = e
  $('installBanner').classList.remove('hidden')
})

$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return
  deferredInstallPrompt.prompt()
  const { outcome } = await deferredInstallPrompt.userChoice
  if (outcome === 'accepted') $('installBanner').classList.add('hidden')
  deferredInstallPrompt = null
})

$('installDismiss').addEventListener('click', () => {
  $('installBanner').classList.add('hidden')
})

window.addEventListener('appinstalled', () => {
  $('installBanner').classList.add('hidden')
  deferredInstallPrompt = null
})

// ── Logout ────────────────────────────────────────────────────
document.getElementById('logoutBtn')?.addEventListener('click', logout)

// ── Telegram linking ──────────────────────────────────────────
const tgModal     = document.getElementById('tgLinkModal')
const tgCodeEl    = document.getElementById('tgLinkCode')
const tgExpiresEl = document.getElementById('tgLinkExpires')

function openTelegramLinkModal() {
  if (!tgModal) return
  tgCodeEl.textContent    = '...'
  tgExpiresEl.textContent = ''
  tgModal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
  apiFetch('/api/telegram/link-code', { method: 'POST' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('Error al generar código')))
    .then(({ code, expiresAt }) => {
      tgCodeEl.textContent    = code
      const mins = Math.max(1, Math.round((expiresAt - Date.now()) / 60000))
      tgExpiresEl.textContent = `Caduca en ${mins} min · Envía "/link ${code}" al bot`
    })
    .catch(err => { tgCodeEl.textContent = '—'; tgExpiresEl.textContent = err.message })
}

function closeTelegramLinkModal() {
  if (!tgModal) return
  tgModal.classList.add('hidden')
  document.body.style.overflow = ''
}

document.getElementById('linkTelegramBtn')?.addEventListener('click', openTelegramLinkModal)
document.getElementById('tgLinkClose')?.addEventListener('click', closeTelegramLinkModal)
tgModal?.addEventListener('click', (e) => { if (e.target === tgModal) closeTelegramLinkModal() })

document.getElementById('tgLinkCopyBtn')?.addEventListener('click', () => {
  const code = tgCodeEl.textContent
  if (!code || code === '...' || code === '—') return
  navigator.clipboard.writeText(code).catch(() => {})
  const btn = document.getElementById('tgLinkCopyBtn')
  const original = btn.textContent
  btn.textContent = '¡Copiado!'
  setTimeout(() => { btn.textContent = original }, 1500)
})

// ── Admin: invite code + workers list ─────────────────────────
async function renderAdminView() {
  const codeEl    = document.getElementById('adminInviteCode')
  const workersEl = document.getElementById('adminWorkers')
  if (!codeEl || !workersEl) return

  codeEl.textContent = '...'
  workersEl.innerHTML = '<p style="color:var(--text-3); font-size:13px">Cargando…</p>'

  try {
    const [invRes, usersRes] = await Promise.all([
      apiFetch('/api/admin/invite-code'),
      apiFetch('/api/admin/users'),
    ])
    if (!invRes.ok || !usersRes.ok) throw new Error('Error al cargar datos administrativos')
    const { inviteCode } = await invRes.json()
    const users          = await usersRes.json()

    codeEl.textContent = inviteCode ?? '—'
    if (!users.length) {
      workersEl.innerHTML = '<p style="color:var(--text-3); font-size:13px">Aún no hay trabajadores en tu empresa.</p>'
      return
    }

    workersEl.innerHTML = users.map(u => {
      const isMe   = u.id === state.user?.id
      const linked = u.telegram_chat_id ? '🟢' : '⚪'
      return `
        <div class="admin-user-row">
          <div class="admin-user-info">
            <div class="admin-user-name">${sanitize(u.name)} ${u.role === 'admin' ? '<span class="admin-role-badge">Admin</span>' : ''}</div>
            <div class="admin-user-meta">${sanitize(u.email)} · ${linked} ${u.telegram_chat_id ? 'TG vinculado' : 'Sin TG'}</div>
          </div>
          ${isMe || u.role === 'admin' ? '' : `<button class="admin-remove-btn" data-id="${u.id}" data-name="${sanitize(u.name)}">Quitar</button>`}
        </div>
      `
    }).join('')

    workersEl.querySelectorAll('.admin-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar a ${btn.dataset.name}? Sus gastos quedarán huérfanos.`)) return
        const res = await apiFetch(`/api/admin/users/${btn.dataset.id}`, { method: 'DELETE' })
        if (res.ok) renderAdminView()
      })
    })
  } catch (err) {
    workersEl.innerHTML = `<p style="color:var(--red); font-size:13px">${sanitize(err.message)}</p>`
  }
}

document.getElementById('adminRotateBtn')?.addEventListener('click', async () => {
  if (!confirm('¿Rotar el código de invitación? El código actual dejará de funcionar.')) return
  const res = await apiFetch('/api/admin/invite-code/rotate', { method: 'POST' })
  if (res.ok) renderAdminView()
})

document.getElementById('adminCopyBtn')?.addEventListener('click', () => {
  const code = document.getElementById('adminInviteCode').textContent
  if (!code || code === '—' || code === '...') return
  navigator.clipboard.writeText(code).catch(() => {})
  const btn = document.getElementById('adminCopyBtn')
  const original = btn.textContent
  btn.textContent = '¡Copiado!'
  setTimeout(() => { btn.textContent = original }, 1500)
})

// Hook into view switcher to load admin data when the tab is opened
const _originalSwitchView = switchView
switchView = function(viewId) {
  _originalSwitchView(viewId)
  if (viewId === 'admin') renderAdminView()
}

// ── Initial render ────────────────────────────────────────────
renderForMonth(state.selectedMonth)

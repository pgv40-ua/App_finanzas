// app.js — Expense Manager client
const socket = io()

// ── State ─────────────────────────────────────────────────────
const state = {
  allExpenses:      [],
  selectedMonth:    toMonthKey(new Date()),
  selectedYear:     String(new Date().getFullYear()),
  selectedCategory: '',
  searchQuery:      '',
  viewMode:         'grid',   // 'grid' | 'list'
  activeView:       'dashboard',
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
function filterExpenses(month, cat, query) {
  return state.allExpenses.filter(e => {
    if (getExpenseMonth(e) !== month) return false
    if (cat && categoryClass(e.category) !== cat) return false
    if (query) {
      const vendor = (e.vendor ?? '').toLowerCase()
      if (!vendor.includes(query.toLowerCase())) return false
    }
    return true
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
  const filtered = filterExpenses(month, state.selectedCategory, state.searchQuery)

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
  if (viewId === 'annual') renderAnnualView(state.selectedYear)
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
  window.location.href = `/api/export?month=${state.selectedMonth}`
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
socket.on('init', ({ expenses, connected }) => {
  removeSkeleton()
  if (expenses && expenses.length > 0) {
    state.allExpenses.push(...expenses)
  }
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
    const filtered = filterExpenses(state.selectedMonth, state.selectedCategory, state.searchQuery)
    const inFilter = filtered.some(e => e.id === expense.id)
    if (inFilter) {
      const card = buildCard(expense, 0)
      expenseGrid.prepend(card)
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('visible')))
      emptyState.classList.add('hidden')
    }
    updateKPIs(filterExpenses(state.selectedMonth, state.selectedCategory, state.searchQuery))
  }
})

socket.on('processing-error', () => removeSkeleton())

socket.on('whatsapp-disconnected', () => setConnectionState('disconnected'))

// ── Initial render ────────────────────────────────────────────
renderForMonth(state.selectedMonth)

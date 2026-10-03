// NomNom – Simple Private Food Tracker
// =====================================

// --- 1. API Client ---
const api = {
  baseUrl: '',
  token: '',

  init(url, token) {
    this.baseUrl = (url || window.location.origin).replace(/\/$/, '')
    this.token = token || ''
  },

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...(options.headers || {})
    }

    try {
      const response = await fetch(url, { ...options, headers })
      if (response.status === 401) {
        throw new Error('UNAUTHORIZED')
      }

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(data.error || `HTTP error ${response.status}`)
        // @ts-ignore
        error.status = response.status
        // @ts-ignore
        error.data = data
        throw error
      }
      return data
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Verbindung zum Server fehlgeschlagen. Bitte prüfe die Server-Adresse.')
      }
      throw err
    }
  },

  getHealth() {
    return this.request('/api/health')
  },

  getItems() {
    return this.request('/api/items')
  },

  getProduct(barcode) {
    return this.request(`/api/products/${encodeURIComponent(barcode)}`)
  },

  createProduct(barcode, name) {
    return this.request('/api/products', {
      method: 'POST',
      body: JSON.stringify({ barcode, name })
    })
  },

  openItem(productId) {
    return this.request('/api/items', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId })
    })
  },

  finishItem(itemId) {
    return this.request(`/api/items/${itemId}/finish`, {
      method: 'POST'
    })
  },

  reregisterItem(itemId) {
    return this.request(`/api/items/${itemId}/reregister`, {
      method: 'POST'
    })
  }
}

// --- 2. Barcode Scanner Module ---
const scanner = {
  videoElement: null,
  stream: null,
  detector: null,
  animationFrameId: null,
  isRunning: false,
  isTorchOn: false,
  track: null,
  onDetectedCallback: null,

  async isSupported() {
    return 'BarcodeDetector' in window && 'mediaDevices' in navigator
  },

  async start(videoElement, onDetected) {
    if (this.isRunning) return
    this.videoElement = videoElement
    this.onDetectedCallback = onDetected

    // 1. Check BarcodeDetector support
    if (!('BarcodeDetector' in window)) {
      throw new Error('BarcodeDetector wird von diesem Browser leider nicht unterstützt.')
    }

    try {
      const supportedFormats = await window.BarcodeDetector.getSupportedFormats().catch(() => [])
      const targetFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(f => supportedFormats.includes(f))
      const formatsToUse = targetFormats.length > 0 ? targetFormats : ['ean_13', 'ean_8', 'upc_a', 'upc_e']

      this.detector = new window.BarcodeDetector({ formats: formatsToUse })
    } catch (err) {
      console.warn('BarcodeDetector instantiation failed, falling back to default:', err)
      this.detector = new window.BarcodeDetector()
    }

    // 2. Request Camera Stream
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      })

      this.videoElement.srcObject = this.stream
      await this.videoElement.play()

      const tracks = this.stream.getVideoTracks()
      if (tracks.length > 0) {
        this.track = tracks[0]
      }

      this.isRunning = true
      this.detectLoop()
    } catch (err) {
      this.stop()
      throw err
    }
  },

  detectLoop() {
    if (!this.isRunning || !this.videoElement || !this.detector) return

    if (this.videoElement.readyState >= 2) {
      this.detector.detect(this.videoElement)
        .then((barcodes) => {
          if (!this.isRunning) return

          if (barcodes && barcodes.length > 0) {
            const rawValue = barcodes[0].rawValue?.trim()
            if (rawValue) {
              const callback = this.onDetectedCallback
              this.stop()
              if (callback) callback(rawValue)
              return
            }
          }
          this.animationFrameId = requestAnimationFrame(() => this.detectLoop())
        })
        .catch(() => {
          if (this.isRunning) {
            this.animationFrameId = requestAnimationFrame(() => this.detectLoop())
          }
        })
    } else {
      this.animationFrameId = requestAnimationFrame(() => this.detectLoop())
    }
  },

  async toggleTorch() {
    if (!this.track) return false
    const capabilities = this.track.getCapabilities ? this.track.getCapabilities() : {}
    if (!capabilities.torch) return false

    try {
      this.isTorchOn = !this.isTorchOn
      await this.track.applyConstraints({
        advanced: [{ torch: this.isTorchOn }]
      })
      return this.isTorchOn
    } catch (e) {
      console.error('Torch error:', e)
      return false
    }
  },

  stop() {
    this.isRunning = false
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        try { track.stop() } catch (_) {}
      })
      this.stream = null
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null
    }

    this.track = null
    this.isTorchOn = false
    this.detector = null
  }
}

// --- 3. UI Helpers & Formatters ---
function getFoodEmoji(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('milch') || n.includes('milk') || n.includes('hafer') || n.includes('mandel')) return '🥛'
  if (n.includes('käse') || n.includes('cheese') || n.includes('gouda') || n.includes('parmesan') || n.includes('mozzarella')) return '🧀'
  if (n.includes('butter') || n.includes('margarine')) return '🧈'
  if (n.includes('joghurt') || n.includes('yogurt') || n.includes('quark') || n.includes('skyr')) return '🥣'
  if (n.includes('ei') || n.includes('eier') || n.includes('egg')) return '🥚'
  if (n.includes('brot') || n.includes('bread') || n.includes('toast') || n.includes('brötchen') || n.includes('baguette')) return '🍞'
  if (n.includes('tomate') || n.includes('soße') || n.includes('sauce') || n.includes('ketchup') || n.includes('passata') || n.includes('pesto')) return '🍅'
  if (n.includes('apfel') || n.includes('apple')) return '🍎'
  if (n.includes('banane') || n.includes('banana')) return '🍌'
  if (n.includes('salat') || n.includes('gurke') || n.includes('gemüse') || n.includes('avocado')) return '🥗'
  if (n.includes('fleisch') || n.includes('wurst') || n.includes('schinken') || n.includes('salami') || n.includes('speck')) return '🥩'
  if (n.includes('fisch') || n.includes('lachs') || n.includes('thunfisch')) return '🐟'
  if (n.includes('saft') || n.includes('juice') || n.includes('cola') || n.includes('limo') || n.includes('wasser') || n.includes('drink')) return '🧃'
  if (n.includes('wein') || n.includes('wine') || n.includes('bier') || n.includes('beer') || n.includes('prosecco')) return '🍷'
  if (n.includes('marmelade') || n.includes('honig') || n.includes('aufstrich') || n.includes('nutella') || n.includes('creme')) return '🍯'
  if (n.includes('pasta') || n.includes('nudeln') || n.includes('spaghetti')) return '🍝'
  if (n.includes('pizza')) return '🍕'
  if (n.includes('suppe') || n.includes('soup') || n.includes('eintopf')) return '🍲'
  if (n.includes('schoko') || n.includes('keks') || n.includes('cookie') || n.includes('chips')) return '🍫'
  return '📦'
}

function formatOpenedDate(isoString) {
  if (!isoString) return { text: '', badge: '', fullText: '', ageDays: 0 }

  const date = new Date(isoString)
  const now = new Date()

  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const timeStr = `${hours}:${minutes}`

  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()

  const fullText = `${day}.${month}.${year} um ${timeStr} Uhr`

  // Day comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffTime = today.getTime() - itemDay.getTime()
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) {
    return {
      text: `geöffnet heute · ${timeStr}`,
      badge: 'Heute',
      fullText,
      ageDays: 0
    }
  } else if (diffDays === 1) {
    return {
      text: `geöffnet gestern · ${timeStr}`,
      badge: 'Gestern',
      fullText,
      ageDays: 1
    }
  } else {
    return {
      text: `geöffnet ${day}.${month}. · ${timeStr}`,
      badge: `vor ${diffDays} Tagen`,
      fullText,
      ageDays: diffDays
    }
  }
}

let toastTimeout = null
function showToast(message, duration = 2800) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = message
  toast.hidden = false
  toast.style.opacity = '1'

  clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toast.style.opacity = '0'
    setTimeout(() => { toast.hidden = true }, 250)
  }, duration)
}

// --- 4. Main App State & Controller ---
const appState = {
  currentView: 'list',
  items: [],
  selectedProductData: null, // { product, currentItem }
  pendingBarcode: null,
  isScanning: false
}

// DOM Elements
const views = {
  list: document.getElementById('view-list'),
  scanner: document.getElementById('view-scanner'),
  product: document.getElementById('view-product'),
  newProduct: document.getElementById('view-new-product'),
  settings: document.getElementById('view-settings')
}

const modalOnboarding = document.getElementById('modal-onboarding')
const itemsListEl = document.getElementById('items-list')
const itemsCountCaption = document.getElementById('items-count-caption')
const loadingState = document.getElementById('loading-state')
const emptyState = document.getElementById('empty-state')

// Navigation & View Routing
function switchView(viewName) {
  // If leaving scanner, ensure camera stopped
  if (appState.currentView === 'scanner' && viewName !== 'scanner') {
    scanner.stop()
    document.getElementById('scanner-loading').hidden = true
    document.getElementById('manual-barcode-box').hidden = true
  }

  appState.currentView = viewName

  // Update views visibility
  Object.keys(views).forEach(key => {
    if (views[key]) {
      views[key].hidden = (key !== viewName)
    }
  })

  // Scroll to top
  window.scrollTo(0, 0)

  if (viewName === 'scanner') {
    startScannerMode()
  } else if (viewName === 'list') {
    loadOpenItems()
  }
}

// Check Authentication / Setup
function checkAuth() {
  const token = localStorage.getItem('nomnom_token')
  const url = localStorage.getItem('nomnom_url') || window.location.origin

  if (!token) {
    document.getElementById('setup-server-url').value = url
    document.getElementById('setup-auth-token').value = ''
    modalOnboarding.hidden = false
    return false
  }

  api.init(url, token)
  modalOnboarding.hidden = true
  return true
}

// Load currently open items
async function loadOpenItems() {
  loadingState.hidden = false
  emptyState.hidden = true
  itemsListEl.innerHTML = ''
  itemsCountCaption.textContent = 'Wird aktualisiert...'

  try {
    const data = await api.getItems()
    appState.items = data.items || []
    renderItemsList(appState.items)
  } catch (err) {
    if (err.message === 'UNAUTHORIZED') {
      showToast('Zugangscode ungültig. Bitte neu eingeben.')
      modalOnboarding.hidden = false
      return
    }
    showToast('Fehler beim Laden der offenen Lebensmittel.')
    console.error('Error loading items:', err)
  } finally {
    loadingState.hidden = true
  }
}

// Render Items List
function renderItemsList(items) {
  itemsListEl.innerHTML = ''

  if (!items || items.length === 0) {
    emptyState.hidden = false
    itemsCountCaption.textContent = 'Keine geöffneten Lebensmittel'
    return
  }

  emptyState.hidden = true
  itemsCountCaption.textContent = items.length === 1 ? '1 geöffnetes Lebensmittel' : `${items.length} geöffnete Lebensmittel`

  items.forEach(item => {
    const formatted = formatOpenedDate(item.opened_at)
    const emoji = getFoodEmoji(item.name)

    const li = document.createElement('li')
    li.className = 'item-card'
    li.tabIndex = 0
    li.setAttribute('role', 'button')
    li.setAttribute('aria-label', `${item.name}, ${formatted.text}`)

    let badgeClass = 'item-badge'
    if (formatted.ageDays <= 1) badgeClass += ' badge-fresh'
    else if (formatted.ageDays >= 4) badgeClass += ' badge-older'

    li.innerHTML = `
      <div class="item-emoji" aria-hidden="true">${emoji}</div>
      <div class="item-info">
        <div class="item-title">${escapeHtml(item.name)}</div>
        <div class="item-time-row">
          <span class="item-time-text">${formatted.text}</span>
          <span class="${badgeClass}">${formatted.badge}</span>
        </div>
      </div>
      <div class="item-arrow" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    `

    li.addEventListener('click', () => {
      openProductDetailFromItem(item)
    })

    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openProductDetailFromItem(item)
      }
    })

    itemsListEl.appendChild(li)
  })
}

// Start Scanner Mode
async function startScannerMode() {
  const videoEl = document.getElementById('scanner-video')
  const torchBtn = document.getElementById('btn-scanner-torch')
  const instruction = document.getElementById('scanner-instruction')
  const manualBox = document.getElementById('manual-barcode-box')

  instruction.textContent = 'Halte den Barcode mittig in das Zielfenster'
  torchBtn.hidden = true
  manualBox.hidden = true

  try {
    await scanner.start(videoEl, async (barcode) => {
      handleBarcodeDetected(barcode)
    })

    // Check if torch is available
    if (scanner.track && scanner.track.getCapabilities) {
      const caps = scanner.track.getCapabilities()
      if (caps.torch) {
        torchBtn.hidden = false
      }
    }
  } catch (err) {
    console.warn('Scanner camera error or unsupported:', err)
    instruction.textContent = err.message || 'Kamera konnte nicht geöffnet werden.'
    manualBox.hidden = false
    document.getElementById('input-manual-barcode').focus()
  }
}

// Process detected or entered barcode
async function handleBarcodeDetected(barcode) {
  if (!barcode) return
  scanner.stop()

  const overlayLoading = document.getElementById('scanner-loading')
  overlayLoading.hidden = false

  try {
    // 1. Query backend for product (D1 lookup with Open Food Facts fallback)
    const data = await api.getProduct(barcode)
    appState.selectedProductData = data
    overlayLoading.hidden = true
    showProductDetail(data)
  } catch (err) {
    overlayLoading.hidden = true

    // Check if product is unknown (404)
    if (err.status === 404) {
      appState.pendingBarcode = barcode
      showNewProductView(barcode)
    } else if (err.message === 'UNAUTHORIZED') {
      showToast('Zugangscode ungültig.')
      modalOnboarding.hidden = false
    } else {
      showToast('Produkt konnte nicht geladen werden.')
      switchView('list')
    }
  }
}

// Show Product Detail View (Case A: Already open, Case B: Currently closed)
function showProductDetail(productData) {
  const { product, currentItem } = productData
  appState.selectedProductData = productData

  const emojiEl = document.getElementById('detail-emoji')
  const nameEl = document.getElementById('detail-name')
  const barcodeEl = document.getElementById('detail-barcode')

  const statusBox = document.getElementById('detail-status-box')
  const statusDot = document.getElementById('detail-status-dot')
  const statusLabel = document.getElementById('detail-status-label')
  const ageBadge = document.getElementById('detail-age-badge')
  const timeText = document.getElementById('detail-time-text')

  const actionsOpened = document.getElementById('actions-opened')
  const actionsClosed = document.getElementById('actions-closed')

  emojiEl.textContent = getFoodEmoji(product.name)
  nameEl.textContent = product.name
  barcodeEl.textContent = `Barcode: ${product.barcode}`

  if (currentItem) {
    // FALL A: Currently Open
    const formatted = formatOpenedDate(currentItem.opened_at)
    statusDot.className = 'status-dot'
    statusLabel.textContent = 'Geöffnet'
    ageBadge.hidden = false
    ageBadge.textContent = formatted.badge
    timeText.textContent = formatted.fullText

    actionsOpened.hidden = false
    actionsClosed.hidden = true
  } else {
    // FALL B: Not currently open
    statusDot.className = 'status-dot inactive'
    statusLabel.textContent = 'Aktuell nicht geöffnet'
    ageBadge.hidden = true
    timeText.textContent = 'Noch keine aktive Erfassung im Haushalt.'

    actionsOpened.hidden = true
    actionsClosed.hidden = false
  }

  switchView('product')
}

// Open Detail View directly from a list item
function openProductDetailFromItem(item) {
  const productData = {
    product: {
      id: item.product_id,
      name: item.name,
      barcode: item.barcode,
      created_at: item.created_at
    },
    currentItem: {
      id: item.id,
      product_id: item.product_id,
      opened_at: item.opened_at,
      finished_at: null,
      created_at: item.created_at
    }
  }
  showProductDetail(productData)
}

// Show New Product Form for unknown barcodes
function showNewProductView(barcode) {
  document.getElementById('new-product-barcode-label').textContent = `Barcode: ${barcode}`
  const nameInput = document.getElementById('input-new-product-name')
  nameInput.value = ''
  switchView('newProduct')
  setTimeout(() => nameInput.focus(), 150)
}

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// --- 5. Event Listeners ---
function setupEventListeners() {
  // Brand Header Click -> Go to List
  document.getElementById('header-home-btn').addEventListener('click', () => {
    switchView('list')
  })

  // Refresh Button
  document.getElementById('btn-refresh').addEventListener('click', () => {
    loadOpenItems()
    showToast('Aktualisiert')
  })

  // FAB Scanner Button
  document.getElementById('fab-scan').addEventListener('click', () => {
    switchView('scanner')
  })

  // Empty State Scan Button
  document.getElementById('btn-empty-scan').addEventListener('click', () => {
    switchView('scanner')
  })

  // Close Scanner Button
  document.getElementById('btn-scanner-close').addEventListener('click', () => {
    switchView('list')
  })

  // Torch Toggle Button
  document.getElementById('btn-scanner-torch').addEventListener('click', async () => {
    const isTorchOn = await scanner.toggleTorch()
    const btn = document.getElementById('btn-scanner-torch')
    btn.style.background = isTorchOn ? 'rgba(234, 88, 12, 0.8)' : 'rgba(255, 255, 255, 0.18)'
  })

  // Toggle Manual Barcode Box
  document.getElementById('btn-manual-entry-toggle').addEventListener('click', () => {
    const box = document.getElementById('manual-barcode-box')
    box.hidden = !box.hidden
    if (!box.hidden) {
      document.getElementById('input-manual-barcode').focus()
    }
  })

  // Manual Barcode Submit
  document.getElementById('btn-manual-barcode-submit').addEventListener('click', () => {
    const barcode = document.getElementById('input-manual-barcode').value.trim()
    if (barcode) {
      handleBarcodeDetected(barcode)
    }
  })

  document.getElementById('input-manual-barcode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const barcode = e.target.value.trim()
      if (barcode) {
        handleBarcodeDetected(barcode)
      }
    }
  })

  // Product Back Button
  document.getElementById('btn-product-back').addEventListener('click', () => {
    switchView('list')
  })

  // New Product Back Button
  document.getElementById('btn-new-product-back').addEventListener('click', () => {
    switchView('list')
  })

  // Action: Finish Item (✓ Erledigt)
  document.getElementById('btn-action-finish').addEventListener('click', async () => {
    const currentItem = appState.selectedProductData?.currentItem
    if (!currentItem) return

    const btn = document.getElementById('btn-action-finish')
    btn.disabled = true
    try {
      await api.finishItem(currentItem.id)
      showToast('✓ Als erledigt markiert')
      switchView('list')
    } catch (err) {
      showToast('Fehler beim Markieren als erledigt.')
      console.error(err)
    } finally {
      btn.disabled = false
    }
  })

  // Action: Reregister Item (↻ Neu registrieren)
  document.getElementById('btn-action-reregister').addEventListener('click', async () => {
    const currentItem = appState.selectedProductData?.currentItem
    if (!currentItem) return

    const btn = document.getElementById('btn-action-reregister')
    btn.disabled = true
    try {
      await api.reregisterItem(currentItem.id)
      showToast('↻ Neu registriert')
      switchView('list')
    } catch (err) {
      showToast('Fehler beim Neu-Registrieren.')
      console.error(err)
    } finally {
      btn.disabled = false
    }
  })

  // Action: Open Item (Jetzt öffnen)
  document.getElementById('btn-action-open').addEventListener('click', async () => {
    const product = appState.selectedProductData?.product
    if (!product) return

    const btn = document.getElementById('btn-action-open')
    btn.disabled = true
    try {
      await api.openItem(product.id)
      showToast('Geöffnet')
      switchView('list')
    } catch (err) {
      showToast('Fehler beim Öffnen des Produkts.')
      console.error(err)
    } finally {
      btn.disabled = false
    }
  })

  // New Product Form Submit
  document.getElementById('form-new-product').addEventListener('submit', async (e) => {
    e.preventDefault()
    const barcode = appState.pendingBarcode
    const name = document.getElementById('input-new-product-name').value.trim()
    if (!barcode || !name) return

    const submitBtn = document.getElementById('btn-save-and-open')
    submitBtn.disabled = true
    try {
      // 1. Create product
      const productRes = await api.createProduct(barcode, name)
      const product = productRes.product

      // 2. Open item directly
      await api.openItem(product.id)

      showToast(`"${product.name}" gespeichert und geöffnet`)
      switchView('list')
    } catch (err) {
      showToast('Fehler beim Speichern des Produkts.')
      console.error(err)
    } finally {
      submitBtn.disabled = false
    }
  })

  // Settings Open Button
  document.getElementById('btn-settings-open').addEventListener('click', () => {
    document.getElementById('input-server-url').value = api.baseUrl
    document.getElementById('input-auth-token').value = api.token
    switchView('settings')
  })

  // Settings Back Button
  document.getElementById('btn-settings-back').addEventListener('click', () => {
    switchView('list')
  })

  // Settings Form Submit
  document.getElementById('form-settings').addEventListener('submit', async (e) => {
    e.preventDefault()
    const url = document.getElementById('input-server-url').value.trim()
    const token = document.getElementById('input-auth-token').value.trim()

    try {
      api.init(url, token)
      // Test credentials with items call
      await api.getItems()

      localStorage.setItem('nomnom_url', url)
      localStorage.setItem('nomnom_token', token)

      showToast('Einstellungen gespeichert')
      switchView('list')
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') {
        showToast('Fehler: Ungültiger Zugangscode')
      } else {
        showToast('Verbindungstest fehlgeschlagen')
      }
    }
  })

  // Logout / Clear Household Credentials
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm('Möchtest du die Haushalts-Zugangsdaten von diesem Gerät entfernen?')) {
      localStorage.removeItem('nomnom_token')
      localStorage.removeItem('nomnom_url')
      api.init('', '')
      checkAuth()
    }
  })

  // Onboarding Form Submit
  document.getElementById('form-onboarding').addEventListener('submit', async (e) => {
    e.preventDefault()
    const url = document.getElementById('setup-server-url').value.trim()
    const token = document.getElementById('setup-auth-token').value.trim()
    const submitBtn = document.getElementById('btn-onboarding-submit')

    submitBtn.disabled = true
    submitBtn.textContent = 'Verbinde...'

    try {
      api.init(url, token)
      await api.getItems()

      localStorage.setItem('nomnom_url', url)
      localStorage.setItem('nomnom_token', token)

      modalOnboarding.hidden = true
      showToast('Erfolgreich verbunden!')
      switchView('list')
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') {
        showToast('Ungültiger Zugangscode')
      } else {
        showToast('Server nicht erreichbar')
      }
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Verbinden'
    }
  })
}

// --- 6. PWA Service Worker Registration ---
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('NomNom ServiceWorker registered:', reg.scope)
      }).catch((err) => {
        console.warn('NomNom ServiceWorker registration failed:', err)
      })
    })
  }
}

// Initialize App
function initApp() {
  setupEventListeners()
  registerServiceWorker()

  if (checkAuth()) {
    switchView('list')
  }
}

// Run on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp)
} else {
  initApp()
}

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
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message = data.error || (response.status === 401 ? 'Ungültiger Zugangscode' : `Serverfehler (${response.status})`)
        const error = new Error(message)
        // @ts-ignore
        error.status = response.status
        // @ts-ignore
        error.code = data.code || (response.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR')
        // @ts-ignore
        error.data = data
        throw error
      }
      return data
    } catch (err) {
      if (err.name === 'TypeError' && (err.message.includes('fetch') || err.message.includes('NetworkError') || err.message.includes('Failed to fetch'))) {
        const netErr = new Error(`Server unter "${this.baseUrl}" nicht erreichbar. Bitte prüfe Internetverbindung und Server-Adresse.`)
        // @ts-ignore
        netErr.status = 0
        // @ts-ignore
        netErr.code = 'NETWORK_ERROR'
        throw netErr
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

  refreshProduct(barcode) {
    return this.request(`/api/products/${encodeURIComponent(barcode)}/refresh`, {
      method: 'POST'
    })
  },

  createProduct(barcode, name) {
    return this.request('/api/products', {
      method: 'POST',
      body: JSON.stringify({ barcode, name })
    })
  },

  openItem(productId, openedAt = null) {
    return this.request('/api/items', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        ...(openedAt ? { opened_at: openedAt } : {})
      })
    })
  },

  finishItem(itemId) {
    return this.request(`/api/items/${itemId}/finish`, {
      method: 'POST'
    })
  },

  reregisterItem(itemId, openedAt = null) {
    return this.request(`/api/items/${itemId}/reregister`, {
      method: 'POST',
      body: JSON.stringify({
        ...(openedAt ? { opened_at: openedAt } : {})
      })
    })
  },

  updateItem(itemId, data) {
    return this.request(`/api/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
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
        try { track.stop() } catch (_) { }
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
  const n = ' ' + (name || '').toLowerCase() + ' '

  // 1. Getränke (Kaffee, Tee, Saft, Bier, Wein, Softdrinks)
  if (n.includes('kaffee') || n.includes('coffee') || n.includes('espresso') || n.includes('cappuccino')) return '☕'
  if (n.includes('tee') || n.includes('tea') || n.includes('matcha')) return '🍵'
  if (n.includes('saft') || n.includes('juice') || n.includes('smoothie') || n.includes('nektar')) return '🧃'
  if (n.includes('bier') || n.includes('pils') || n.includes('radler') || n.includes('weizen') || n.includes('lager') || n.includes('ipa') || /\bbeer\b/.test(n)) return '🍺'
  if (n.includes('wein') || n.includes('wine') || n.includes('rotwein') || n.includes('weißwein') || n.includes('sekt') || n.includes('prosecco') || n.includes('champagn')) return '🍷'
  if (n.includes('cocktail') || n.includes('gin') || n.includes('vodka') || n.includes('wodka') || n.includes('rum') || n.includes('whisky') || n.includes('likör') || n.includes('aperol')) return '🍸'
  if (n.includes('cola') || n.includes('pepsi') || n.includes('fanta') || n.includes('sprite') || n.includes('limo') || n.includes('spezi')) return '🥤'
  if (n.includes('wasser') || n.includes('water') || n.includes('mineralwasser') || n.includes('sprudel')) return '💧'

  // 2. Früchte & Beeren
  if (n.includes('erdbeer') || n.includes('himbeer') || n.includes('blaubeer') || n.includes('heidelbeer') || n.includes('brombeer') || n.includes('beere') || n.includes('berry')) return '🍓'
  if (n.includes('apfel') || n.includes('apple')) return '🍎'
  if (n.includes('banane') || n.includes('banana')) return '🍌'
  if (n.includes('zitrone') || n.includes('lemon') || n.includes('limette') || n.includes('lime')) return '🍋'
  if (n.includes('orange') || n.includes('mandarine') || n.includes('clementine')) return '🍊'
  if (n.includes('traube') || n.includes('weintraube') || n.includes('grape')) return '🍇'
  if (n.includes('melone') || n.includes('melon')) return '🍉'
  if (n.includes('pfirsich') || n.includes('peach') || n.includes('pflaume') || n.includes('zwetschge')) return '🍑'
  if (n.includes('kirsche') || n.includes('cherry')) return '🍒'
  if (n.includes('ananas') || n.includes('pineapple')) return '🍍'
  if (n.includes('mango')) return '🥭'

  // 3. Müsli, Haferflocken & Cerealien (vor Haferdrink)
  if (n.includes('haferflocke') || n.includes('müsli') || n.includes('muesli') || n.includes('granola') || n.includes('cerealien') || n.includes('cornflakes') || n.includes('oats')) return '🌾'

  // 4. Snacks, Chips & Süßes (vor Kartoffel)
  if (n.includes('chips') || n.includes('popcorn') || n.includes('nachos') || n.includes('flips')) return '🍿'
  if (n.includes('schoko') || n.includes('chocolate') || n.includes('kakao') || n.includes('nutella')) return '🍫'
  if (n.includes('keks') || n.includes('cookie') || n.includes('waffel') || n.includes('biskuit') || n.includes('gebäck')) return '🍪'
  if (n.includes('kuchen') || n.includes('torte') || n.includes('cake') || n.includes('muffin')) return '🍰'
  if (n.includes('bonbon') || n.includes('gummibär') || n.includes('haribo') || n.includes('candy') || n.includes('fruchtgummi')) return '🍬'
  if (n.includes('eiscreme') || n.includes('speiseeis') || n.includes('ice cream') || n.includes('sorbet') || n.includes('gelato')) return '🍨'
  if (n.includes('erdnuss') || n.includes('walnuss') || n.includes('haselnuss') || n.includes('cashew') || n.includes('pistazie') || n.includes('nüsse') || n.includes('nuts')) return '🥜'

  // 5. Fleisch & Wurst (vor Ei)
  if (n.includes('speck') || n.includes('bacon') || n.includes('schinken') || n.includes('prosciutto')) return '🥓'
  if (n.includes('wurst') || n.includes('wiener') || n.includes('würstchen') || n.includes('bratwurst') || n.includes('salami') || n.includes('leberwurst')) return '🌭'
  if (n.includes('hähnchen') || n.includes('huhn') || n.includes('chicken') || n.includes('pute') || n.includes('geflügel') || n.includes('nugget')) return '🍗'
  if (n.includes('fleisch') || n.includes('hack') || n.includes('rind') || n.includes('schwein') || n.includes('steak') || n.includes('beef') || n.includes('meat') || n.includes('burger')) return '🥩'

  // 6. Fisch & Meeresfrüchte
  if (n.includes('garnele') || n.includes('shrimp') || n.includes('prawn') || n.includes('scampi') || n.includes('meeresfrucht')) return '🦐'
  if (n.includes('fisch') || n.includes('fish') || n.includes('lachs') || n.includes('salmon') || n.includes('thunfisch') || n.includes('tuna') || n.includes('forelle') || n.includes('hering') || n.includes('kabeljau')) return '🐟'

  // 7. Eier (wortgrenzen-sicher)
  if (/\b(ei|eier|egg|eggs)\b/i.test(n) || n.includes('hühnerei')) return '🥚'

  // 8. Milch, Molkereiprodukte & pflanzliche Alternativen
  if (n.includes('käse') || n.includes('cheese') || n.includes('gouda') || n.includes('parmesan') || n.includes('mozzarella') || n.includes('cheddar') || n.includes('feta') || n.includes('brie') || n.includes('camembert') || n.includes('frischkäse') || n.includes('buko') || n.includes('ricotta')) return '🧀'
  if (n.includes('butter') || n.includes('margarine') || n.includes('ghee')) return '🧈'
  if (n.includes('joghurt') || n.includes('yogurt') || n.includes('quark') || n.includes('skyr') || n.includes('pudding') || n.includes('grieß')) return '🥣'
  if (n.includes('sahne') || n.includes('cream') || n.includes('schmand') || n.includes('crème')) return '🍦'
  if (n.includes('milch') || n.includes('milk') || n.includes('hafer') || n.includes('soja') || n.includes('mandeldrink') || n.includes('drink')) return '🥛'

  // 9. Backwaren & Teig
  if (n.includes('croissant') || n.includes('hörnchen')) return '🥐'
  if (n.includes('baguette') || n.includes('brötchen') || n.includes('semmel') || n.includes('ciabatta')) return '🥖'
  if (n.includes('brot') || n.includes('bread') || n.includes('toast') || n.includes('fladenbrot')) return '🍞'
  if (n.includes('wrap') || n.includes('tortilla') || n.includes('taco') || n.includes('burrito')) return '🌮'
  if (n.includes('reis') || n.includes('rice') || n.includes('basmati')) return '🍚'

  // 10. Warme Gerichte & Teigwaren
  if (n.includes('pasta') || n.includes('nudeln') || n.includes('spaghetti') || n.includes('penne') || n.includes('lasagne') || n.includes('fusilli') || n.includes('tortellini') || n.includes('tagliatelle')) return '🍝'
  if (n.includes('pizza')) return '🍕'
  if (n.includes('suppe') || n.includes('soup') || n.includes('eintopf') || n.includes('brühe') || n.includes('bouillon')) return '🍲'
  if (n.includes('ramen') || n.includes('udon') || n.includes('curry') || n.includes('wok')) return '🍜'
  if (n.includes('gnocchi') || n.includes('dumpling') || n.includes('knödel') || n.includes('maultasche')) return '🥟'

  // 11. Saucen, Aufstriche, Gewürze & Öle
  if (n.includes('tomate') || n.includes('soße') || n.includes('sauce') || n.includes('ketchup') || n.includes('passata') || n.includes('pesto')) return '🍅'
  if (n.includes('marmelade') || n.includes('konfitüre') || n.includes('jam') || n.includes('honig') || n.includes('honey') || n.includes('aufstrich') || n.includes('erdnussbutter')) return '🍯'
  if (n.includes('mayo') || n.includes('mayonnaise') || n.includes('remoulade') || n.includes('aioli')) return '🧴'
  if (n.includes('öl') || n.includes('oil') || n.includes('essig') || n.includes('vinegar') || n.includes('balsamico')) return '🫒'
  if (n.includes('senf') || n.includes('mustard')) return '🟡'
  if (n.includes('salz') || n.includes('salt') || n.includes('pfeffer') || n.includes('pepper') || n.includes('gewürz') || n.includes('spice')) return '🧂'

  // 12. Gemüse & Veggie
  if (n.includes('avocado')) return '🥑'
  if (n.includes('gurke') || n.includes('cucumber') || n.includes('zucchini')) return '🥒'
  if (n.includes('karotte') || n.includes('möhre') || n.includes('carrot')) return '🥕'
  if (n.includes('kartoffel') || n.includes('potato') || n.includes('pommes')) return '🥔'
  if (n.includes('mais') || n.includes('corn')) return '🌽'
  if (n.includes('salat') || n.includes('lettuce') || n.includes('rucola') || n.includes('spinat') || n.includes('greens')) return '🥗'
  if (n.includes('zwiebel') || n.includes('onion') || n.includes('knoblauch') || n.includes('garlic') || n.includes('lauch')) return '🧅'
  if (n.includes('paprika') || n.includes('chili') || n.includes('peperoni') || n.includes('jalapeno')) return '🫑'
  if (n.includes('pilz') || n.includes('champignon') || n.includes('mushroom')) return '🍄'
  if (n.includes('brokkoli') || n.includes('broccoli') || n.includes('blumenkohl')) return '🥦'
  if (n.includes('bohne') || n.includes('bean') || n.includes('erbse') || n.includes('linse') || n.includes('kichererbse') || n.includes('edamame')) return '🫘'
  if (n.includes('tofu') || n.includes('tempeh') || n.includes('seitan')) return '🧊'

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

function toLocalDatetimeInputString(date = new Date()) {
  const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date(date)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const year = d.getFullYear()
  const month = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hours = pad(d.getHours())
  const minutes = pad(d.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
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

// --- 3b. Theme Manager (Light, Dark, System) ---
const themeManager = {
  currentTheme: 'system',

  init() {
    this.currentTheme = localStorage.getItem('nomnom_theme') || 'system'
    this.applyTheme(this.currentTheme)

    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.currentTheme === 'system') {
          this.applyTheme('system')
        }
      })
    } catch (_) {}
  },

  setTheme(theme) {
    if (!['system', 'light', 'dark'].includes(theme)) return
    this.currentTheme = theme
    localStorage.setItem('nomnom_theme', theme)
    this.applyTheme(theme)
  },

  applyTheme(theme) {
    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

    document.documentElement.setAttribute('data-theme', theme)
    if (isDark) {
      document.documentElement.classList.add('dark')
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    }

    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isDark ? '#171513' : '#f8f7f4')
    }

    this.updateUI(theme)
  },

  updateUI(theme) {
    const options = document.querySelectorAll('.theme-option')
    options.forEach(btn => {
      const isSelected = btn.dataset.theme === theme
      btn.classList.toggle('active', isSelected)
      btn.setAttribute('aria-checked', isSelected ? 'true' : 'false')
    })
  }
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
  }
}

function setFormError(elementId, message) {
  const el = document.getElementById(elementId)
  if (!el) return
  if (message) {
    el.textContent = message
    el.hidden = false
  } else {
    el.textContent = ''
    el.hidden = true
  }
}

// Check Authentication / Setup
function checkAuth() {
  const token = localStorage.getItem('nomnom_token')
  const url = localStorage.getItem('nomnom_url') || window.location.origin

  if (!token) {
    document.getElementById('setup-server-url').value = url
    document.getElementById('setup-auth-token').value = ''
    setFormError('onboarding-error-box', '')
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
  itemsListEl.hidden = true
  itemsListEl.innerHTML = ''
  itemsCountCaption.textContent = 'Wird geladen...'

  try {
    const data = await api.getItems()
    appState.items = data.items || []
    renderItemsList(appState.items)
  } catch (err) {
    console.error('Error loading items:', err)
    if (err.status === 401 || err.code === 'UNAUTHORIZED' || err.code === 'INVALID_TOKEN') {
      showToast(err.message || 'Zugangscode ungültig. Bitte neu eingeben.')
      setFormError('onboarding-error-box', err.message || 'Zugangscode ungültig. Bitte neu eingeben.')
      modalOnboarding.hidden = false
      return
    }
    showToast(err.message || 'Fehler beim Laden der offenen Lebensmittel.')
    emptyState.hidden = false
    itemsListEl.hidden = true
    itemsCountCaption.textContent = 'Fehler beim Laden'
  } finally {
    loadingState.hidden = true
  }
}

// Render Items List
function renderItemsList(items) {
  itemsListEl.innerHTML = ''

  if (!items || items.length === 0) {
    emptyState.hidden = false
    itemsListEl.hidden = true
    itemsCountCaption.textContent = 'Keine geöffneten Lebensmittel'
    return
  }

  emptyState.hidden = true
  itemsListEl.hidden = false
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

    const mediaHtml = item.image_url
      ? `<img class="item-thumb-img" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
         <div class="item-emoji" style="display:none;" aria-hidden="true">${emoji}</div>`
      : `<div class="item-emoji" aria-hidden="true">${emoji}</div>`

    li.innerHTML = `
      ${mediaHtml}
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
    console.error('Error fetching barcode product:', err)

    // Check if product is unknown (404)
    if (err.status === 404) {
      appState.pendingBarcode = barcode
      showNewProductView(barcode)
    } else if (err.status === 401 || err.code === 'UNAUTHORIZED' || err.code === 'INVALID_TOKEN') {
      showToast(err.message || 'Zugangscode ungültig.')
      setFormError('onboarding-error-box', err.message || 'Zugangscode ungültig.')
      modalOnboarding.hidden = false
    } else {
      showToast(err.message || 'Produkt konnte nicht geladen werden.')
      switchView('list')
    }
  }
}

// Render Nutrition Card & Badges
function renderNutritionCard(details) {
  const card = document.getElementById('card-nutrition')
  const nsContainer = document.getElementById('nutriscore-badge-container')
  const novaContainer = document.getElementById('nova-badge-container')
  const tableSection = document.getElementById('nutrition-table-section')
  const tableBody = document.getElementById('nutrition-table-body')
  const ingredientsSection = document.getElementById('nutrition-ingredients-section')
  const ingredientsText = document.getElementById('nutrition-ingredients-text')

  if (!card) return

  if (!details || (!details.nutriscore_grade && !details.nova_group && !details.nutriments_json && !details.ingredients)) {
    card.hidden = true
    return
  }

  card.hidden = false

  // 1. Nutri-Score badge
  if (details.nutriscore_grade) {
    const grade = String(details.nutriscore_grade).toLowerCase().trim()
    nsContainer.hidden = false
    nsContainer.innerHTML = `
      <span class="nutriscore-badge nutriscore-${grade}">
        <span class="ns-label">NUTRI-SCORE</span>
        <span class="ns-grade">${grade.toUpperCase()}</span>
      </span>
    `
  } else {
    nsContainer.hidden = true
    nsContainer.innerHTML = ''
  }

  // 2. NOVA badge
  if (details.nova_group) {
    novaContainer.hidden = false
    novaContainer.innerHTML = `
      <span class="nova-badge nova-${details.nova_group}">NOVA ${details.nova_group}</span>
    `
  } else {
    novaContainer.hidden = true
    novaContainer.innerHTML = ''
  }

  // 3. Nutriments Table
  let hasNutriments = false
  tableBody.innerHTML = ''
  if (details.nutriments_json) {
    try {
      const nm = typeof details.nutriments_json === 'string' ? JSON.parse(details.nutriments_json) : details.nutriments_json
      const rows = []
      if (nm.energyKcal != null) rows.push({ name: 'Energie', val: `${Math.round(nm.energyKcal)} kcal` })
      if (nm.fat != null) rows.push({ name: 'Fett', val: `${Number(nm.fat).toFixed(1)} g` })
      if (nm.saturatedFat != null) rows.push({ name: 'davon gesättigte Fettsäuren', val: `${Number(nm.saturatedFat).toFixed(1)} g`, sub: true })
      if (nm.carbohydrates != null) rows.push({ name: 'Kohlenhydrate', val: `${Number(nm.carbohydrates).toFixed(1)} g` })
      if (nm.sugars != null) rows.push({ name: 'davon Zucker', val: `${Number(nm.sugars).toFixed(1)} g`, sub: true })
      if (nm.fiber != null) rows.push({ name: 'Ballaststoffe', val: `${Number(nm.fiber).toFixed(1)} g` })
      if (nm.proteins != null) rows.push({ name: 'Eiweiß', val: `${Number(nm.proteins).toFixed(1)} g` })
      if (nm.salt != null) rows.push({ name: 'Salz', val: `${Number(nm.salt).toFixed(2)} g` })

      if (rows.length > 0) {
        hasNutriments = true
        tableBody.innerHTML = rows.map(r => `
          <tr class="${r.sub ? 'sub-nutrient' : ''}">
            <td class="nutrient-name">${escapeHtml(r.name)}</td>
            <td class="nutrient-val">${escapeHtml(r.val)}</td>
          </tr>
        `).join('')
      }
    } catch (err) {
      console.warn('Failed to parse nutriments_json:', err)
    }
  }
  tableSection.hidden = !hasNutriments

  // 4. Ingredients
  if (details.ingredients) {
    ingredientsSection.hidden = false
    ingredientsText.textContent = details.ingredients
  } else {
    ingredientsSection.hidden = true
    ingredientsText.textContent = ''
  }
}

// Show Product Detail View (Case A: Already open, Case B: Currently closed)
function showProductDetail(productData) {
  const { product, currentItem } = productData
  appState.selectedProductData = productData

  const emojiEl = document.getElementById('detail-emoji')
  const imageEl = document.getElementById('detail-image')
  const nameEl = document.getElementById('detail-name')
  const barcodeEl = document.getElementById('detail-barcode')

  const statusBox = document.getElementById('detail-status-box')
  const statusDot = document.getElementById('detail-status-dot')
  const statusLabel = document.getElementById('detail-status-label')
  const ageBadge = document.getElementById('detail-age-badge')
  const timeText = document.getElementById('detail-time-text')
  const expandIcon = document.getElementById('status-expand-icon')
  const editDrawer = document.getElementById('box-edit-date')
  const editDateInput = document.getElementById('input-edit-current-date')

  const actionsOpened = document.getElementById('actions-opened')
  const actionsClosed = document.getElementById('actions-closed')

  // Product Image or Emoji Fallback
  if (productData.details?.image_url) {
    imageEl.src = productData.details.image_url
    imageEl.hidden = false
    emojiEl.hidden = true
    imageEl.onerror = () => {
      imageEl.hidden = true
      emojiEl.hidden = false
      emojiEl.textContent = getFoodEmoji(product.name)
    }
  } else {
    imageEl.hidden = true
    emojiEl.hidden = false
    emojiEl.textContent = getFoodEmoji(product.name)
  }

  nameEl.textContent = product.name
  barcodeEl.textContent = `Barcode: ${product.barcode}`

  // Render nutrition details
  renderNutritionCard(productData.details)

  // Reset nutrition accordion state
  const nutritionDrawer = document.getElementById('nutrition-drawer')
  const nutritionCard = document.getElementById('card-nutrition')
  const btnNutritionToggle = document.getElementById('btn-nutrition-toggle')
  if (nutritionDrawer && nutritionCard && btnNutritionToggle) {
    nutritionDrawer.hidden = true
    nutritionCard.classList.remove('expanded')
    btnNutritionToggle.setAttribute('aria-expanded', 'false')
  }

  const nowLocalStr = toLocalDatetimeInputString(new Date())

  if (currentItem) {
    // FALL A: Currently Open
    const formatted = formatOpenedDate(currentItem.opened_at)
    statusDot.className = 'status-dot'
    statusLabel.textContent = 'Geöffnet'
    ageBadge.hidden = false
    ageBadge.textContent = formatted.badge
    timeText.textContent = formatted.fullText

    statusBox.classList.add('clickable')
    statusBox.classList.remove('expanded')
    if (expandIcon) expandIcon.hidden = false
    if (editDrawer) editDrawer.hidden = true
    if (editDateInput) editDateInput.value = toLocalDatetimeInputString(new Date(currentItem.opened_at))

    // Set reregister date picker default to now
    const reregDateInput = document.getElementById('input-reregister-date')
    if (reregDateInput) reregDateInput.value = nowLocalStr

    actionsOpened.hidden = false
    actionsClosed.hidden = true
  } else {
    // FALL B: Not currently open
    statusDot.className = 'status-dot inactive'
    statusLabel.textContent = 'Aktuell nicht geöffnet'
    ageBadge.hidden = true
    timeText.textContent = 'Noch keine aktive Erfassung im Haushalt.'

    statusBox.classList.remove('clickable')
    statusBox.classList.remove('expanded')
    if (expandIcon) expandIcon.hidden = true
    if (editDrawer) editDrawer.hidden = true

    // Set open date picker default to now
    const openDateInput = document.getElementById('input-open-date')
    if (openDateInput) openDateInput.value = nowLocalStr

    actionsOpened.hidden = true
    actionsClosed.hidden = false
  }

  switchView('product')
}

// Open Detail View directly from a list item
async function openProductDetailFromItem(item) {
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
    },
    details: item.image_url ? { image_url: item.image_url } : null
  }
  showProductDetail(productData)

  // Asynchronously fetch full product details (Nutri-Score, nutriments, ingredients)
  try {
    const fullData = await api.getProduct(item.barcode)
    if (appState.currentView === 'product' && appState.selectedProductData?.product.barcode === item.barcode) {
      appState.selectedProductData = fullData
      showProductDetail(fullData)
    }
  } catch (err) {
    console.warn('Could not load full product details for item:', err)
  }
}

// Show New Product Form for unknown barcodes
function showNewProductView(barcode) {
  document.getElementById('new-product-barcode-label').textContent = `Barcode: ${barcode}`
  const nameInput = document.getElementById('input-new-product-name')
  nameInput.value = ''

  const dateInput = document.getElementById('input-new-product-date')
  if (dateInput) {
    dateInput.value = toLocalDatetimeInputString(new Date())
  }

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

  // Nutrition Accordion Toggle
  const btnNutritionToggle = document.getElementById('btn-nutrition-toggle')
  if (btnNutritionToggle) {
    btnNutritionToggle.addEventListener('click', () => {
      const drawer = document.getElementById('nutrition-drawer')
      const card = document.getElementById('card-nutrition')
      const isNowExpanded = drawer.hidden
      drawer.hidden = !isNowExpanded
      card.classList.toggle('expanded', isNowExpanded)
      btnNutritionToggle.setAttribute('aria-expanded', isNowExpanded ? 'true' : 'false')
    })
  }

  // Subtle OpenFoodFacts Refresh Button
  const btnRefreshOff = document.getElementById('btn-refresh-off')
  if (btnRefreshOff) {
    btnRefreshOff.addEventListener('click', async () => {
      const barcode = appState.selectedProductData?.product?.barcode
      if (!barcode) return

      btnRefreshOff.classList.add('loading')
      const labelEl = document.getElementById('btn-refresh-off-label')
      const originalText = labelEl ? labelEl.textContent : 'Daten von OpenFoodFacts aktualisieren'
      if (labelEl) labelEl.textContent = 'Aktualisiere...'

      try {
        const res = await api.refreshProduct(barcode)
        if (res.success) {
          appState.selectedProductData.details = res.details
          if (res.product) {
            appState.selectedProductData.product = res.product
          }
          showProductDetail(appState.selectedProductData)

          // Automatically expand drawer so the user sees the fresh data
          const drawer = document.getElementById('nutrition-drawer')
          const card = document.getElementById('card-nutrition')
          if (drawer && card && res.details) {
            drawer.hidden = false
            card.classList.add('expanded')
            btnNutritionToggle?.setAttribute('aria-expanded', 'true')
          }

          showToast('✓ Daten von OpenFoodFacts aktualisiert')
          // Also refresh list in background if image or name changed
          loadOpenItems()
        } else {
          showToast(res.error || 'Keine aktuellen Daten bei OpenFoodFacts gefunden.')
        }
      } catch (err) {
        console.error('Refresh from OpenFoodFacts failed:', err)
        showToast(err.message || 'Aktualisierung von OpenFoodFacts fehlgeschlagen.')
      } finally {
        btnRefreshOff.classList.remove('loading')
        if (labelEl) labelEl.textContent = originalText
      }
    })
  }

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
      loadOpenItems()
    } catch (err) {
      showToast(err.message || 'Fehler beim Markieren als erledigt.')
      console.error('Finish item failed:', err)
    } finally {
      btn.disabled = false
    }
  })

  // Action: Reregister Item (↻ Neu registrieren)
  document.getElementById('btn-action-reregister').addEventListener('click', async () => {
    const currentItem = appState.selectedProductData?.currentItem
    if (!currentItem) return

    const dateVal = document.getElementById('input-reregister-date')?.value
    let openedAtIso = null
    if (dateVal) {
      const parsed = new Date(dateVal)
      if (!isNaN(parsed.getTime())) {
        openedAtIso = parsed.toISOString()
      }
    }

    const btn = document.getElementById('btn-action-reregister')
    btn.disabled = true
    try {
      await api.reregisterItem(currentItem.id, openedAtIso)
      showToast('↻ Neu registriert')
      switchView('list')
      loadOpenItems()
    } catch (err) {
      showToast(err.message || 'Fehler beim Neu-Registrieren.')
      console.error('Reregister item failed:', err)
    } finally {
      btn.disabled = false
    }
  })

  // Action: Open Item (Jetzt öffnen)
  document.getElementById('btn-action-open').addEventListener('click', async () => {
    const product = appState.selectedProductData?.product
    if (!product) return

    const dateVal = document.getElementById('input-open-date')?.value
    let openedAtIso = null
    if (dateVal) {
      const parsed = new Date(dateVal)
      if (!isNaN(parsed.getTime())) {
        openedAtIso = parsed.toISOString()
      }
    }

    const btn = document.getElementById('btn-action-open')
    btn.disabled = true
    try {
      await api.openItem(product.id, openedAtIso)
      showToast('Geöffnet')
      switchView('list')
      loadOpenItems()
    } catch (err) {
      showToast(err.message || 'Fehler beim Öffnen des Produkts.')
      console.error('Open item failed:', err)
    } finally {
      btn.disabled = false
    }
  })

  // Click on Status Card toggles date picker drawer (when item is open)
  const statusBox = document.getElementById('detail-status-box')
  statusBox.addEventListener('click', (e) => {
    // Prevent toggle if clicking directly on the input or its label
    if (e.target.closest('#input-edit-current-date') || e.target.closest('label')) return

    const currentItem = appState.selectedProductData?.currentItem
    if (!currentItem) return

    const drawer = document.getElementById('box-edit-date')
    const isNowExpanded = drawer.hidden
    drawer.hidden = !isNowExpanded
    statusBox.classList.toggle('expanded', isNowExpanded)

    if (isNowExpanded) {
      const editInput = document.getElementById('input-edit-current-date')
      if (editInput && currentItem.opened_at) {
        editInput.value = toLocalDatetimeInputString(new Date(currentItem.opened_at))
      }
    }
  })

  // Auto-save date when user picks a date in input-edit-current-date
  const editCurrentDateInput = document.getElementById('input-edit-current-date')
  editCurrentDateInput.addEventListener('click', (e) => e.stopPropagation())
  editCurrentDateInput.addEventListener('change', async (e) => {
    const currentItem = appState.selectedProductData?.currentItem
    if (!currentItem) return

    const dateVal = e.target.value
    if (!dateVal) return

    const parsed = new Date(dateVal)
    if (isNaN(parsed.getTime())) {
      showToast('Bitte ein gültiges Datum wählen.')
      return
    }

    try {
      const res = await api.updateItem(currentItem.id, { opened_at: parsed.toISOString() })
      currentItem.opened_at = res.item.opened_at

      // Update UI texts & badge
      const formatted = formatOpenedDate(currentItem.opened_at)
      document.getElementById('detail-age-badge').textContent = formatted.badge
      document.getElementById('detail-time-text').textContent = formatted.fullText

      showToast('✓ Datum aktualisiert')
      loadOpenItems()
    } catch (err) {
      showToast(err.message || 'Fehler beim Speichern des Datums.')
      console.error('Update item date failed:', err)
    }
  })

  // New Product Form Submit
  document.getElementById('form-new-product').addEventListener('submit', async (e) => {
    e.preventDefault()
    const barcode = appState.pendingBarcode
    const name = document.getElementById('input-new-product-name').value.trim()
    if (!barcode || !name) return

    const dateVal = document.getElementById('input-new-product-date')?.value
    let openedAtIso = null
    if (dateVal) {
      const parsed = new Date(dateVal)
      if (!isNaN(parsed.getTime())) {
        openedAtIso = parsed.toISOString()
      }
    }

    const submitBtn = document.getElementById('btn-save-and-open')
    submitBtn.disabled = true
    try {
      // 1. Create product
      const productRes = await api.createProduct(barcode, name)
      const product = productRes.product

      // 2. Open item directly with custom opened_at
      await api.openItem(product.id, openedAtIso)

      showToast(`"${product.name}" gespeichert und geöffnet`)
      switchView('list')
      loadOpenItems()
    } catch (err) {
      showToast(err.message || 'Fehler beim Speichern des Produkts.')
      console.error('Save and open failed:', err)
    } finally {
      submitBtn.disabled = false
    }
  })

  // Settings Open Button
  document.getElementById('btn-settings-open').addEventListener('click', () => {
    setFormError('settings-error-box', '')
    document.getElementById('input-server-url').value = api.baseUrl
    document.getElementById('input-auth-token').value = api.token
    themeManager.updateUI(themeManager.currentTheme)
    switchView('settings')
  })

  // Theme selector buttons
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme
      if (theme) {
        themeManager.setTheme(theme)
      }
    })
  })

  // Settings Back Button
  document.getElementById('btn-settings-back').addEventListener('click', () => {
    switchView('list')
  })

  // Clear errors on typing
  document.getElementById('setup-server-url').addEventListener('input', () => setFormError('onboarding-error-box', ''))
  document.getElementById('setup-auth-token').addEventListener('input', () => setFormError('onboarding-error-box', ''))
  document.getElementById('input-server-url').addEventListener('input', () => setFormError('settings-error-box', ''))
  document.getElementById('input-auth-token').addEventListener('input', () => setFormError('settings-error-box', ''))

  // Settings Form Submit
  document.getElementById('form-settings').addEventListener('submit', async (e) => {
    e.preventDefault()
    setFormError('settings-error-box', '')
    const url = document.getElementById('input-server-url').value.trim()
    const token = document.getElementById('input-auth-token').value.trim()
    const submitBtn = e.target.querySelector('button[type="submit"]')
    if (submitBtn) {
      submitBtn.disabled = true
      submitBtn.textContent = 'Verbinde...'
    }

    try {
      api.init(url, token)

      // Step 1: Health / Diagnostic check
      try {
        const health = await api.getHealth()
        if (health) {
          if (!health.auth?.configured) {
            throw new Error('AUTH_TOKEN Secret fehlt auf dem Server! Bitte im Cloudflare Dashboard unter Settings -> Variables and Secrets als Secret eintragen.')
          }
          if (health.database?.status !== 'ok') {
            throw new Error(`Datenbank-Fehler (${health.database?.error || health.database?.status}). Wurde die D1-Migration auf der Remote-Datenbank ausgeführt?`)
          }
        }
      } catch (healthErr) {
        if (healthErr.message && (healthErr.message.includes('AUTH_TOKEN') || healthErr.message.includes('Datenbank'))) {
          throw healthErr
        }
        console.warn('Health check unreachable:', healthErr)
      }

      // Step 2: Test credentials with items call
      await api.getItems()

      localStorage.setItem('nomnom_url', url)
      localStorage.setItem('nomnom_token', token)

      showToast('Einstellungen gespeichert')
      switchView('list')
      loadOpenItems()
    } catch (err) {
      console.error('Settings test failed:', err)
      const errorMsg = err.message || 'Verbindungstest fehlgeschlagen.'
      setFormError('settings-error-box', errorMsg)
      showToast('Fehler bei Verbindung')
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false
        submitBtn.textContent = 'Einstellungen speichern'
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
    setFormError('onboarding-error-box', '')
    const url = document.getElementById('setup-server-url').value.trim()
    const token = document.getElementById('setup-auth-token').value.trim()
    const submitBtn = document.getElementById('btn-onboarding-submit')

    submitBtn.disabled = true
    submitBtn.textContent = 'Verbinde...'

    try {
      api.init(url, token)

      // Step 1: Diagnostic health check
      try {
        const health = await api.getHealth()
        if (health) {
          if (!health.auth?.configured) {
            throw new Error('AUTH_TOKEN Secret fehlt auf dem Server! Bitte im Cloudflare Dashboard unter Settings -> Variables and Secrets als Secret eintragen.')
          }
          if (health.database?.status !== 'ok') {
            throw new Error(`Datenbank-Fehler (${health.database?.error || health.database?.status}). Wurde die D1-Migration auf der Remote-Datenbank ausgeführt?`)
          }
        }
      } catch (healthErr) {
        if (healthErr.message && (healthErr.message.includes('AUTH_TOKEN') || healthErr.message.includes('Datenbank'))) {
          throw healthErr
        }
        console.warn('Health check unreachable:', healthErr)
      }

      // Step 2: Authenticated request
      await api.getItems()

      localStorage.setItem('nomnom_url', url)
      localStorage.setItem('nomnom_token', token)

      modalOnboarding.hidden = true
      showToast('Erfolgreich verbunden!')
      switchView('list')
      loadOpenItems()
    } catch (err) {
      console.error('Onboarding connection failed:', err)
      const errorMsg = err.message || 'Server nicht erreichbar.'
      setFormError('onboarding-error-box', errorMsg)
      showToast('Verbindung fehlgeschlagen')
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
  themeManager.init()
  setupEventListeners()
  registerServiceWorker()

  if (checkAuth()) {
    switchView('list')
    loadOpenItems()
  }
}

// Run on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp)
} else {
  initApp()
}

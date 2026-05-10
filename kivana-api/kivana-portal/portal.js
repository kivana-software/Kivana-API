const els = {
  viewAuth: document.getElementById('viewAuth'),
  viewDashboard: document.getElementById('viewDashboard'),
  viewAccount: document.getElementById('viewAccount'),
  viewAdmin: document.getElementById('viewAdmin'),
  navUser: document.getElementById('navUser'),
  navUserAvatar: document.getElementById('navUserAvatar'),
  navUserName: document.getElementById('navUserName'),
  navUserPlan: document.getElementById('navUserPlan'),
  btnSignOut: document.getElementById('btnSignOut'),
  btnNavPlans: document.getElementById('btnNavPlans'),
  btnNavAccount: document.getElementById('btnNavAccount'),
  btnNavAdmin: document.getElementById('btnNavAdmin'),
  btnSignIn: document.getElementById('btnSignIn'),
  btnSignUp: document.getElementById('btnSignUp'),
  btnMenu: document.getElementById('btnMenu'),
  mobileMenu: document.getElementById('mobileMenu'),
  btnCloseMenu: document.getElementById('btnCloseMenu'),
  menuBackdrop: document.getElementById('menuBackdrop'),
  mobileMenuPublic: document.getElementById('mobileMenuPublic'),
  mobileMenuAuthed: document.getElementById('mobileMenuAuthed'),
  mobileMenuPublicActions: document.getElementById('mobileMenuPublicActions'),
  mobileMenuAuthedActions: document.getElementById('mobileMenuAuthedActions'),
  mNavFeatures: document.getElementById('mNavFeatures'),
  mNavPricing: document.getElementById('mNavPricing'),
  mNavAccountants: document.getElementById('mNavAccountants'),
  mNavSecurity: document.getElementById('mNavSecurity'),
  mNavResources: document.getElementById('mNavResources'),
  mPlans: document.getElementById('mPlans'),
  mAccount: document.getElementById('mAccount'),
  mAdmin: document.getElementById('mAdmin'),
  mSignOut: document.getElementById('mSignOut'),
  mSignIn: document.getElementById('mSignIn'),
  mGetKivana: document.getElementById('mGetKivana'),
  navFeatures: document.getElementById('navFeatures'),
  navPricing: document.getElementById('navPricing'),
  navAccountants: document.getElementById('navAccountants'),
  navSecurity: document.getElementById('navSecurity'),
  navResources: document.getElementById('navResources'),
  osToggle: document.getElementById('osToggle'),
  osMac: document.getElementById('osMac'),
  osWin: document.getElementById('osWin'),
  mOsToggle: document.getElementById('mOsToggle'),
  mOsMac: document.getElementById('mOsMac'),
  mOsWin: document.getElementById('mOsWin'),
  btnThemeToggle: document.getElementById('btnThemeToggle'),
  mThemeToggle: document.getElementById('mThemeToggle'),
  mThemeToggleAuthed: document.getElementById('mThemeToggleAuthed'),
  marketingSections: document.getElementById('marketingSections'),
  marketingFooter: document.getElementById('marketingFooter'),
  prebetaLanding: document.getElementById('prebetaLanding'),
  btnPrebetaCreate: document.getElementById('btnPrebetaCreate'),
  btnPrebetaSignIn: document.getElementById('btnPrebetaSignIn'),
  btnPrebetaDownloadMac: document.getElementById('btnPrebetaDownloadMac'),
  btnPrebetaDownloadWin: document.getElementById('btnPrebetaDownloadWin'),
  btnMacGuide: document.getElementById('btnMacGuide'),
  btnPrebetaContact: document.getElementById('btnPrebetaContact'),
  macUnsignedNote: document.getElementById('macUnsignedNote'),
  downloadStatus: document.getElementById('downloadStatus'),
  navFullLanding: document.getElementById('navFullLanding'),
  btnDownloadPrimary: document.getElementById('btnDownloadPrimary'),
  btnDownloadSecondary: document.getElementById('btnDownloadSecondary'),
  btnHeroStartFree: document.getElementById('btnHeroStartFree'),
  btnHeroViewPlans: document.getElementById('btnHeroViewPlans'),
  btnCtaCreate: document.getElementById('btnCtaCreate'),
  btnCtaSignIn: document.getElementById('btnCtaSignIn'),
  btnCtaDownloadMac: document.getElementById('btnCtaDownloadMac'),
  btnCtaDownloadWin: document.getElementById('btnCtaDownloadWin'),
  btnCtaViewPlans: document.getElementById('btnCtaViewPlans'),
  btnFooterDownloadMac: document.getElementById('btnFooterDownloadMac'),
  btnFooterDownloadWin: document.getElementById('btnFooterDownloadWin'),
  btnFooterContact: document.getElementById('btnFooterContact'),
  btnAccountantService: document.getElementById('btnAccountantService'),
  btnBackToWebsite: document.getElementById('btnBackToWebsite'),
  footerYear: document.getElementById('footerYear'),
  wipBanner: document.getElementById('wipBanner'),

  btnAdminReload: document.getElementById('btnAdminReload'),
  adminStatus: document.getElementById('adminStatus'),
  adminUsersBody: document.getElementById('adminUsersBody'),
  adminSearch: document.getElementById('adminSearch'),
  adminTabUsers: document.getElementById('adminTabUsers'),
  adminTabAccess: document.getElementById('adminTabAccess'),
  adminTabSettings: document.getElementById('adminTabSettings'),
  adminTabUsersView: document.getElementById('adminTabUsersView'),
  adminTabAccessView: document.getElementById('adminTabAccessView'),
  adminTabSettingsView: document.getElementById('adminTabSettingsView'),
  adminSectionTitle: document.getElementById('adminSectionTitle'),
  adminSectionSub: document.getElementById('adminSectionSub'),
  adminStatUsers: document.getElementById('adminStatUsers'),
  adminStatAdmins: document.getElementById('adminStatAdmins'),
  adminStatActivePlans: document.getElementById('adminStatActivePlans'),
  adminContactBody: document.getElementById('adminContactBody'),

  macGuideModal: document.getElementById('macGuideModal'),
  btnCloseMacGuide: document.getElementById('btnCloseMacGuide'),
  macGuideBackdrop: document.getElementById('macGuideBackdrop'),
  macGuideContent: document.getElementById('macGuideContent'),

  previewModal: document.getElementById('previewModal'),
  btnClosePreviewModal: document.getElementById('btnClosePreviewModal'),
  previewModalBackdrop: document.getElementById('previewModalBackdrop'),
  previewModalTitle: document.getElementById('previewModalTitle'),
  previewModalImg: document.getElementById('previewModalImg'),

  actionModal: document.getElementById('actionModal'),
  actionModalTitle: document.getElementById('actionModalTitle'),
  actionModalBody: document.getElementById('actionModalBody'),
  actionModalOk: document.getElementById('actionModalOk'),
  actionModalCancel: document.getElementById('actionModalCancel'),
  btnCloseActionModal: document.getElementById('btnCloseActionModal'),
  actionModalBackdrop: document.getElementById('actionModalBackdrop'),

  contactModal: document.getElementById('contactModal'),
  btnCloseContactModal: document.getElementById('btnCloseContactModal'),
  contactModalBackdrop: document.getElementById('contactModalBackdrop'),
  contactForm: document.getElementById('contactForm'),
  contactName: document.getElementById('contactName'),
  contactEmail: document.getElementById('contactEmail'),
  contactSubject: document.getElementById('contactSubject'),
  contactMessage: document.getElementById('contactMessage'),
  contactStatus: document.getElementById('contactStatus'),
  btnSendContact: document.getElementById('btnSendContact'),

  authForm: document.getElementById('authForm'),
  authTitle: document.getElementById('authTitle'),
  authSubtitle: document.getElementById('authSubtitle'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  authError: document.getElementById('authError'),
  btnSubmitAuth: document.getElementById('btnSubmitAuth'),
  authToggleText: document.getElementById('authToggleText'),
  linkToggleAuth: document.getElementById('linkToggleAuth'),

  dashboardStatus: document.getElementById('dashboardStatus'),
  currentPlanBanner: document.getElementById('currentPlanBanner'),
  lblCurrentPlan: document.getElementById('lblCurrentPlan'),

  btnBillingYearly: document.getElementById('btnBillingYearly'),
  btnBillingMonthly: document.getElementById('btnBillingMonthly'),

  stdMainPrice: document.getElementById('stdMainPrice'),
  stdMainUnit: document.getElementById('stdMainUnit'),
  stdSubPrice: document.getElementById('stdSubPrice'),
  stdNote: document.getElementById('stdNote'),
  proMainPrice: document.getElementById('proMainPrice'),
  proMainUnit: document.getElementById('proMainUnit'),
  proSubPrice: document.getElementById('proSubPrice'),
  proNote: document.getElementById('proNote'),

  displayName: document.getElementById('displayName'),
  avatarFile: document.getElementById('avatarFile'),
  avatarPreview: document.getElementById('avatarPreview'),
  btnSaveProfile: document.getElementById('btnSaveProfile'),
  profileStatus: document.getElementById('profileStatus'),

  subPlanName: document.getElementById('subPlanName'),
  subPlanMeta: document.getElementById('subPlanMeta'),
  btnManagePlans: document.getElementById('btnManagePlans'),
  btnCancelSub: document.getElementById('btnCancelSub'),
  accountStatus: document.getElementById('accountStatus'),
}

let isLoginMode = true
let billingCycle = 'yearly'
let currentMe = null
let currentEntitlement = null
let pendingPlanSelection = null
const sp = new URLSearchParams(window.location.search)
const startInAuth = sp.get('portal') === '1'
const startAuthMode = String(sp.get('mode') || '').trim().toLowerCase()
const fullLanding = sp.get('full') !== '0'
let adminUsersCache = []
let adminContactCache = []
let adminActiveTab = 'users'
const BASIC_RELEASE_URL = 'https://github.com/kivana-software/Kivana/releases/tag/v0.4.16-basic'
const BASIC_MAC_URL = 'https://github.com/kivana-software/Kivana/releases/download/v0.4.16-basic/Kivana_0.4.16_aarch64.dmg'
const BASIC_WIN_URL = 'https://github.com/kivana-software/Kivana/releases/download/v0.4.16-basic/Kivana_0.4.16_x64_en-US.msi'
const MAC_GUIDE_MD_URL = 'https://raw.githubusercontent.com/kivana-software/Kivana/main/readmemac.md'
const LS_THEME = 'kivanaPortal/theme'

function isMacOs() {
  const ua = String(navigator.userAgent || '')
  const plat = String(navigator.platform || '')
  return /mac/i.test(plat) || /macintosh/i.test(ua)
}

function detectPricingCurrency() {
  const langs = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language]
  const lang = String(langs[0] || '').toUpperCase()
  const tz = (() => {
    try {
      return String(Intl.DateTimeFormat().resolvedOptions().timeZone || '')
    } catch {
      return ''
    }
  })()

  const isNorway = lang.includes('-NO') || lang.startsWith('NB') || lang.startsWith('NN') || /OSLO/i.test(tz)
  const isUk = lang.includes('-GB') || /LONDON/i.test(tz)
  if (isNorway) return { code: 'NOK', symbol: 'kr', monthlyStd: 99, monthlyPro: 299 }
  if (isUk) return { code: 'GBP', symbol: '£', monthlyStd: 9.99, monthlyPro: 29.9 }
  return { code: 'EUR', symbol: '€', monthlyStd: 9.99, monthlyPro: 29.9 }
}

const PRICING = detectPricingCurrency()

function formatAmount(v) {
  if (v == null) return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function formatMoney(amount) {
  if (PRICING.code === 'NOK') return `${PRICING.symbol} ${formatAmount(Math.round(Number(amount) || 0))}`
  return `${PRICING.symbol}${formatAmount(amount)}`
}

function getTheme() {
  try {
    const t = String(localStorage.getItem(LS_THEME) || '').trim().toLowerCase()
    return t === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', t)
  try {
    localStorage.setItem(LS_THEME, t)
  } catch {
    void 0
  }
  updateThemeButtons()
}

function updateThemeButtons() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const label = isDark ? 'Theme: Light' : 'Theme: Dark'
  if (els.btnThemeToggle) els.btnThemeToggle.textContent = label
  if (els.mThemeToggle) els.mThemeToggle.textContent = label
  if (els.mThemeToggleAuthed) els.mThemeToggleAuthed.textContent = label
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  applyTheme(isDark ? 'light' : 'dark')
}

function enforceLoggedOutLanding() {
  const path = String(window.location.pathname || '')
  if (!(path.startsWith('/account') || path.startsWith('/portal'))) return
  const params = new URLSearchParams(window.location.search)
  const wantsPortalAuth = params.get('portal') === '1'
  if (wantsPortalAuth) return
  if (getAccessToken()) return
  window.location.replace('/')
}

function openActionModal({ title, okText, cancelText, build }) {
  return new Promise((resolve) => {
    if (
      !els.actionModal ||
      !els.actionModalBody ||
      !els.actionModalTitle ||
      !els.actionModalOk ||
      !els.actionModalCancel
    ) {
      resolve(null)
      return
    }

    els.actionModalTitle.textContent = String(title || 'Action')
    els.actionModalOk.textContent = String(okText || 'OK')
    els.actionModalCancel.textContent = String(cancelText || 'Cancel')
    els.actionModalBody.innerHTML = ''

    let getValue = null
    if (typeof build === 'function') {
      getValue = build(els.actionModalBody, els.actionModalOk)
    }

    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown)
      if (els.btnCloseActionModal) els.btnCloseActionModal.onclick = null
      if (els.actionModalBackdrop) els.actionModalBackdrop.onclick = null
      els.actionModalCancel.onclick = null
      els.actionModalOk.onclick = null
    }

    const close = (value) => {
      cleanup()
      els.actionModal.classList.add('hidden')
      resolve(value)
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') close(null)
    }

    els.actionModalCancel.onclick = () => close(null)
    els.actionModalOk.onclick = () => {
      const v = typeof getValue === 'function' ? getValue() : true
      if (v === undefined) return
      close(v)
    }
    if (els.btnCloseActionModal) els.btnCloseActionModal.onclick = () => close(null)
    if (els.actionModalBackdrop) els.actionModalBackdrop.onclick = () => close(null)
    document.addEventListener('keydown', onKeyDown)

    els.actionModal.classList.remove('hidden')
    setTimeout(() => {
      const first = els.actionModalBody.querySelector('input, button, select, textarea')
      if (first && typeof first.focus === 'function') first.focus()
    }, 0)
  })
}

async function confirmAction({ title, message, okText }) {
  const res = await openActionModal({
    title,
    okText: okText || 'Confirm',
    cancelText: 'Cancel',
    build: (body) => {
      const p = document.createElement('div')
      p.className = 'modalText'
      p.textContent = String(message || '')
      body.appendChild(p)
      return () => true
    },
  })
  return !!res
}

async function promptDiscount(email) {
  return openActionModal({
    title: 'Discount',
    okText: 'Save',
    cancelText: 'Cancel',
    build: (body) => {
      const wrap = document.createElement('div')
      wrap.className = 'modalForm'

      const g1 = document.createElement('div')
      g1.className = 'input-group'
      const l1 = document.createElement('label')
      l1.textContent = `Discount percent for ${email}`
      const i1 = document.createElement('input')
      i1.type = 'number'
      i1.min = '0'
      i1.max = '90'
      i1.step = '1'
      i1.placeholder = '0'
      g1.appendChild(l1)
      g1.appendChild(i1)

      const g2 = document.createElement('div')
      g2.className = 'input-group'
      const l2 = document.createElement('label')
      l2.textContent = 'Label (optional)'
      const i2 = document.createElement('input')
      i2.type = 'text'
      i2.placeholder = 'founder'
      g2.appendChild(l2)
      g2.appendChild(i2)

      wrap.appendChild(g1)
      wrap.appendChild(g2)
      body.appendChild(wrap)

      return () => {
        const pct = Number(String(i1.value || '0').trim() || '0')
        if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
          i1.focus()
          return undefined
        }
        const label = String(i2.value || '').trim()
        return { percent: pct, label: label || null }
      }
    },
  })
}

async function promptPassword(email) {
  return openActionModal({
    title: `Reset password for ${email}`,
    okText: 'Set password',
    cancelText: 'Cancel',
    build: (body) => {
      const wrap = document.createElement('div')
      wrap.className = 'modalForm'

      const g1 = document.createElement('div')
      g1.className = 'input-group'
      const l1 = document.createElement('label')
      l1.textContent = 'New password (min 8 chars)'
      const p1 = document.createElement('input')
      p1.type = 'password'
      g1.appendChild(l1)
      g1.appendChild(p1)

      const g2 = document.createElement('div')
      g2.className = 'input-group'
      const l2 = document.createElement('label')
      l2.textContent = 'Confirm password'
      const p2 = document.createElement('input')
      p2.type = 'password'
      g2.appendChild(l2)
      g2.appendChild(p2)

      wrap.appendChild(g1)
      wrap.appendChild(g2)
      body.appendChild(wrap)

      return () => {
        const a = String(p1.value || '')
        const b = String(p2.value || '')
        if (a.length < 8) {
          p1.focus()
          return undefined
        }
        if (a !== b) {
          p2.focus()
          return undefined
        }
        return a
      }
    },
  })
}

async function promptCustomEndsAt() {
  return openActionModal({
    title: 'Custom end date',
    okText: 'Apply',
    cancelText: 'Cancel',
    build: (body) => {
      const g = document.createElement('div')
      g.className = 'input-group'
      const l = document.createElement('label')
      l.textContent = 'Ends at (date)'
      const i = document.createElement('input')
      i.type = 'date'
      g.appendChild(l)
      g.appendChild(i)
      body.appendChild(g)
      return () => {
        const s = String(i.value || '').trim()
        if (!s) return undefined
        const d = new Date(`${s}T23:59:59Z`)
        if (Number.isNaN(d.getTime())) return undefined
        return d.toISOString()
      }
    },
  })
}

function getAccessToken() {
  return localStorage.getItem('kivanaPortal/accessToken') || ''
}
function getRefreshToken() {
  return localStorage.getItem('kivanaPortal/refreshToken') || ''
}
function setTokens(access, refresh) {
  if (access) localStorage.setItem('kivanaPortal/accessToken', access)
  if (refresh) localStorage.setItem('kivanaPortal/refreshToken', refresh)
}
function clearTokens() {
  localStorage.removeItem('kivanaPortal/accessToken')
  localStorage.removeItem('kivanaPortal/refreshToken')
}

function normalizeApiBaseUrl(url) {
  const v = String(url || '').trim()
  if (!v) return ''
  return v.endsWith('/') ? v.slice(0, -1) : v
}

function computeApiBaseUrl() {
  const sp = new URLSearchParams(window.location.search)
  const qp = sp.get('api')
  if (qp) {
    const v = normalizeApiBaseUrl(qp)
    if (v) {
      try {
        localStorage.setItem('kivanaPortal/apiBase', v)
      } catch {
        void 0
      }
      return v
    }
  }
  const saved = normalizeApiBaseUrl(localStorage.getItem('kivanaPortal/apiBase') || '')
  if (saved) return saved
  return window.location.origin
}

const apiBaseUrl = computeApiBaseUrl()
const apiUrl = (path) => `${apiBaseUrl}${path}`

function isAuthed() {
  return !!getAccessToken()
}

async function apiFetch(path, init = {}) {
  const access = getAccessToken()
  const headers = new Headers(init.headers || {})
  headers.set('content-type', 'application/json')
  if (access) headers.set('authorization', `Bearer ${access}`)
  const res = await fetch(apiUrl(path), { ...init, headers })
  if (res.ok) return res

  if (res.status === 401 && getRefreshToken()) {
    try {
      await refreshAccessToken()
      const retryHeaders = new Headers(init.headers || {})
      retryHeaders.set('content-type', 'application/json')
      const nextAccess = getAccessToken()
      if (nextAccess) retryHeaders.set('authorization', `Bearer ${nextAccess}`)
      const retry = await fetch(apiUrl(path), { ...init, headers: retryHeaders })
      if (retry.ok) return retry
    } catch {
      void 0
    }
  }

  let err = `HTTP ${res.status}`
  if (res.status === 501) {
    err = `Portal is running without the API. Open the portal from the API server (for example http://localhost:8080/portal/) or add ?api=http://localhost:8080 to this page URL.`
    throw new Error(err)
  }
  try {
    const j = await res.json()
    if (j && j.error) err = String(j.error)
  } catch {
    void 0
  }
  throw new Error(err)
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return
  const res = await apiFetch('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) })
  const json = await res.json()
  setTokens(json.accessToken, json.refreshToken)
}

async function startPrebetaDownload(platformKey) {
  if (els.downloadStatus) els.downloadStatus.textContent = 'Opening download…'
  const url = String(platformKey || '').startsWith('darwin') ? BASIC_MAC_URL : BASIC_WIN_URL
  try {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (els.downloadStatus) els.downloadStatus.textContent = 'Download opened.'
    return
  } catch {
    void 0
  }
  try {
    window.location.assign(url)
    if (els.downloadStatus) els.downloadStatus.textContent = 'Download started.'
  } catch {
    window.open(BASIC_RELEASE_URL, '_blank', 'noopener')
    if (els.downloadStatus) els.downloadStatus.textContent = 'Could not start the download. Opened release page.'
  }
}

function openMacGuide() {
  if (!els.macGuideModal || !els.macGuideContent) {
    window.open('https://github.com/kivana-software/Kivana/blob/main/readmemac.md', '_blank', 'noopener')
    return
  }
  els.macGuideModal.classList.remove('hidden')
  els.macGuideContent.textContent = 'Loading…'
  fetch(MAC_GUIDE_MD_URL, { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((txt) => {
      els.macGuideContent.textContent = String(txt || '').trim() || 'Empty.'
    })
    .catch(() => {
      els.macGuideContent.textContent = 'Failed to load. Please use the GitHub link.'
    })
}

function closeMacGuide() {
  if (!els.macGuideModal) return
  els.macGuideModal.classList.add('hidden')
}

function openPreviewModal({ src, title }) {
  if (!els.previewModal || !els.previewModalImg || !els.previewModalTitle) return
  els.previewModalTitle.textContent = String(title || 'Preview')
  els.previewModalImg.src = String(src || '')
  els.previewModalImg.alt = String(title || 'Screenshot')
  els.previewModal.classList.remove('hidden')
}

function closePreviewModal() {
  if (!els.previewModal) return
  els.previewModal.classList.add('hidden')
  if (els.previewModalImg) els.previewModalImg.src = ''
}

function openContactModal() {
  if (!els.contactModal) return
  if (els.contactStatus) els.contactStatus.textContent = ''
  if (els.btnSendContact) els.btnSendContact.disabled = false
  if (els.contactForm) els.contactForm.reset()
  if (els.contactEmail && currentMe && currentMe.email) els.contactEmail.value = String(currentMe.email || '')
  if (els.contactName && currentMe && currentMe.displayName) els.contactName.value = String(currentMe.displayName || '')
  els.contactModal.classList.remove('hidden')
}

function closeContactModal() {
  if (!els.contactModal) return
  els.contactModal.classList.add('hidden')
}

async function handleContactSubmit(e) {
  e.preventDefault()
  if (!els.contactStatus) return
  if (!els.contactName || !els.contactEmail || !els.contactMessage) return

  const name = String(els.contactName.value || '').trim()
  const email = String(els.contactEmail.value || '').trim()
  const subject = els.contactSubject ? String(els.contactSubject.value || '').trim() : ''
  const message = String(els.contactMessage.value || '').trim()

  els.contactStatus.textContent = 'Sending…'
  if (els.btnSendContact) els.btnSendContact.disabled = true

  try {
    const payload = {
      name,
      email,
      subject: subject || undefined,
      message,
    }
    const res = await apiFetch('/v1/contact', { method: 'POST', body: JSON.stringify(payload) })
    await res.json().catch(() => void 0)
    els.contactStatus.textContent = 'Sent. Thanks — I’ll reply to your email.'
    setTimeout(() => closeContactModal(), 900)
  } catch (err) {
    els.contactStatus.textContent = String(err && err.message ? err.message : err || 'Failed to send.')
  } finally {
    if (els.btnSendContact) els.btnSendContact.disabled = false
  }
}

function profileKey(userId) {
  return `kivanaPortal/profile/${userId}`
}

function loadProfileLocal(userId) {
  try {
    const raw = localStorage.getItem(profileKey(userId))
    if (!raw) return { displayName: '', avatarDataUrl: '' }
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object') return { displayName: '', avatarDataUrl: '' }
    return {
      displayName: String(v.displayName || '').trim(),
      avatarDataUrl: String(v.avatarDataUrl || '').trim(),
    }
  } catch {
    return { displayName: '', avatarDataUrl: '' }
  }
}

function saveProfileLocal(userId, patch) {
  const cur = loadProfileLocal(userId)
  const next = {
    displayName: patch.displayName != null ? String(patch.displayName || '').trim() : cur.displayName,
    avatarDataUrl: patch.avatarDataUrl != null ? String(patch.avatarDataUrl || '').trim() : cur.avatarDataUrl,
  }
  try {
    localStorage.setItem(profileKey(userId), JSON.stringify(next))
  } catch {
    void 0
  }
  return next
}

function loadProfileMerged(me) {
  if (!me || !me.id) return { displayName: '', avatarDataUrl: '' }
  const local = loadProfileLocal(me.id)
  const displayName = me.displayName != null ? String(me.displayName || '').trim() : local.displayName
  const avatarDataUrl = me.avatarDataUrl != null ? String(me.avatarDataUrl || '').trim() : local.avatarDataUrl
  return { displayName, avatarDataUrl }
}

async function updateProfileOnServer(patch) {
  await apiFetch('/v1/profile', { method: 'POST', body: JSON.stringify(patch) })
}

function avatarPlaceholderDataUrl(text) {
  const safe = encodeURIComponent(String(text || '').slice(0, 2).toUpperCase())
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="92" height="92"><rect width="92" height="92" fill="#E5E7EB"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Inter, system-ui" font-size="28" font-weight="700" fill="#111827">${safe}</text></svg>`
  return `data:image/svg+xml;utf8,${svg}`
}

function showOnly(view) {
  els.viewAuth.classList.toggle('hidden', view !== 'auth')
  els.viewDashboard.classList.toggle('hidden', view !== 'dashboard')
  els.viewAccount.classList.toggle('hidden', view !== 'account')
  if (els.viewAdmin) els.viewAdmin.classList.toggle('hidden', view !== 'admin')
  applyNav()
}

function openMenu() {
  if (!els.mobileMenu) return
  els.mobileMenu.classList.remove('hidden')
  if (els.btnMenu) els.btnMenu.setAttribute('aria-expanded', 'true')
  applyNav()
}

function closeMenu() {
  if (!els.mobileMenu) return
  els.mobileMenu.classList.add('hidden')
  if (els.btnMenu) els.btnMenu.setAttribute('aria-expanded', 'false')
}

function applyNav() {
  const authed = isAuthed()
  const isAdmin = !!(authed && currentMe && currentMe.isAdmin)
  if (els.btnSignIn) els.btnSignIn.classList.toggle('hidden', authed)
  if (els.btnSignUp) els.btnSignUp.classList.toggle('hidden', authed)
  const showMarketing = fullLanding && !authed
  if (els.navFeatures) els.navFeatures.classList.toggle('hidden', !showMarketing)
  if (els.navPricing) els.navPricing.classList.toggle('hidden', !showMarketing)
  if (els.navAccountants) els.navAccountants.classList.toggle('hidden', !showMarketing)
  if (els.navSecurity) els.navSecurity.classList.toggle('hidden', !showMarketing)
  if (els.navResources) els.navResources.classList.toggle('hidden', !showMarketing)
  if (els.osToggle) els.osToggle.classList.toggle('hidden', !showMarketing)
  if (els.marketingSections) els.marketingSections.classList.toggle('hidden', !showMarketing)
  if (els.marketingFooter) els.marketingFooter.classList.toggle('hidden', !showMarketing)
  if (els.navFullLanding) els.navFullLanding.classList.toggle('hidden', !showMarketing)
  if (els.prebetaLanding) els.prebetaLanding.classList.toggle('hidden', authed || showMarketing)
  document.querySelectorAll('[data-authed-only="1"]').forEach((el) => el.classList.toggle('hidden', !authed))
  if (els.navUser) els.navUser.classList.toggle('hidden', !authed)
  els.btnSignOut.classList.toggle('hidden', !authed)
  els.btnNavPlans.classList.toggle('hidden', !authed)
  els.btnNavAccount.classList.toggle('hidden', !authed)
  if (els.btnNavAdmin) els.btnNavAdmin.classList.toggle('hidden', !isAdmin)

  if (els.mobileMenuPublic) els.mobileMenuPublic.classList.toggle('hidden', authed)
  if (els.mobileMenuPublicActions) els.mobileMenuPublicActions.classList.toggle('hidden', authed)
  if (els.mobileMenuAuthed) els.mobileMenuAuthed.classList.toggle('hidden', !authed)
  if (els.mobileMenuAuthedActions) els.mobileMenuAuthedActions.classList.toggle('hidden', !authed)
  if (els.mAdmin) els.mAdmin.classList.toggle('hidden', !isAdmin)
}

function normalizePlanLabel(entitlement) {
  if (!entitlement) return 'No plan'
  const status = String(entitlement.status || '').trim().toLowerCase()
  const planCode = String(entitlement.planCode || '').trim().toLowerCase()
  const planName = String(entitlement.planName || '').trim()
  if (planCode === 'basic') return 'Trial'
  if (planName) return planName
  if (planCode) return planCode
  return status === 'active' ? 'Active' : 'No plan'
}

function computeUserLabel(me, profile) {
  const displayName = profile && profile.displayName ? String(profile.displayName || '').trim() : ''
  if (displayName) return displayName
  const email = me && me.email ? String(me.email || '').trim() : ''
  if (!email) return ''
  const at = email.indexOf('@')
  if (at > 0) return email.slice(0, at)
  return email
}

function applyNavIdentity() {
  if (!els.navUserName || !els.navUserPlan) return

  if (!currentMe) {
    els.navUserName.textContent = ''
    els.navUserPlan.textContent = ''
    if (els.navUserAvatar) {
      els.navUserAvatar.classList.add('hidden')
      els.navUserAvatar.removeAttribute('src')
    }
    return
  }

  const prof = loadProfileMerged(currentMe)
  els.navUserName.textContent = computeUserLabel(currentMe, prof)
  els.navUserPlan.textContent = normalizePlanLabel(currentEntitlement)

  if (els.navUserAvatar) {
    const avatarDataUrl = prof && prof.avatarDataUrl ? String(prof.avatarDataUrl || '').trim() : ''
    if (avatarDataUrl) {
      els.navUserAvatar.src = avatarDataUrl
      els.navUserAvatar.classList.remove('hidden')
    } else {
      els.navUserAvatar.classList.add('hidden')
      els.navUserAvatar.removeAttribute('src')
    }
  }
}

function toggleAuthMode(e) {
  e.preventDefault()
  isLoginMode = !isLoginMode
  els.authError.textContent = ''
  if (isLoginMode) {
    els.authTitle.textContent = 'Sign in to Kivana'
    els.authSubtitle.textContent = 'Manage your Personal Finance app subscription.'
    els.btnSubmitAuth.textContent = 'Sign in'
    els.authToggleText.textContent = "Don't have an account?"
    els.linkToggleAuth.textContent = 'Create one'
  } else {
    els.authTitle.textContent = 'Create an account'
    els.authSubtitle.textContent = 'Create an account, then choose a trial or plan.'
    els.btnSubmitAuth.textContent = 'Sign up'
    els.authToggleText.textContent = 'Already have an account?'
    els.linkToggleAuth.textContent = 'Sign in'
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault()
  els.authError.textContent = ''
  const email = els.email.value.trim()
  const password = els.password.value

  if (!email || !password) {
    els.authError.textContent = 'Email and password are required.'
    return
  }

  if (!isLoginMode && password.length < 8) {
    els.authError.textContent = 'Password must be at least 8 characters.'
    return
  }

  els.btnSubmitAuth.disabled = true
  els.btnSubmitAuth.textContent = 'Please wait...'

  try {
    const endpoint = isLoginMode ? '/v1/auth/login' : '/v1/auth/signup'
    const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ email, password }) })
    const json = await res.json()
    setTokens(json.accessToken, json.refreshToken)
    await showDashboard()
    if (pendingPlanSelection) {
      const payload = pendingPlanSelection
      pendingPlanSelection = null
      await handleSelectPlan(payload, els.dashboardStatus)
    }
  } catch (err) {
    const code = err && err.message ? String(err.message) : ''
    const friendly = code === 'admin_ip_locked'
      ? 'Admin login is locked to the first login IP. Try from the same network/IP.'
      : code === 'admin_ip_required'
        ? 'Admin login requires a visible IP address. Try again from the main website (not a cached file) or disable privacy proxy/VPN.'
        : code === 'too_many_requests'
          ? 'Too many attempts. Please wait a moment and try again.'
          : ''
    els.authError.textContent = friendly || (code || 'Failed to sign in.')
  } finally {
    els.btnSubmitAuth.disabled = false
    els.btnSubmitAuth.textContent = isLoginMode ? 'Sign in' : 'Sign up'
  }
}

async function loadMe() {
  const res = await apiFetch('/v1/me', { method: 'GET' })
  return await res.json()
}

async function loadEntitlement() {
  const res = await apiFetch('/v1/entitlements', { method: 'GET' })
  const json = await res.json()
  const products = Array.isArray(json.products) ? json.products : []
  return products.find((p) => p && p.productCode === 'kivana') || null
}

function setBusy(isBusy) {
  document.querySelectorAll('[data-plan], .billingToggleBtn').forEach((b) => {
    b.disabled = !!isBusy
  })
  if (els.btnManagePlans) els.btnManagePlans.disabled = !!isBusy
  if (els.btnCancelSub) els.btnCancelSub.disabled = !!isBusy
  if (els.btnSaveProfile) els.btnSaveProfile.disabled = !!isBusy
}

function resetPlanButtonLabels() {
  const btnBasic = document.getElementById('btnPlanBasic')
  const btnStd = document.getElementById('btnPlanStandard')
  const btnPro = document.getElementById('btnPlanPro')
  const btnLifetime = document.getElementById('btnPlanLifetime')
  if (btnBasic) btnBasic.textContent = 'Start 14-day trial'
  if (btnLifetime) btnLifetime.textContent = 'Get Lifetime'
  updatePricingUI()
  if (btnStd && btnStd.textContent === 'Current plan') btnStd.textContent = billingCycle === 'yearly' ? 'Get Ordinary (Yearly)' : 'Get Ordinary (Monthly)'
  if (btnPro && btnPro.textContent === 'Current plan') btnPro.textContent = billingCycle === 'yearly' ? 'Get Pro (Yearly)' : 'Get Pro (Monthly)'
}

function applyCurrentPlanUI() {
  const planCode = currentEntitlement ? String(currentEntitlement.planCode || '').trim().toLowerCase() : ''
  const planName = currentEntitlement ? String(currentEntitlement.planName || '').trim() : ''
  const status = currentEntitlement ? String(currentEntitlement.status || '').trim() : ''
  const endsAt = currentEntitlement ? currentEntitlement.endsAt : null

  if (planName && status === 'active') {
    els.currentPlanBanner.classList.remove('hidden')
    els.lblCurrentPlan.textContent = planName
  } else {
    els.currentPlanBanner.classList.add('hidden')
  }

  document.querySelectorAll('.planRow').forEach((c) => c.classList.remove('is-current'))
  document.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.disabled = false
  })

  resetPlanButtonLabels()

  if (planCode) {
    const activeBtn = document.querySelector(`[data-plan="${planCode}"]`)
    if (activeBtn) {
      activeBtn.disabled = true
      activeBtn.textContent = 'Current plan'
      const row = activeBtn.closest('.planRow')
      if (row) row.classList.add('is-current')
    }
  }

  if (els.subPlanName) els.subPlanName.textContent = planName || (planCode ? planCode : 'No active plan')
  if (els.subPlanMeta) {
    const parts = []
    if (status) parts.push(status)
    if (endsAt) parts.push(`Ends: ${endsAt}`)
    const founder = !!(currentMe && currentMe.isFounder)
    const pct = currentMe && currentMe.discountPercent != null ? Number(currentMe.discountPercent) : 0
    if (founder) parts.push('Founder discount: 50%')
    else if (pct > 0) parts.push(`Discount: ${pct}%`)
    els.subPlanMeta.textContent = parts.length ? parts.join(' • ') : (planCode ? 'Active' : 'Choose a plan to continue.')
  }
  const isBasic = !planCode || planCode === 'basic'
  if (els.btnCancelSub) els.btnCancelSub.classList.toggle('hidden', isBasic)
}

function setBillingCycle(next) {
  const v = String(next || '').trim().toLowerCase()
  if (v !== 'yearly' && v !== 'monthly') return
  billingCycle = v
  els.btnBillingYearly.classList.toggle('active', billingCycle === 'yearly')
  els.btnBillingMonthly.classList.toggle('active', billingCycle === 'monthly')
  applyCurrentPlanUI()
}

function updatePricingUI() {
  const stdBtn = document.getElementById('btnPlanStandard')
  const proBtn = document.getElementById('btnPlanPro')
  const monthlyStd = Number(PRICING.monthlyStd)
  const monthlyPro = Number(PRICING.monthlyPro)
  const yearlyStd = PRICING.code === 'NOK' ? monthlyStd * 11 : Number((monthlyStd * 11).toFixed(2))
  const yearlyPro = PRICING.code === 'NOK' ? monthlyPro * 11 : Number((monthlyPro * 11).toFixed(2))

  if (billingCycle === 'yearly') {
    els.stdMainPrice.textContent = formatMoney(yearlyStd)
    els.stdMainUnit.textContent = '/yr'
    els.stdSubPrice.textContent = `${formatMoney(monthlyStd)}/mo`
    els.stdNote.textContent = `Save 1 month with annual billing. ${formatMoney(yearlyStd)} / year (1 month free).`
    els.proMainPrice.textContent = formatMoney(yearlyPro)
    els.proMainUnit.textContent = '/yr'
    els.proSubPrice.textContent = `${formatMoney(monthlyPro)}/mo`
    els.proNote.textContent = `Save 1 month with annual billing. ${formatMoney(yearlyPro)} / year (1 month free).`
    if (stdBtn && !stdBtn.disabled) stdBtn.textContent = 'Get Ordinary (Yearly)'
    if (proBtn && !proBtn.disabled) proBtn.textContent = 'Get Pro (Yearly)'
  } else {
    els.stdMainPrice.textContent = formatMoney(monthlyStd)
    els.stdMainUnit.textContent = '/mo'
    els.stdSubPrice.textContent = `${formatMoney(yearlyStd)}/yr`
    els.stdNote.textContent = `Annual billing saves 1 month. ${formatMoney(yearlyStd)} / year (1 month free).`
    els.proMainPrice.textContent = formatMoney(monthlyPro)
    els.proMainUnit.textContent = '/mo'
    els.proSubPrice.textContent = `${formatMoney(yearlyPro)}/yr`
    els.proNote.textContent = `Annual billing saves 1 month. ${formatMoney(yearlyPro)} / year (1 month free).`
    if (stdBtn && !stdBtn.disabled) stdBtn.textContent = 'Get Ordinary (Monthly)'
    if (proBtn && !proBtn.disabled) proBtn.textContent = 'Get Pro (Monthly)'
  }
}

async function syncSessionData() {
  currentMe = await loadMe()
  currentEntitlement = await loadEntitlement()
  applyCurrentPlanUI()
  applyNavIdentity()
}

function fillAccountProfile() {
  if (!currentMe) return
  const prof = loadProfileMerged(currentMe)
  if (els.displayName) els.displayName.value = prof.displayName || ''
  const initialSource = prof.displayName || currentMe.email || ''
  if (els.avatarPreview) els.avatarPreview.src = prof.avatarDataUrl || avatarPlaceholderDataUrl(initialSource)
}

async function showDashboard() {
  showOnly('dashboard')
  els.dashboardStatus.textContent = ''
  if (isAuthed()) {
    try {
      await syncSessionData()
      if (!currentEntitlement) {
        showMarketingStatus('Choose your plan: start a 14-day trial or buy a plan.')
      }
      return
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
      clearTokens()
    }
  }
  currentMe = null
  currentEntitlement = null
  els.currentPlanBanner.classList.add('hidden')
  applyCurrentPlanUI()
  applyNav()
}

async function showAccount() {
  if (!isAuthed()) {
    pendingPlanSelection = null
    setAuthMode(true)
    await showAuth()
    return
  }
  showOnly('account')
  els.accountStatus.textContent = ''
  els.profileStatus.textContent = ''
  try {
    await syncSessionData()
    fillAccountProfile()
  } catch (err) {
    console.error('Failed to load account data:', err)
  }
}

async function showAuth() {
  showOnly('auth')
  currentMe = null
  currentEntitlement = null
}

function fmtDateTime(v) {
  return String(v || '').replace('T', ' ').replace('Z', '')
}

async function computeEndsAt(durationCode) {
  const now = new Date()
  if (durationCode === 'lifetime') return null
  if (durationCode === 'month') {
    const d = new Date(now.getTime())
    d.setMonth(d.getMonth() + 1)
    return d.toISOString()
  }
  if (durationCode === 'year') {
    const d = new Date(now.getTime())
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString()
  }
  if (durationCode === 'custom') {
    const iso = await promptCustomEndsAt()
    if (!iso) return undefined
    return iso
  }
  return null
}

async function loadAdminUsers() {
  const res = await apiFetch('/v1/admin/users', { method: 'GET' })
  const json = await res.json()
  return Array.isArray(json.users) ? json.users : []
}

async function loadAdminContactMessages() {
  const res = await apiFetch('/v1/admin/contact-messages', { method: 'GET' })
  const json = await res.json()
  return Array.isArray(json.messages) ? json.messages : []
}

function setAdminTab(tab) {
  const next = tab === 'access' ? 'access' : tab === 'settings' ? 'settings' : 'users'
  adminActiveTab = next
  if (els.adminTabUsers) els.adminTabUsers.classList.toggle('active', next === 'users')
  if (els.adminTabAccess) els.adminTabAccess.classList.toggle('active', next === 'access')
  if (els.adminTabSettings) els.adminTabSettings.classList.toggle('active', next === 'settings')
  if (els.adminTabUsersView) els.adminTabUsersView.classList.toggle('hidden', next !== 'users')
  if (els.adminTabAccessView) els.adminTabAccessView.classList.toggle('hidden', next !== 'access')
  if (els.adminTabSettingsView) els.adminTabSettingsView.classList.toggle('hidden', next !== 'settings')
  if (els.adminSectionTitle) els.adminSectionTitle.textContent = next === 'users' ? 'Users' : next === 'access' ? 'Messages' : 'Settings'
  if (els.adminSectionSub) {
    els.adminSectionSub.textContent =
      next === 'users'
        ? 'Manage accounts and plans.'
        : next === 'access'
          ? 'Inbox from the contact form.'
          : 'Service configuration and maintenance.'
  }
}

function updateAdminStats(allUsers) {
  const list = Array.isArray(allUsers) ? allUsers : []
  const total = list.length
  const admins = list.filter((u) => !!u?.isAdmin).length
  const activePlans = list.filter((u) => {
    const code = String(u?.kivanaPlanCode || '').trim().toLowerCase()
    if (!code) return false
    if (code === 'basic') return false
    const ends = u?.kivanaEndsAt ? new Date(u.kivanaEndsAt) : null
    if (!ends) return true
    return !Number.isNaN(ends.getTime()) && ends.getTime() > Date.now()
  }).length
  if (els.adminStatUsers) els.adminStatUsers.textContent = String(total)
  if (els.adminStatAdmins) els.adminStatAdmins.textContent = String(admins)
  if (els.adminStatActivePlans) els.adminStatActivePlans.textContent = String(activePlans)
}

async function renderAdminUsers() {
  if (!els.adminUsersBody || !els.adminStatus) return
  try {
    if (!adminUsersCache.length) {
      els.adminStatus.textContent = 'Loading…'
      adminUsersCache = await loadAdminUsers()
    }
    updateAdminStats(adminUsersCache)

    const q = String(els.adminSearch?.value || '').trim().toLowerCase()
    const users = q
      ? adminUsersCache.filter((u) => String(u?.email || '').toLowerCase().includes(q))
      : adminUsersCache

    els.adminUsersBody.innerHTML = ''
    for (const u of users) {
      const tr = document.createElement('tr')

      const emailTd = document.createElement('td')
      emailTd.textContent = u.email || ''
      tr.appendChild(emailTd)

      const createdTd = document.createElement('td')
      createdTd.textContent = fmtDateTime(u.createdAt || '')
      tr.appendChild(createdTd)

      const ipTd = document.createElement('td')
      ipTd.textContent = u.lastIp || 'Unknown'
      tr.appendChild(ipTd)

      const adminTd = document.createElement('td')
      adminTd.textContent = u.isAdmin ? 'Admin' : (u.isModerator ? 'Moderator' : 'User')
      tr.appendChild(adminTd)

      const planTd = document.createElement('td')
      planTd.textContent = u.kivanaPlanName ? `kivana / ${u.kivanaPlanName}` : ''
      tr.appendChild(planTd)

      const endsTd = document.createElement('td')
      endsTd.textContent = u.kivanaEndsAt ? fmtDateTime(u.kivanaEndsAt) : ''
      tr.appendChild(endsTd)

      const setTd = document.createElement('td')
      const sel = document.createElement('select')
      sel.className = 'select'
      const plans = [
        { code: 'basic', name: 'Basic (Trial)' },
        { code: 'standard', name: 'Ordinary' },
        { code: 'pro', name: 'Pro' },
        { code: 'lifetime_pro', name: 'Lifetime (Pro)' },
      ]
      for (const p of plans) {
        const opt = document.createElement('option')
        opt.value = p.code
        opt.textContent = p.name
        sel.appendChild(opt)
      }
      sel.value = u.kivanaPlanCode || 'basic'

      const durationSel = document.createElement('select')
      durationSel.className = 'select'
      const durations = [
        { code: 'month', name: '1 month' },
        { code: 'year', name: '1 year' },
        { code: 'lifetime', name: 'No expiry' },
        { code: 'custom', name: 'Custom…' },
      ]
      for (const d of durations) {
        const opt = document.createElement('option')
        opt.value = d.code
        opt.textContent = d.name
        durationSel.appendChild(opt)
      }
      durationSel.value = 'lifetime'

      const applyBtn = document.createElement('button')
      applyBtn.className = 'btn btn-secondary'
      applyBtn.textContent = 'Apply'
      applyBtn.addEventListener('click', async () => {
        els.adminStatus.textContent = 'Applying…'
        applyBtn.disabled = true
        try {
          const endsAt = await computeEndsAt(String(durationSel.value || 'lifetime'))
          if (endsAt === undefined) {
            els.adminStatus.textContent = 'Cancelled.'
            return
          }
          await apiFetch('/v1/admin/grant', {
            method: 'POST',
            body: JSON.stringify({
              email: u.email,
              productCode: 'kivana',
              planCode: String(sel.value || '').trim(),
              endsAt,
            }),
          })
          await renderAdminUsers()
          els.adminStatus.textContent = 'Updated.'
        } catch (e) {
          els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
        } finally {
          applyBtn.disabled = false
        }
      })

      const wrap = document.createElement('div')
      wrap.style.display = 'grid'
      wrap.style.gridTemplateColumns = '1fr 1fr auto'
      wrap.style.gap = '8px'
      wrap.appendChild(sel)
      wrap.appendChild(durationSel)
      wrap.appendChild(applyBtn)
      setTd.appendChild(wrap)
      tr.appendChild(setTd)

      const actionsTd = document.createElement('td')
      const modBtn = document.createElement('button')
      modBtn.className = 'btn btn-secondary'
      modBtn.textContent = u.isAdmin ? 'Admin' : (u.isModerator ? 'Remove moderator' : 'Make moderator')
      modBtn.disabled = !!u.isAdmin
      modBtn.addEventListener('click', async () => {
        if (u.isAdmin) return
        const next = !u.isModerator
        modBtn.disabled = true
        els.adminStatus.textContent = 'Saving…'
        try {
          await apiFetch('/v1/admin/moderator', {
            method: 'POST',
            body: JSON.stringify({ email: u.email, enabled: next }),
          })
          adminUsersCache = []
          await renderAdminUsers()
        } catch (e) {
          els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
        } finally {
          modBtn.disabled = false
        }
      })

      const discBtn = document.createElement('button')
      discBtn.className = 'btn btn-secondary'
      discBtn.textContent = 'Discount'
      discBtn.addEventListener('click', async () => {
        const res = await promptDiscount(u.email)
        if (!res) return
        const pct = Number(res.percent || 0)
        const label = res.label
        discBtn.disabled = true
        els.adminStatus.textContent = 'Saving…'
        try {
          await apiFetch('/v1/admin/discount', {
            method: 'POST',
            body: JSON.stringify({ email: u.email, percent: pct, label }),
          })
          adminUsersCache = []
          await renderAdminUsers()
        } catch (e) {
          els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
        } finally {
          discBtn.disabled = false
        }
      })

      const pwBtn = document.createElement('button')
      pwBtn.className = 'btn btn-secondary'
      pwBtn.textContent = 'Reset password'
      pwBtn.addEventListener('click', async () => {
        const pw = await promptPassword(u.email)
        if (!pw) return
        pwBtn.disabled = true
        els.adminStatus.textContent = 'Saving…'
        try {
          await apiFetch(`/v1/admin/users/${u.id}/password`, {
            method: 'POST',
            body: JSON.stringify({ password: String(pw) }),
          })
          await renderAdminUsers()
        } catch (e) {
          els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
        } finally {
          pwBtn.disabled = false
        }
      })

      const delBtn = document.createElement('button')
      delBtn.className = 'btn btn-secondary'
      delBtn.textContent = 'Delete'
      delBtn.addEventListener('click', async () => {
        const ok = await confirmAction({
          title: 'Delete user',
          message: `Delete user ${u.email}? This cannot be undone.`,
          okText: 'Delete',
        })
        if (!ok) return
        delBtn.disabled = true
        els.adminStatus.textContent = 'Deleting…'
        try {
          await apiFetch(`/v1/admin/users/${u.id}`, { method: 'DELETE' })
          await renderAdminUsers()
        } catch (e) {
          els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
        } finally {
          delBtn.disabled = false
        }
      })

      const actWrap = document.createElement('div')
      actWrap.style.display = 'flex'
      actWrap.style.flexWrap = 'wrap'
      actWrap.style.gap = '8px'
      actWrap.appendChild(modBtn)
      actWrap.appendChild(discBtn)
      actWrap.appendChild(pwBtn)
      actWrap.appendChild(delBtn)
      actionsTd.appendChild(actWrap)
      tr.appendChild(actionsTd)

      els.adminUsersBody.appendChild(tr)
    }
    els.adminStatus.textContent = q ? `Showing ${users.length} of ${adminUsersCache.length}` : (users.length ? '' : 'No users found.')
  } catch (e) {
    els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
  }
}

async function renderAdminContactMessages() {
  if (!els.adminContactBody || !els.adminStatus) return
  try {
    if (!adminContactCache.length) {
      els.adminStatus.textContent = 'Loading…'
      adminContactCache = await loadAdminContactMessages()
    }

    const q = String(els.adminSearch?.value || '').trim().toLowerCase()
    const messages = q
      ? adminContactCache.filter((m) => {
        const hay = [
          String(m?.name || ''),
          String(m?.email || ''),
          String(m?.subject || ''),
          String(m?.message || ''),
          String(m?.clientIp || m?.client_ip || ''),
        ].join(' ').toLowerCase()
        return hay.includes(q)
      })
      : adminContactCache

    els.adminContactBody.innerHTML = ''
    for (const m of messages) {
      const tr = document.createElement('tr')

      const createdTd = document.createElement('td')
      createdTd.textContent = fmtDateTime(m.createdAt || m.created_at || '')
      tr.appendChild(createdTd)

      const statusTd = document.createElement('td')
      statusTd.textContent = m.isRead ? 'Read' : 'New'
      tr.appendChild(statusTd)

      const nameTd = document.createElement('td')
      nameTd.textContent = m.name || ''
      tr.appendChild(nameTd)

      const emailTd = document.createElement('td')
      emailTd.textContent = m.email || ''
      tr.appendChild(emailTd)

      const subjectTd = document.createElement('td')
      subjectTd.textContent = m.subject || ''
      tr.appendChild(subjectTd)

      const msgTd = document.createElement('td')
      const msg = String(m.message || '')
      msgTd.textContent = msg.length > 90 ? `${msg.slice(0, 90)}…` : msg
      tr.appendChild(msgTd)

      const ipTd = document.createElement('td')
      ipTd.textContent = m.clientIp || m.client_ip || ''
      tr.appendChild(ipTd)

      const actionTd = document.createElement('td')
      const btnWrap = document.createElement('div')
      btnWrap.style.display = 'flex'
      btnWrap.style.flexWrap = 'wrap'
      btnWrap.style.gap = '8px'

      const viewBtn = document.createElement('button')
      viewBtn.className = 'btn btn-secondary'
      viewBtn.textContent = 'View'
      viewBtn.addEventListener('click', async () => {
        await openActionModal({
          title: 'Contact message',
          okText: 'Close',
          cancelText: 'Close',
          build: (body) => {
            const wrap = document.createElement('div')
            wrap.className = 'modalForm'

            const p1 = document.createElement('div')
            p1.className = 'modalText'
            p1.textContent = `From: ${String(m.name || '')} <${String(m.email || '')}>`

            const p2 = document.createElement('div')
            p2.className = 'modalText'
            p2.textContent = `Subject: ${String(m.subject || '')}`

            const p3 = document.createElement('div')
            p3.className = 'modalText'
            p3.textContent = `Created: ${fmtDateTime(m.createdAt || m.created_at || '')} • IP: ${String(m.clientIp || m.client_ip || '')}`

            const pre = document.createElement('pre')
            pre.className = 'mdPre'
            pre.textContent = String(m.message || '')

            wrap.appendChild(p1)
            wrap.appendChild(p2)
            wrap.appendChild(p3)
            wrap.appendChild(pre)
            body.appendChild(wrap)
            return () => true
          },
        })

        if (!m.isRead && (m.id || m.id === '')) {
          try {
            await apiFetch(`/v1/admin/contact-messages/${m.id}/read`, { method: 'POST' })
            m.isRead = true
            await renderAdminContactMessages()
          } catch {
            void 0
          }
        }
      })

      const toggleBtn = document.createElement('button')
      toggleBtn.className = 'btn btn-secondary'
      toggleBtn.textContent = m.isRead ? 'Unread' : 'Read'
      toggleBtn.addEventListener('click', async () => {
        toggleBtn.disabled = true
        els.adminStatus.textContent = 'Saving…'
        try {
          if (m.isRead) {
            await apiFetch(`/v1/admin/contact-messages/${m.id}/unread`, { method: 'POST' })
            m.isRead = false
          } else {
            await apiFetch(`/v1/admin/contact-messages/${m.id}/read`, { method: 'POST' })
            m.isRead = true
          }
          await renderAdminContactMessages()
          els.adminStatus.textContent = ''
        } catch (e) {
          els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
        } finally {
          toggleBtn.disabled = false
        }
      })

      const delBtn = document.createElement('button')
      delBtn.className = 'btn btn-secondary'
      delBtn.textContent = 'Delete'
      delBtn.addEventListener('click', async () => {
        const ok = await confirmAction({
          title: 'Delete message',
          message: `Delete message from ${String(m.email || '')}? This cannot be undone.`,
          okText: 'Delete',
        })
        if (!ok) return
        delBtn.disabled = true
        els.adminStatus.textContent = 'Deleting…'
        try {
          await apiFetch(`/v1/admin/contact-messages/${m.id}`, { method: 'DELETE' })
          adminContactCache = adminContactCache.filter((x) => x.id !== m.id)
          await renderAdminContactMessages()
          els.adminStatus.textContent = ''
        } catch (e) {
          els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
        } finally {
          delBtn.disabled = false
        }
      })

      btnWrap.appendChild(viewBtn)
      btnWrap.appendChild(toggleBtn)
      btnWrap.appendChild(delBtn)
      actionTd.appendChild(btnWrap)
      tr.appendChild(actionTd)

      els.adminContactBody.appendChild(tr)
    }

    if (q) els.adminStatus.textContent = `Showing ${messages.length} of ${adminContactCache.length}`
    else els.adminStatus.textContent = adminContactCache.length ? '' : 'No messages yet.'
  } catch (e) {
    els.adminStatus.textContent = `Failed: ${String(e?.message || e)}`
  }
}

async function showAdmin() {
  if (!isAuthed()) {
    pendingPlanSelection = null
    setAuthMode(true)
    await showAuth()
    return
  }
  try {
    await syncSessionData()
  } catch {
    void 0
  }
  if (!currentMe || !currentMe.isAdmin) {
    await showDashboard()
    return
  }
  setAdminTab(adminActiveTab || 'users')
  showOnly('admin')
  adminUsersCache = []
  adminContactCache = []
  if (adminActiveTab === 'access') await renderAdminContactMessages()
  else await renderAdminUsers()
}

async function handleSelectPlan(payload, statusEl) {
  if (!isAuthed()) {
    pendingPlanSelection = payload
    setAuthMode(false)
    await showAuth()
    return
  }
  const currentCode = currentEntitlement ? String(currentEntitlement.planCode || '').trim().toLowerCase() : ''
  const nextCode = String(payload.planCode || '').trim().toLowerCase()
  if (!nextCode || nextCode === currentCode) return

  if (statusEl) statusEl.textContent = 'Processing...'
  setBusy(true)
  try {
    await apiFetch('/v1/portal/select-plan', { method: 'POST', body: JSON.stringify(payload) })
    if (statusEl) statusEl.textContent = 'Plan updated successfully!'
    await syncSessionData()
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error: ${err && err.message ? err.message : 'Failed.'}`
  } finally {
    setBusy(false)
    if (statusEl) setTimeout(() => (statusEl.textContent = ''), 3000)
  }
}

async function handleSignOut() {
  try {
    await apiFetch('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: getRefreshToken() }) })
  } catch {
    void 0
  }
  clearTokens()
  const path = String(window.location.pathname || '')
  if (path.startsWith('/account') || path.startsWith('/portal')) {
    window.location.assign('/')
    return
  }
  if (startInAuth) await showAuth()
  else await showDashboard()
}

async function handleAvatarFile(file) {
  if (!currentMe || !file) return
  els.profileStatus.textContent = ''
  setBusy(true)
  try {
    const finalDataUrl = await (async () => {
      const maxSize = 256
      const objectUrl = URL.createObjectURL(file)
      try {
        const img = await new Promise((resolve, reject) => {
          const i = new Image()
          i.onload = () => resolve(i)
          i.onerror = () => reject(new Error('Failed to decode image'))
          i.src = objectUrl
        })
        const iw = img.naturalWidth || img.width || 0
        const ih = img.naturalHeight || img.height || 0
        if (!iw || !ih) throw new Error('Invalid image')

        const scale = Math.min(1, maxSize / Math.max(iw, ih))
        const w = Math.max(1, Math.round(iw * scale))
        const h = Math.max(1, Math.round(ih * scale))

        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Failed to process image')
        ctx.drawImage(img, 0, 0, w, h)

        const asWebp = canvas.toDataURL('image/webp', 0.8)
        if (asWebp && asWebp.startsWith('data:image/webp') && asWebp.length > 100) return asWebp
        return canvas.toDataURL('image/jpeg', 0.82)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    })()

    if (finalDataUrl.length > 1_000_000) {
      throw new Error('Image still too large after compression.')
    }
    saveProfileLocal(currentMe.id, { avatarDataUrl: finalDataUrl })
    await updateProfileOnServer({ avatarDataUrl: finalDataUrl })
    await syncSessionData()
    fillAccountProfile()
    els.profileStatus.textContent = 'Avatar saved.'
  } catch (err) {
    els.profileStatus.textContent = err && err.message ? err.message : 'Failed to save avatar.'
  } finally {
    setBusy(false)
    setTimeout(() => (els.profileStatus.textContent = ''), 2500)
  }
}

async function handleSaveProfile() {
  if (!currentMe) return
  if (!els.displayName) return
  if (els.profileStatus) els.profileStatus.textContent = ''
  setBusy(true)
  try {
    const displayName = String(els.displayName.value || '').trim()
    saveProfileLocal(currentMe.id, { displayName })
    await updateProfileOnServer({ displayName })
    await syncSessionData()
    fillAccountProfile()
    if (els.profileStatus) els.profileStatus.textContent = 'Profile saved.'
  } catch (err) {
    if (els.profileStatus) els.profileStatus.textContent = err && err.message ? err.message : 'Failed to save profile.'
  } finally {
    setBusy(false)
    if (els.profileStatus) setTimeout(() => (els.profileStatus.textContent = ''), 2500)
  }
}

async function handleCancelSubscription() {
  if (!currentEntitlement) return
  const planCode = String(currentEntitlement.planCode || '').trim().toLowerCase()
  if (planCode === 'basic') return
  const ok = await confirmAction({
    title: 'Cancel subscription',
    message: 'Cancel your subscription and switch to Basic?',
    okText: 'Cancel subscription',
  })
  if (!ok) return
  await handleSelectPlan({ planCode: 'basic' }, els.accountStatus)
}

function setAuthMode(loginMode) {
  isLoginMode = !!loginMode
  els.authError.textContent = ''
  if (isLoginMode) {
    els.authTitle.textContent = 'Sign in to Kivana'
    els.authSubtitle.textContent = 'Manage your Personal Finance app subscription.'
    els.btnSubmitAuth.textContent = 'Sign in'
    els.authToggleText.textContent = "Don't have an account?"
    els.linkToggleAuth.textContent = 'Create one'
  } else {
    els.authTitle.textContent = 'Create an account'
    els.authSubtitle.textContent = 'Create an account, then choose a trial or plan.'
    els.btnSubmitAuth.textContent = 'Sign up'
    els.authToggleText.textContent = 'Already have an account?'
    els.linkToggleAuth.textContent = 'Sign in'
  }
}

if (els.linkToggleAuth) els.linkToggleAuth.addEventListener('click', toggleAuthMode)
if (els.authForm) els.authForm.addEventListener('submit', handleAuthSubmit)
if (els.btnSignOut) els.btnSignOut.addEventListener('click', handleSignOut)
if (els.btnNavPlans) els.btnNavPlans.addEventListener('click', async () => {
  await showDashboard()
  setTimeout(() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
})
if (els.btnNavAccount) els.btnNavAccount.addEventListener('click', () => void showAccount())
if (els.btnNavAdmin) els.btnNavAdmin.addEventListener('click', () => void showAdmin())
if (els.btnAdminReload) els.btnAdminReload.addEventListener('click', () => void showAdmin())
if (els.adminTabUsers) els.adminTabUsers.addEventListener('click', () => {
  setAdminTab('users')
  void renderAdminUsers()
})
if (els.adminTabAccess) els.adminTabAccess.addEventListener('click', () => {
  setAdminTab('access')
  void renderAdminContactMessages()
})
if (els.adminTabSettings) els.adminTabSettings.addEventListener('click', () => setAdminTab('settings'))
if (els.adminSearch) els.adminSearch.addEventListener('input', () => {
  if (adminActiveTab === 'users') void renderAdminUsers()
  else if (adminActiveTab === 'access') void renderAdminContactMessages()
})
if (els.btnSignIn) els.btnSignIn.addEventListener('click', () => {
  pendingPlanSelection = null
  setAuthMode(true)
  void showAuth()
})
if (els.btnSignUp) els.btnSignUp.addEventListener('click', startFree)
if (els.btnPrebetaCreate) els.btnPrebetaCreate.addEventListener('click', startFree)
if (els.btnPrebetaSignIn) els.btnPrebetaSignIn.addEventListener('click', () => {
  pendingPlanSelection = null
  setAuthMode(true)
  void showAuth()
})
if (els.btnPrebetaDownloadMac) els.btnPrebetaDownloadMac.addEventListener('click', () => void startPrebetaDownload('darwin-aarch64'))
if (els.btnPrebetaDownloadWin) els.btnPrebetaDownloadWin.addEventListener('click', () => void startPrebetaDownload('windows-x86_64'))
if (els.btnMacGuide) els.btnMacGuide.addEventListener('click', openMacGuide)
if (els.btnPrebetaContact) els.btnPrebetaContact.addEventListener('click', openContactModal)
if (els.btnCloseMacGuide) els.btnCloseMacGuide.addEventListener('click', closeMacGuide)
if (els.macGuideBackdrop) els.macGuideBackdrop.addEventListener('click', closeMacGuide)
if (els.btnClosePreviewModal) els.btnClosePreviewModal.addEventListener('click', closePreviewModal)
if (els.previewModalBackdrop) els.previewModalBackdrop.addEventListener('click', closePreviewModal)
if (els.btnCloseContactModal) els.btnCloseContactModal.addEventListener('click', closeContactModal)
if (els.contactModalBackdrop) els.contactModalBackdrop.addEventListener('click', closeContactModal)
if (els.contactForm) els.contactForm.addEventListener('submit', handleContactSubmit)

document.querySelectorAll('.previewImg').forEach((img) => {
  img.addEventListener('click', () => {
    const src = img.getAttribute('src')
    if (!src) return
    const title = img.getAttribute('alt') || 'Screenshot'
    openPreviewModal({ src, title })
  })
})

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (els.previewModal && !els.previewModal.classList.contains('hidden')) closePreviewModal()
  if (els.macGuideModal && !els.macGuideModal.classList.contains('hidden')) closeMacGuide()
  if (els.contactModal && !els.contactModal.classList.contains('hidden')) closeContactModal()
})

window.addEventListener('pageshow', () => {
  enforceLoggedOutLanding()
})

if (els.btnMacGuide) {
  els.btnMacGuide.classList.toggle('hidden', !isMacOs())
}
if (els.macUnsignedNote) {
  els.macUnsignedNote.classList.toggle('hidden', !isMacOs())
}

applyTheme(getTheme())

async function goToPublicSection(id) {
  if (isAuthed() || !fullLanding) return
  if (id === 'pricing') return
  const exists = !!document.getElementById(id)
  if (!exists) {
    window.location.href = `/learn.html#${encodeURIComponent(String(id || '').trim() || 'how')}`
    return
  }
  pendingPlanSelection = null
  await showDashboard()
  if (window.location.hash !== `#${id}`) window.location.hash = id
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  closeMenu()
}

function startFree() {
  if (isAuthed()) return
  pendingPlanSelection = null
  setAuthMode(false)
  closeMenu()
  void showAuth()
}

if (els.navFeatures) els.navFeatures.addEventListener('click', () => void goToPublicSection('how'))
if (els.navPricing) els.navPricing.addEventListener('click', () => void goToPublicSection('pricing'))
if (els.navSecurity) els.navSecurity.addEventListener('click', () => void goToPublicSection('security'))
if (els.navResources) els.navResources.addEventListener('click', () => void goToPublicSection('preview'))
if (els.navAccountants) els.navAccountants.addEventListener('click', () => void goToPublicSection('different'))
if (els.btnCtaCreate) els.btnCtaCreate.addEventListener('click', startFree)
if (els.btnCtaViewPlans) els.btnCtaViewPlans.addEventListener('click', () => void goToPublicSection('pricing'))
if (els.btnCtaSignIn) els.btnCtaSignIn.addEventListener('click', () => {
  pendingPlanSelection = null
  setAuthMode(true)
  void showAuth()
})
if (els.btnBackToWebsite) els.btnBackToWebsite.addEventListener('click', () => {
  pendingPlanSelection = null
  void showDashboard()
})

if (els.btnMenu) els.btnMenu.addEventListener('click', () => {
  if (!els.mobileMenu) return
  const open = !els.mobileMenu.classList.contains('hidden')
  if (open) closeMenu()
  else openMenu()
})
if (els.btnCloseMenu) els.btnCloseMenu.addEventListener('click', closeMenu)
if (els.menuBackdrop) els.menuBackdrop.addEventListener('click', closeMenu)

if (els.mNavFeatures) els.mNavFeatures.addEventListener('click', () => void goToPublicSection('how'))
if (els.mNavPricing) els.mNavPricing.addEventListener('click', () => void goToPublicSection('pricing'))
if (els.mNavSecurity) els.mNavSecurity.addEventListener('click', () => void goToPublicSection('security'))
if (els.mNavResources) els.mNavResources.addEventListener('click', () => void goToPublicSection('preview'))
if (els.mNavAccountants) els.mNavAccountants.addEventListener('click', () => void goToPublicSection('different'))
if (els.mSignIn) els.mSignIn.addEventListener('click', () => {
  pendingPlanSelection = null
  setAuthMode(true)
  closeMenu()
  void showAuth()
})
if (els.mGetKivana) els.mGetKivana.addEventListener('click', startFree)
if (els.mPlans) els.mPlans.addEventListener('click', () => {
  closeMenu()
  void showDashboard()
})
if (els.mAccount) els.mAccount.addEventListener('click', () => {
  closeMenu()
  void showAccount()
})
if (els.mAdmin) els.mAdmin.addEventListener('click', () => {
  closeMenu()
  void showAdmin()
})
if (els.mSignOut) els.mSignOut.addEventListener('click', () => {
  closeMenu()
  void handleSignOut()
})

if (els.btnHeroStartFree) els.btnHeroStartFree.addEventListener('click', startFree)
if (els.btnHeroViewPlans) els.btnHeroViewPlans.addEventListener('click', () => void goToPublicSection('pricing'))
if (els.btnAccountantService) els.btnAccountantService.addEventListener('click', startFree)
if (els.btnCtaDownloadMac) els.btnCtaDownloadMac.addEventListener('click', () => {
  void startPrebetaDownload('darwin-aarch64')
})
if (els.btnCtaDownloadWin) els.btnCtaDownloadWin.addEventListener('click', () => {
  void startPrebetaDownload('windows-x86_64')
})
if (els.btnFooterDownloadMac) els.btnFooterDownloadMac.addEventListener('click', () => void startPrebetaDownload('darwin-aarch64'))
if (els.btnFooterDownloadWin) els.btnFooterDownloadWin.addEventListener('click', () => void startPrebetaDownload('windows-x86_64'))
if (els.btnFooterContact) els.btnFooterContact.addEventListener('click', openContactModal)

let selectedOs = 'mac'
function setSelectedOs(os) {
  selectedOs = os === 'win' ? 'win' : 'mac'
  if (els.osMac) els.osMac.classList.toggle('active', selectedOs === 'mac')
  if (els.osWin) els.osWin.classList.toggle('active', selectedOs === 'win')
  if (els.mOsMac) els.mOsMac.classList.toggle('active', selectedOs === 'mac')
  if (els.mOsWin) els.mOsWin.classList.toggle('active', selectedOs === 'win')
  if (els.btnDownloadPrimary) els.btnDownloadPrimary.textContent = selectedOs === 'mac' ? 'Download for macOS' : 'Download for Windows'
  if (els.btnDownloadSecondary) els.btnDownloadSecondary.textContent = selectedOs === 'mac' ? 'Download for Windows' : 'Download for macOS'
}

function showMarketingStatus(message) {
  els.dashboardStatus.textContent = message
  setTimeout(() => {
    if (els.dashboardStatus.textContent === message) els.dashboardStatus.textContent = ''
  }, 3500)
}

async function handleDownloadClick() {
  if (isAuthed()) return
  await goToPublicSection('how')
  showMarketingStatus('Downloads are available below.')
}

if (els.osMac) els.osMac.addEventListener('click', () => setSelectedOs('mac'))
if (els.osWin) els.osWin.addEventListener('click', () => setSelectedOs('win'))
if (els.mOsMac) els.mOsMac.addEventListener('click', () => setSelectedOs('mac'))
if (els.mOsWin) els.mOsWin.addEventListener('click', () => setSelectedOs('win'))
if (els.btnThemeToggle) els.btnThemeToggle.addEventListener('click', toggleTheme)
if (els.mThemeToggle) els.mThemeToggle.addEventListener('click', () => {
  toggleTheme()
  closeMenu()
})
if (els.mThemeToggleAuthed) els.mThemeToggleAuthed.addEventListener('click', () => {
  toggleTheme()
  closeMenu()
})
if (els.btnDownloadPrimary) els.btnDownloadPrimary.addEventListener('click', () => void handleDownloadClick())
if (els.btnDownloadSecondary) els.btnDownloadSecondary.addEventListener('click', () => void handleDownloadClick())

async function applyHashNav() {
  if (isAuthed() || !fullLanding) return
  const id = String(window.location.hash || '').replace(/^#/, '').trim()
  if (!id) return
  const normalized = id === 'features' ? 'how'
    : id === 'resources' ? 'preview'
    : id
  const allow = new Set(['benefits', 'how', 'preview', 'why', 'fit', 'trust', 'coming'])
  if (!allow.has(normalized)) return
  if (!document.getElementById(normalized)) {
    window.location.href = `/learn.html#${encodeURIComponent(normalized)}`
    return
  }
  await showDashboard()
  setTimeout(() => document.getElementById(normalized)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
}

window.addEventListener('hashchange', () => void applyHashNav())

document.querySelectorAll('.faq-q').forEach((q) => {
  q.addEventListener('click', () => {
    const item = q.closest('.faq-item')
    if (item) item.classList.toggle('open')
  })
})

if (els.btnBillingYearly) els.btnBillingYearly.addEventListener('click', () => setBillingCycle('yearly'))
if (els.btnBillingMonthly) els.btnBillingMonthly.addEventListener('click', () => setBillingCycle('monthly'))

document.querySelectorAll('[data-plan]').forEach((el) => {
  el.addEventListener('click', () => {
    const planCode = String(el.getAttribute('data-plan') || '').trim()
    if (!planCode) return
    if (planCode === 'standard' || planCode === 'pro') {
      void handleSelectPlan({ planCode, billingCycle }, els.dashboardStatus)
      return
    }
    void handleSelectPlan({ planCode }, els.dashboardStatus)
  })
})

if (els.btnManagePlans) els.btnManagePlans.addEventListener('click', async () => {
  await showDashboard()
  setTimeout(() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
})
if (els.btnCancelSub) els.btnCancelSub.addEventListener('click', () => void handleCancelSubscription())
if (els.btnSaveProfile) els.btnSaveProfile.addEventListener('click', () => void handleSaveProfile())
if (els.avatarFile) {
  els.avatarFile.addEventListener('change', (e) => {
    const file = e && e.target && e.target.files ? e.target.files[0] : null
    void handleAvatarFile(file)
  })
}

;(async () => {
  setBillingCycle('yearly')
  setSelectedOs('mac')
  applyNav()
  if (els.footerYear) els.footerYear.textContent = '2026'
  if (getAccessToken()) {
    try {
      await refreshAccessToken()
      await showDashboard()
      return
    } catch {
      clearTokens()
    }
  }
  enforceLoggedOutLanding()
  if (
    !startInAuth &&
    !getAccessToken() &&
    (String(window.location.pathname || '').startsWith('/account') || String(window.location.pathname || '').startsWith('/portal'))
  ) {
    return
  }
  if (startInAuth) {
    const startAsLogin = !(startAuthMode === 'signup' || startAuthMode === 'create' || startAuthMode === 'register')
    setAuthMode(startAsLogin)
    await showAuth()
    return
  }
  await showDashboard()
  await applyHashNav()
})()

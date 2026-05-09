import React, { useEffect, useMemo, useRef, useState } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'

const LS_ACCESS = 'kivanaPortal/accessToken'
const LS_REFRESH = 'kivanaPortal/refreshToken'

function getAccessToken() {
  try {
    return String(localStorage.getItem(LS_ACCESS) || '')
  } catch {
    return ''
  }
}

function getRefreshToken() {
  try {
    return String(localStorage.getItem(LS_REFRESH) || '')
  } catch {
    return ''
  }
}

function setTokens(accessToken, refreshToken) {
  try {
    if (accessToken) localStorage.setItem(LS_ACCESS, String(accessToken))
    if (refreshToken) localStorage.setItem(LS_REFRESH, String(refreshToken))
  } catch {
    void 0
  }
}

function clearTokens() {
  try {
    localStorage.removeItem(LS_ACCESS)
    localStorage.removeItem(LS_REFRESH)
  } catch {
    void 0
  }
}

function computeApiBaseUrl() {
  const sp = new URLSearchParams(window.location.search)
  const override = String(sp.get('api') || '').trim()
  if (override) return override.replace(/\/+$/, '')
  return window.location.origin
}

const apiBaseUrl = computeApiBaseUrl()
const apiUrl = (path) => `${apiBaseUrl}${path}`

function formatRfc3339Short(value) {
  const s = String(value || '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return s
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function normalizePlanLabel(planCode) {
  const c = String(planCode || '').trim().toLowerCase()
  if (c === 'lifetime_pro') return 'Lifetime'
  if (c === 'standard') return 'Ordinary'
  if (c === 'pro') return 'Pro'
  if (c === 'basic') return 'Basic'
  return c || ''
}

async function apiFetch(path, init = {}, { allowRetry = true } = {}) {
  const access = getAccessToken()
  const headers = new Headers(init.headers || {})
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  if (access) headers.set('authorization', `Bearer ${access}`)
  const res = await fetch(apiUrl(path), { ...init, headers })
  if (res.ok) return res

  if (res.status === 401 && allowRetry && getRefreshToken()) {
    try {
      await refreshAccessToken()
      return apiFetch(path, init, { allowRetry: false })
    } catch {
      void 0
    }
  }

  let msg = `HTTP ${res.status}`
  if (res.status === 501) {
    msg =
      'Account portal is running without the API. Open the portal from the API server (for example http://localhost:8080/account/) or add ?api=http://localhost:8080 to this page URL.'
    throw new Error(msg)
  }
  try {
    const j = await res.json()
    if (j && j.error) msg = String(j.error)
  } catch {
    void 0
  }
  throw new Error(msg)
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return
  const res = await apiFetch('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, { allowRetry: false })
  const json = await res.json()
  setTokens(json.accessToken, json.refreshToken)
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
  if (isNorway) return { code: 'NOK', symbol: 'kr' }
  if (isUk) return { code: 'GBP', symbol: '£' }
  return { code: 'EUR', symbol: '€' }
}

function formatAmount(v) {
  if (v == null) return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function formatMoney(pricing, amount) {
  if (!pricing) return String(amount ?? '')
  if (pricing.code === 'NOK') return `${pricing.symbol} ${formatAmount(Math.round(Number(amount) || 0))}`
  return `${pricing.symbol}${formatAmount(amount)}`
}

function useQueryMode() {
  return useMemo(() => {
    const sp = new URLSearchParams(window.location.search)
    const mode = String(sp.get('mode') || '').trim().toLowerCase()
    const start = sp.get('portal') === '1'
    return { mode, start }
  }, [])
}

function Pill({ kind, children }) {
  const cls =
    kind === 'ok'
      ? 'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700'
      : kind === 'warn'
        ? 'inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700'
        : kind === 'err'
          ? 'inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700'
          : 'inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700'
  return React.createElement('span', { className: cls }, children)
}

function App() {
  const pricing = useMemo(() => detectPricingCurrency(), [])
  const query = useQueryMode()

  const [view, setView] = useState(() => (getAccessToken() ? 'dashboard' : query.start ? 'auth' : 'auth'))
  const [authMode, setAuthMode] = useState(() => {
    if (query.mode === 'signup' || query.mode === 'create' || query.mode === 'register') return 'signup'
    return 'login'
  })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState({ kind: 'muted', text: '' })
  const [navScrolled, setNavScrolled] = useState(false)

  const [me, setMe] = useState(null)
  const [entitlement, setEntitlement] = useState(null)
  const [billingCycle, setBillingCycle] = useState('yearly')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [displayName, setDisplayName] = useState('')

  const [adminTab, setAdminTab] = useState('users')
  const [adminUsers, setAdminUsers] = useState([])
  const [adminMessages, setAdminMessages] = useState([])
  const [adminModal, setAdminModal] = useState(null)
  const [section, setSection] = useState(() => {
    const sp = new URLSearchParams(window.location.search)
    const s = String(sp.get('section') || '').trim().toLowerCase()
    if (s === 'plan' || s === 'plans' || s === 'billing') return 'billing'
    if (s === 'download' || s === 'downloads') return 'downloads'
    if (s === 'security') return 'security'
    if (s === 'support' || s === 'contact') return 'support'
    if (s === 'data' || s === 'my-data') return 'data'
    if (s === 'admin') return 'admin'
    return 'profile'
  })
  const [sessions, setSessions] = useState([])
  const [pwModal, setPwModal] = useState(null)
  const [deleteModal, setDeleteModal] = useState(null)
  const [publicConfig, setPublicConfig] = useState(null)
  const [adminConfig, setAdminConfig] = useState(null)
  const [adminPage, setAdminPage] = useState('overview')
  const [msgModal, setMsgModal] = useState(null)
  const [adminMsgFilter, setAdminMsgFilter] = useState('new')
  const [adminUserQuery, setAdminUserQuery] = useState('')

  const displayNameInputRef = useRef(null)

  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true

    ;(async () => {
      if (!getAccessToken()) return
      try {
        await refreshAccessToken()
      } catch {
        clearTokens()
        return
      }
      await loadSession()
    })()
  }, [])

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const cfg = publicConfig || null
  const cfgPricing = cfg?.pricing || null
  const yearlyFactor = Number(cfgPricing?.yearlyFactor || 11)
  const trialDays = Number(cfgPricing?.trialDays || 14)

  const currencyKey = pricing.code === 'NOK' ? 'nok' : pricing.code === 'GBP' ? 'gbp' : 'eur'
  const monthlyStd = Number(cfgPricing?.standardMonthly?.[currencyKey] ?? (pricing.code === 'NOK' ? 99 : 9.99))
  const monthlyPro = Number(cfgPricing?.proMonthly?.[currencyKey] ?? (pricing.code === 'NOK' ? 299 : 29.9))
  const yearlyStd = pricing.code === 'NOK' ? monthlyStd * yearlyFactor : Number((monthlyStd * yearlyFactor).toFixed(2))
  const yearlyPro = pricing.code === 'NOK' ? monthlyPro * yearlyFactor : Number((monthlyPro * yearlyFactor).toFixed(2))

  async function loadMe() {
    const res = await apiFetch('/v1/me', { method: 'GET' })
    const json = await res.json()
    setMe(json)
    const nextName = String(json.displayName || '')
    setDisplayName(nextName)
    try {
      const el = displayNameInputRef.current
      if (el && document.activeElement !== el) el.value = nextName
    } catch {
      void 0
    }
    return json
  }

  async function loadEntitlements() {
    const res = await apiFetch('/v1/entitlements', { method: 'GET' })
    const json = await res.json()
    const products = Array.isArray(json?.products) ? json.products : []
    const kivana = products.find((p) => String(p.productCode || '').toLowerCase() === 'kivana') || null
    setEntitlement(kivana)
    return kivana
  }

  async function loadSessions() {
    const res = await apiFetch('/v1/sessions', { method: 'GET' })
    const json = await res.json()
    setSessions(Array.isArray(json?.sessions) ? json.sessions : [])
    return json
  }

  async function loadPublicConfig() {
    const res = await fetch('/v1/public/config', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    setPublicConfig(json || null)
    return json
  }

  async function loadSession() {
    setBusy(true)
    try {
      await loadPublicConfig()
      await loadMe()
      await loadEntitlements()
      await loadSessions()
      setView('dashboard')
      setStatus({ kind: 'muted', text: '' })
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
      setView('auth')
    } finally {
      setBusy(false)
    }
  }

  async function submitAuth(e) {
    e.preventDefault()
    if (busy) return
    setStatus({ kind: 'muted', text: '' })
    const em = String(email || '').trim()
    const pw = String(password || '')
    if (!em || !pw) {
      setStatus({ kind: 'err', text: 'Missing email or password.' })
      return
    }
    setBusy(true)
    try {
      const endpoint = authMode === 'signup' ? '/v1/auth/signup' : '/v1/auth/login'
      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ email: em, password: pw }) }, { allowRetry: false })
      const json = await res.json()
      setTokens(json.accessToken, json.refreshToken)
      setPassword('')
      await loadSession()
    } catch (err) {
      setStatus({ kind: 'err', text: String(err?.message || err) })
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (busy) return
    setBusy(true)
    try {
      const refreshToken = getRefreshToken()
      clearTokens()
      if (refreshToken) {
        await apiFetch('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, { allowRetry: false })
      }
    } catch {
      void 0
    } finally {
      setBusy(false)
      window.location.replace('/')
    }
  }

  async function signOutAll() {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch('/v1/auth/logout-all', { method: 'POST', body: JSON.stringify({}) })
      await loadSessions()
      setStatus({ kind: 'ok', text: 'Signed out of all sessions.' })
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function revokeSession(sessionId) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch(`/v1/sessions/${encodeURIComponent(String(sessionId))}/revoke`, { method: 'POST', body: JSON.stringify({}) })
      await loadSessions()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function changeMyPassword(currentPassword, newPassword) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const res = await apiFetch(
        '/v1/auth/change-password',
        { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) },
        { allowRetry: false }
      )
      const json = await res.json()
      setTokens(json.accessToken, json.refreshToken)
      setPwModal(null)
      await loadSession()
      setStatus({ kind: 'ok', text: 'Password updated.' })
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function exportAccount() {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const res = await apiFetch('/v1/account/export', { method: 'GET' })
      const json = await res.json()
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'kivana-account-export.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setStatus({ kind: 'ok', text: 'Export downloaded.' })
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function deleteMyAccount(password, confirmText) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch('/v1/account/delete', { method: 'POST', body: JSON.stringify({ password, confirmText }) }, { allowRetry: false })
      clearTokens()
      setDeleteModal(null)
      window.location.replace('/')
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function selectPlan(planCode) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const c = String(planCode || '').trim().toLowerCase()
      await apiFetch('/v1/portal/select-plan', { method: 'POST', body: JSON.stringify({ planCode: c === 'lifetime' ? 'lifetime_pro' : c, billingCycle }) })
      setStatus({ kind: 'ok', text: 'Plan updated.' })
      await loadEntitlements()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function saveProfile() {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const dn = String((displayNameInputRef.current && displayNameInputRef.current.value) || displayName || '').trim()
      await apiFetch('/v1/profile', { method: 'POST', body: JSON.stringify({ displayName: dn || null }) })
      await loadMe()
      setStatus({ kind: 'ok', text: 'Profile saved.' })
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function loadAdmin() {
    if (!me?.isAdmin) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const [uRes, mRes, cRes] = await Promise.all([
        apiFetch('/v1/admin/users', { method: 'GET' }),
        apiFetch('/v1/admin/contact-messages', { method: 'GET' }),
        apiFetch('/v1/admin/config', { method: 'GET' }),
      ])
      const uJson = await uRes.json()
      const mJson = await mRes.json()
      const cJson = await cRes.json()
      setAdminUsers(Array.isArray(uJson?.users) ? uJson.users : [])
      setAdminMessages(Array.isArray(mJson?.messages) ? mJson.messages : [])
      setAdminConfig(cJson || null)
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function saveAdminConfig(nextCfg) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch('/v1/admin/config', { method: 'POST', body: JSON.stringify(nextCfg) })
      setStatus({ kind: 'ok', text: 'Settings saved.' })
      setAdminConfig(nextCfg)
      await loadPublicConfig()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function adminMark(id, read) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const endpoint = read ? `/v1/admin/contact-messages/${encodeURIComponent(id)}/read` : `/v1/admin/contact-messages/${encodeURIComponent(id)}/unread`
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) })
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function adminDeleteMsg(id) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch(`/v1/admin/contact-messages/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function sendSupportMessage({ subject, message }) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const name = String(me?.displayName || '').trim() || 'User'
      const email = String(me?.email || '').trim()
      const subj = String(subject || '').trim() || 'Support request'
      const msg = String(message || '').trim()
      if (!email || !msg) throw new Error('Missing fields')
      const res = await fetch('/v1/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, subject: subj, message: msg }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(j?.error || `HTTP ${res.status}`))
      setStatus({ kind: 'ok', text: 'Message sent.' })
    } catch (e) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'err', text: msg === 'Missing fields' ? 'Message is required.' : msg })
    } finally {
      setBusy(false)
    }
  }

  function updateAdminModal(patch) {
    setAdminModal((m) => {
      if (!m) return m
      return { ...m, ...patch }
    })
  }

  function closeAdminModal() {
    setAdminModal(null)
  }

  function openPasswordModal(user) {
    setStatus({ kind: 'muted', text: '' })
    setAdminModal({ kind: 'password', user, password: '', confirm: '' })
  }

  function openGrantModal(user) {
    setStatus({ kind: 'muted', text: '' })
    setAdminModal({ kind: 'grant', user, planCode: String(user?.kivanaPlanCode || 'basic') || 'basic', endsAtLocal: '' })
  }

  function openDiscountModal(user) {
    setStatus({ kind: 'muted', text: '' })
    const pct = user?.discountPercent != null ? String(user.discountPercent) : '0'
    const label = user?.discountLabel != null ? String(user.discountLabel) : ''
    setAdminModal({ kind: 'discount', user, percent: pct, label })
  }

  function openDeleteUserModal(user) {
    setStatus({ kind: 'muted', text: '' })
    setAdminModal({ kind: 'deleteUser', user })
  }

  async function adminSetPassword(userId, password) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch(`/v1/admin/users/${encodeURIComponent(String(userId))}/password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setStatus({ kind: 'ok', text: 'Password updated.' })
      closeAdminModal()
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function adminGrantPlan(email, planCode, endsAtLocal) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const endsAt = (() => {
        const s = String(endsAtLocal || '').trim()
        if (!s) return null
        const d = new Date(s)
        if (!Number.isFinite(d.getTime())) throw new Error('Invalid date')
        return d.toISOString()
      })()
      await apiFetch('/v1/admin/grant', {
        method: 'POST',
        body: JSON.stringify({ email, productCode: 'kivana', planCode, endsAt }),
      })
      setStatus({ kind: 'ok', text: 'Subscription updated.' })
      closeAdminModal()
      await loadAdmin()
    } catch (e) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'err', text: msg === 'Invalid date' ? 'Invalid ends date/time.' : msg })
    } finally {
      setBusy(false)
    }
  }

  async function adminSetDiscount(email, percent, label) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const pct = Number(String(percent || '0').trim() || '0')
      if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
        throw new Error('invalid_discount')
      }
      const lab = String(label || '').trim()
      await apiFetch('/v1/admin/discount', {
        method: 'POST',
        body: JSON.stringify({ email, percent: Math.round(pct), label: lab ? lab : null }),
      })
      setStatus({ kind: 'ok', text: 'Discount updated.' })
      closeAdminModal()
      await loadAdmin()
    } catch (e) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'err', text: msg === 'invalid_discount' ? 'Discount must be 0–90.' : msg })
    } finally {
      setBusy(false)
    }
  }

  async function adminToggleModerator(email, enabled) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch('/v1/admin/moderator', {
        method: 'POST',
        body: JSON.stringify({ email, enabled: !!enabled }),
      })
      setStatus({ kind: 'ok', text: 'Moderator updated.' })
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function adminDeleteUser(userId) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch(`/v1/admin/users/${encodeURIComponent(String(userId))}`, { method: 'DELETE' })
      setStatus({ kind: 'ok', text: 'User deleted.' })
      closeAdminModal()
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  function AdminModal() {
    if (!adminModal) return null
    const kind = String(adminModal.kind || '')
    const user = adminModal.user || {}
    const email = String(user.email || '')
    const title =
      kind === 'password'
        ? `Set password (${email})`
        : kind === 'grant'
          ? `Set subscription (${email})`
          : kind === 'discount'
            ? `Set discount (${email})`
            : kind === 'deleteUser'
              ? `Delete user (${email})`
              : 'Admin'

    const body =
      kind === 'password'
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'New password (min 8 chars)'),
            React.createElement('input', {
              className:
                'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              type: 'password',
              value: String(adminModal.password || ''),
              onChange: (e) => updateAdminModal({ password: e.target.value }),
              disabled: busy,
              autoComplete: 'new-password',
            }),
            React.createElement('div', { style: { height: 10 } }),
            React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Confirm password'),
            React.createElement('input', {
              className:
                'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              type: 'password',
              value: String(adminModal.confirm || ''),
              onChange: (e) => updateAdminModal({ confirm: e.target.value }),
              disabled: busy,
              autoComplete: 'new-password',
            })
          )
        : kind === 'grant'
          ? React.createElement(
              React.Fragment,
              null,
              React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Plan'),
              React.createElement(
                'select',
                {
                  className:
                    'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                  value: String(adminModal.planCode || 'basic'),
                  onChange: (e) => updateAdminModal({ planCode: e.target.value }),
                  disabled: busy,
                },
                React.createElement('option', { value: 'basic' }, 'Basic'),
                React.createElement('option', { value: 'standard' }, 'Ordinary'),
                React.createElement('option', { value: 'pro' }, 'Pro'),
                React.createElement('option', { value: 'lifetime_pro' }, 'Lifetime')
              ),
              React.createElement('div', { style: { height: 10 } }),
              React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Ends at (optional)'),
              React.createElement('input', {
                className:
                  'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                type: 'datetime-local',
                value: String(adminModal.endsAtLocal || ''),
                onChange: (e) => updateAdminModal({ endsAtLocal: e.target.value }),
                disabled: busy,
              }),
              React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'Leave empty for no end date. Uses your local time.')
            )
          : kind === 'discount'
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Percent (0–90)'),
                React.createElement('input', {
                  className:
                    'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                  type: 'number',
                  min: 0,
                  max: 90,
                  step: 1,
                  value: String(adminModal.percent || '0'),
                  onChange: (e) => updateAdminModal({ percent: e.target.value }),
                  disabled: busy,
                }),
                React.createElement('div', { style: { height: 10 } }),
                React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Label (optional)'),
                React.createElement('input', {
                  className:
                    'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                  type: 'text',
                  value: String(adminModal.label || ''),
                  onChange: (e) => updateAdminModal({ label: e.target.value }),
                  disabled: busy,
                  placeholder: 'founder',
                }),
                React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'Set percent to 0 to remove the discount.')
              )
            : kind === 'deleteUser'
              ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement('div', { className: 'text-sm text-gray-600' }, 'This permanently deletes the user and their sessions.'),
                  React.createElement('div', { style: { height: 10 } }),
                  React.createElement('div', { className: 'text-sm text-gray-600' }, 'Type DELETE to confirm:'),
                  React.createElement('input', {
                    className:
                      'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                    type: 'text',
                    value: String(adminModal.confirmText || ''),
                    onChange: (e) => updateAdminModal({ confirmText: e.target.value }),
                    disabled: busy,
                    placeholder: 'DELETE',
                  })
                )
              : null

    const confirmLabel = kind === 'deleteUser' ? 'Delete' : 'Save'
    const confirmKind =
      kind === 'deleteUser'
        ? 'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none'
        : 'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none'

    const onConfirm = async () => {
      if (kind === 'password') {
        const p1 = String(adminModal.password || '')
        const p2 = String(adminModal.confirm || '')
        if (p1.length < 8) {
          setStatus({ kind: 'err', text: 'Password must be at least 8 characters.' })
          return
        }
        if (p1 !== p2) {
          setStatus({ kind: 'err', text: 'Passwords do not match.' })
          return
        }
        await adminSetPassword(user.id, p1)
        return
      }
      if (kind === 'grant') {
        const planCode = String(adminModal.planCode || 'basic').trim().toLowerCase()
        await adminGrantPlan(email, planCode, adminModal.endsAtLocal)
        return
      }
      if (kind === 'discount') {
        await adminSetDiscount(email, adminModal.percent, adminModal.label)
        return
      }
      if (kind === 'deleteUser') {
        if (String(adminModal.confirmText || '').trim().toUpperCase() !== 'DELETE') {
          setStatus({ kind: 'err', text: 'Type DELETE to confirm.' })
          return
        }
        await adminDeleteUser(user.id)
      }
    }

    return React.createElement(
      'div',
      {
        className: 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6',
        onClick: () => closeAdminModal(),
        role: 'dialog',
        'aria-modal': 'true',
      },
      React.createElement(
        'div',
        {
          className: 'w-full max-w-xl rounded-3xl bg-white shadow-xl border border-gray-100',
          onClick: (e) => e.stopPropagation(),
        },
        React.createElement(
          'div',
          { className: 'px-6 py-5 flex items-center justify-between gap-4 border-b border-gray-100' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, title),
          React.createElement(
            'button',
            {
              className:
                'w-10 h-10 rounded-full border border-gray-200 text-[#1B1748] hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: closeAdminModal,
              disabled: busy,
            },
            '×'
          )
        ),
        React.createElement('div', { className: 'px-6 py-6' }, body),
        React.createElement(
          'div',
          { className: 'px-6 pb-6 flex items-center justify-end gap-3' },
          React.createElement(
            'button',
            {
              className:
                'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: closeAdminModal,
              disabled: busy,
            },
            'Cancel'
          ),
          React.createElement('button', { className: confirmKind, type: 'button', onClick: onConfirm, disabled: busy }, busy ? 'Working…' : confirmLabel)
        )
      )
    )
  }

  function Topbar() {
    const planCode = entitlement ? String(entitlement.planCode || '').toLowerCase() : ''
    const planName = entitlement ? String(entitlement.planName || '').trim() : ''
    const isTrial = !!entitlement?.isTrial
    const statusText = isTrial ? 'Trial' : planName || normalizePlanLabel(planCode)
    const who = me ? String(me.displayName || '').trim() || String(me.email || '').trim() : ''
    const initial = who ? who.slice(0, 1).toUpperCase() : 'K'

    return React.createElement(
      'header',
      { className: `sticky top-0 z-50 bg-white border-b border-gray-100 transition-shadow duration-300 ${navScrolled ? 'shadow-sm' : ''}` },
      React.createElement(
        'div',
        { className: 'max-w-7xl mx-auto px-6 lg:px-10 py-4 flex items-center justify-between gap-4' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-4' },
          React.createElement(
            'div',
            {
              className: 'flex items-center gap-2 cursor-pointer select-none',
              onClick: () => {
                window.location.href = '/'
              },
              role: 'button',
              tabIndex: 0,
            },
            React.createElement('img', { className: 'w-9 h-9 object-contain', src: '/kivana-logo.png', alt: 'Kivana' }),
            React.createElement('span', { className: 'text-2xl font-bold text-[#1B1748] tracking-tight', style: { fontFamily: 'Lora, serif' } }, 'kivana')
          ),
          React.createElement(
            'div',
            { className: 'hidden md:flex items-center gap-2 text-sm text-gray-600' },
            React.createElement('a', { href: '/', className: 'hover:text-[#4F3DDD] font-semibold' }, 'Website'),
            React.createElement('span', null, '/'),
            React.createElement('span', { className: 'font-semibold text-[#1B1748]' }, 'Account portal')
          )
        ),
        React.createElement(
          'div',
          { className: 'flex items-center gap-3 justify-end' },
          me
            ? React.createElement(
                React.Fragment,
                null,
                statusText ? React.createElement(Pill, { kind: 'ok' }, statusText) : null,
                React.createElement(
                  'div',
                  { className: 'hidden sm:flex items-center gap-3 rounded-full border border-gray-200 bg-white px-3 py-2' },
                  React.createElement('div', { className: 'w-8 h-8 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center font-bold text-sm' }, initial),
                  React.createElement(
                    'div',
                    { className: 'leading-tight' },
                    React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, String(me.displayName || '')),
                    React.createElement('div', { className: 'text-xs text-gray-600 -mt-0.5' }, String(me.email || ''))
                  )
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-[#1B1748] hover:bg-[#16123C] disabled:opacity-60 disabled:pointer-events-none',
                    onClick: signOut,
                    disabled: busy,
                    type: 'button',
                  },
                  'Sign out'
                )
              )
            : React.createElement(
                React.Fragment,
                null,
                React.createElement(
                  'button',
                  {
                    className:
                      'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                    onClick: () => setAuthMode('login'),
                    disabled: busy,
                    type: 'button',
                  },
                  'Sign in'
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
                    onClick: () => setAuthMode('signup'),
                    disabled: busy,
                    type: 'button',
                  },
                  'Create account'
                )
              )
        )
      )
    )
  }

  function AuthCard() {
    const title = authMode === 'signup' ? 'Create an account' : 'Sign in'
    const sub =
      authMode === 'signup'
        ? 'Create your account, then choose a plan.'
        : 'Sign in to manage your subscription and account.'
    const toggleText = authMode === 'signup' ? 'Already have an account?' : "Don't have an account?"
    const toggleBtn = authMode === 'signup' ? 'Sign in' : 'Create one'

    return React.createElement(
      'div',
      { className: 'grid grid-cols-1 lg:grid-cols-2 gap-8' },
      React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement(
          'div',
          { className: 'flex items-center justify-between gap-4' },
          React.createElement(
            'div',
            { className: 'flex items-center gap-3' },
            React.createElement('img', { src: '/kivana-logo.png', alt: 'Kivana', className: 'w-12 h-12 object-contain' }),
            React.createElement(
              'div',
              null,
              React.createElement(
                'div',
                { className: 'text-2xl font-bold text-[#1B1748] tracking-tight', style: { fontFamily: 'Lora, serif' } },
                'kivana'
              ),
              React.createElement('div', { className: 'text-sm text-gray-600 -mt-0.5' }, 'Account portal')
            )
          ),
          React.createElement(Pill, { kind: authMode === 'signup' ? 'ok' : 'muted' }, authMode === 'signup' ? 'New account' : 'Welcome back')
        ),
        React.createElement('div', { className: 'mt-6 text-3xl font-bold text-[#1B1748] tracking-tight' }, title),
        React.createElement('div', { className: 'mt-2 text-[15px] text-gray-600' }, sub),
        React.createElement(
          'form',
          { className: 'mt-7 grid gap-5', onSubmit: submitAuth },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Email'),
            React.createElement('input', {
              className:
                'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              type: 'email',
              value: email,
              onChange: (e) => setEmail(e.target.value),
              autoComplete: 'email',
              placeholder: 'you@example.com',
              disabled: busy,
            })
          ),
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Password'),
            React.createElement('input', {
              className:
                'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              type: 'password',
              value: password,
              onChange: (e) => setPassword(e.target.value),
              autoComplete: authMode === 'signup' ? 'new-password' : 'current-password',
              placeholder: '••••••••',
              disabled: busy,
            })
          ),
          React.createElement(
            'button',
            {
              className:
                'w-full px-5 py-3 rounded-full text-[15px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
              type: 'submit',
              disabled: busy,
            },
            busy ? 'Working…' : 'Continue'
          ),
          React.createElement(
            'div',
            { className: 'text-sm text-gray-600' },
            React.createElement('span', null, toggleText),
            ' ',
            React.createElement(
              'button',
              {
                className: 'text-sm font-semibold text-[#4F3DDD] hover:underline',
                type: 'button',
                onClick: () => setAuthMode(authMode === 'signup' ? 'login' : 'signup'),
                disabled: busy,
              },
              toggleBtn
            )
          ),
          status.text
            ? React.createElement(
                'div',
                { className: `text-sm ${status.kind === 'err' ? 'text-red-600' : status.kind === 'ok' ? 'text-emerald-700' : 'text-gray-600'}` },
                status.text
              )
            : null
        )
      ),
      React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Pricing'),
        React.createElement(
          'div',
          { className: 'mt-2 text-[15px] text-gray-600' },
          `Currency auto-detected: ${pricing.code}. UK shows GBP, Scandinavia shows NOK, everyone else EUR.`
        ),
        React.createElement(
          'div',
          { className: 'mt-6 flex items-center gap-3 flex-wrap' },
          React.createElement(
            'button',
            {
              className: `px-4 py-2 rounded-full border-2 text-[13px] font-semibold transition-colors ${
                billingCycle === 'yearly' ? 'border-[#4F3DDD] bg-[#F0EEFC] text-[#4F3DDD]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              } disabled:opacity-60 disabled:pointer-events-none`,
              type: 'button',
              onClick: () => setBillingCycle('yearly'),
              disabled: busy,
            },
            'Yearly'
          ),
          React.createElement(
            'button',
            {
              className: `px-4 py-2 rounded-full border-2 text-[13px] font-semibold transition-colors ${
                billingCycle === 'monthly' ? 'border-[#4F3DDD] bg-[#F0EEFC] text-[#4F3DDD]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              } disabled:opacity-60 disabled:pointer-events-none`,
              type: 'button',
              onClick: () => setBillingCycle('monthly'),
              disabled: busy,
            },
            'Monthly'
          )
        ),
        React.createElement(
          'div',
          { className: 'mt-6 grid gap-4' },
          React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
            React.createElement('div', { className: 'flex items-center justify-between gap-4' }, React.createElement('div', { className: 'text-lg font-bold' }, 'Basic'), React.createElement(Pill, { kind: 'ok' }, 'Free')),
            React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'Try Basic for free. Ordinary/Pro coming soon.'),
            React.createElement('div', { className: 'mt-4 text-sm text-gray-600' }, 'Included by default after signup.')
          ),
          React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
            React.createElement('div', { className: 'flex items-center justify-between gap-4' }, React.createElement('div', { className: 'text-lg font-bold' }, 'Ordinary'), React.createElement(Pill, { kind: 'warn' }, 'Coming soon')),
            React.createElement(
              'div',
              { className: 'mt-3 flex items-baseline gap-2 flex-wrap' },
              React.createElement('div', { className: 'text-2xl font-extrabold tracking-tight' }, formatMoney(pricing, billingCycle === 'yearly' ? yearlyStd : monthlyStd)),
              React.createElement('div', { className: 'text-sm text-gray-600' }, billingCycle === 'yearly' ? '/yr (1 month free)' : '/mo')
            ),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, billingCycle === 'yearly' ? `${formatMoney(pricing, monthlyStd)}/mo` : `${formatMoney(pricing, yearlyStd)}/yr (1 month free)`),
            React.createElement(
              'button',
              {
                className:
                  'mt-4 px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                type: 'button',
                onClick: () => selectPlan('standard'),
                disabled: busy || !me,
              },
              me ? 'Select Ordinary' : 'Sign in to select'
            )
          ),
          React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
            React.createElement('div', { className: 'flex items-center justify-between gap-4' }, React.createElement('div', { className: 'text-lg font-bold' }, 'Pro'), React.createElement(Pill, { kind: 'warn' }, 'Coming soon')),
            React.createElement(
              'div',
              { className: 'mt-3 flex items-baseline gap-2 flex-wrap' },
              React.createElement('div', { className: 'text-2xl font-extrabold tracking-tight' }, formatMoney(pricing, billingCycle === 'yearly' ? yearlyPro : monthlyPro)),
              React.createElement('div', { className: 'text-sm text-gray-600' }, billingCycle === 'yearly' ? '/yr (1 month free)' : '/mo')
            ),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, billingCycle === 'yearly' ? `${formatMoney(pricing, monthlyPro)}/mo` : `${formatMoney(pricing, yearlyPro)}/yr (1 month free)`),
            React.createElement(
              'button',
              {
                className:
                  'mt-4 px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                type: 'button',
                onClick: () => selectPlan('pro'),
                disabled: busy || !me,
              },
              me ? 'Select Pro' : 'Sign in to select'
            )
          )
        )
      )
    )
  }

  function Dashboard() {
    const planCode = entitlement ? String(entitlement.planCode || '').trim().toLowerCase() : 'basic'
    const planName = entitlement ? String(entitlement.planName || '').trim() : ''
    const isTrial = !!entitlement?.isTrial
    const trialEligible = entitlement ? !!entitlement.trialEligible : false
    const endsAt = entitlement && entitlement.endsAt ? String(entitlement.endsAt) : ''
    const trialEndsAt = entitlement && entitlement.trialEndsAt ? String(entitlement.trialEndsAt) : ''
    const currentKey = isTrial ? 'trial' : planCode || 'basic'

    const memberSince = me?.createdAt ? formatRfc3339Short(me.createdAt) : '—'
    const renews = isTrial ? (trialEndsAt ? formatRfc3339Short(trialEndsAt) : '—') : endsAt ? formatRfc3339Short(endsAt) : '—'
    const planLabel = isTrial ? 'Ordinary' : planName || normalizePlanLabel(planCode) || 'Basic'

    function NavItem({ id, label, icon }) {
      const active = section === id
      return React.createElement(
        'button',
        {
          type: 'button',
          onClick: async () => {
            setSection(id)
            if (id === 'admin') await loadAdmin()
          },
          className: `w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[14px] font-semibold transition-colors ${
            active ? 'bg-[#F0EEFC] text-[#4F3DDD]' : 'text-gray-700 hover:bg-gray-50'
          }`,
          disabled: busy,
        },
        React.createElement('span', { className: 'w-5 h-5 text-current' }, icon),
        React.createElement('span', null, label)
      )
    }

    const userInitial = (() => {
      const who = String(me?.displayName || '').trim() || String(me?.email || '').trim()
      return who ? who.slice(0, 1).toUpperCase() : 'K'
    })()

    const SectionCard = ({ title, subtitle, children }) =>
      React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, title),
        subtitle ? React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, subtitle) : null,
        React.createElement('div', { className: 'mt-6' }, children)
      )

    function ProfileSection() {
      return SectionCard({
        title: 'Profile',
        subtitle: 'Used in receipts and the desktop app header.',
        children: React.createElement(
          'div',
          { className: 'grid grid-cols-1 md:grid-cols-[140px_1fr] gap-6 items-start' },
          React.createElement(
            'div',
            { className: 'flex items-center gap-4' },
            React.createElement('div', { className: 'w-16 h-16 rounded-2xl bg-emerald-200 text-emerald-800 flex items-center justify-center font-extrabold text-xl' }, userInitial)
          ),
          React.createElement(
            'div',
            { className: 'grid gap-5' },
            React.createElement(
              'div',
              null,
              React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'DISPLAY NAME'),
              React.createElement('input', {
                ref: displayNameInputRef,
                defaultValue: String(me?.displayName || ''),
                disabled: busy,
                className:
                  'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                placeholder: 'Full name',
              })
            ),
            React.createElement(
              'div',
              null,
              React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'EMAIL'),
              React.createElement('input', {
                value: String(me?.email || ''),
                disabled: true,
                readOnly: true,
                className: 'mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] text-gray-700',
              })
            ),
            React.createElement(
              'div',
              { className: 'flex items-center gap-3 flex-wrap' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: saveProfile,
                  disabled: busy,
                  className:
                    'px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
                },
                busy ? 'Saving…' : 'Save profile'
              )
            )
          )
        ),
      })
    }

    function BillingSection() {
      const ActiveBadge = () =>
        React.createElement(
          'div',
          { className: 'inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-[#1B1748] border border-white/40' },
          React.createElement('span', { className: 'w-2 h-2 rounded-full bg-emerald-500' }),
          'ACTIVE PLAN'
        )

      const PlanCard = ({ id, title, price, meta, actionLabel, disabled, tone }) => {
        const active = currentKey === id
        const dark = tone === 'dark' || active
        return React.createElement(
          'div',
          {
            className: `rounded-3xl border ${dark ? 'border-[#1B1748] bg-[#1B1748] text-white' : 'border-gray-100 bg-white'} p-6`,
          },
          React.createElement('div', { className: `text-[11px] tracking-wide font-extrabold ${dark ? 'text-white/70' : 'text-gray-500'}` }, title.toUpperCase()),
          React.createElement('div', { className: `mt-2 text-xl font-extrabold ${dark ? 'text-white' : 'text-[#1B1748]'}` }, price || title),
          meta ? React.createElement('div', { className: `mt-1 text-sm ${dark ? 'text-white/70' : 'text-gray-600'}` }, meta) : null,
          React.createElement(
            'div',
            { className: 'mt-5' },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => {
                  if (!disabled && !active) selectPlan(id)
                },
                disabled: disabled || active || busy,
                className: `w-full px-5 py-2.5 rounded-full text-[14px] font-semibold disabled:opacity-60 disabled:pointer-events-none ${
                  dark
                    ? 'bg-white text-[#1B1748] hover:bg-white/90'
                    : 'bg-[#F0EEFC] text-[#4F3DDD] hover:bg-[#E6E3FB]'
                }`,
              },
              active ? 'Current' : actionLabel
            )
          )
        )
      }

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-[#F6F3FF] p-7' },
          React.createElement(
            'div',
            { className: 'flex items-start justify-between gap-4 flex-wrap' },
            React.createElement(
              'div',
              null,
              React.createElement(ActiveBadge, null),
              React.createElement(
                'div',
                { className: 'mt-3 flex items-baseline gap-2 flex-wrap' },
                React.createElement('div', { className: 'text-2xl font-extrabold text-[#1B1748]' }, planLabel),
                isTrial ? React.createElement('div', { className: 'text-sm text-gray-600' }, 'trial') : null
              ),
              React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, `Renews ${renews}`)
            ),
            React.createElement(
              'div',
              { className: 'flex items-center gap-3 flex-wrap' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: loadEntitlements,
                  disabled: busy,
                  className:
                    'px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                },
                'Refresh entitlements'
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  disabled: true,
                  className:
                    'px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 opacity-60 cursor-not-allowed',
                },
                'Manage billing'
              )
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'mt-6 flex items-center gap-3 flex-wrap' },
          React.createElement(
            'button',
            {
              className: `px-4 py-2 rounded-full border-2 text-[13px] font-semibold transition-colors ${
                billingCycle === 'yearly' ? 'border-[#4F3DDD] bg-[#F0EEFC] text-[#4F3DDD]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              } disabled:opacity-60 disabled:pointer-events-none`,
              type: 'button',
              onClick: () => setBillingCycle('yearly'),
              disabled: busy,
            },
            'Yearly'
          ),
          React.createElement(
            'button',
            {
              className: `px-4 py-2 rounded-full border-2 text-[13px] font-semibold transition-colors ${
                billingCycle === 'monthly' ? 'border-[#4F3DDD] bg-[#F0EEFC] text-[#4F3DDD]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              } disabled:opacity-60 disabled:pointer-events-none`,
              type: 'button',
              onClick: () => setBillingCycle('monthly'),
              disabled: busy,
            },
            'Monthly'
          )
        ),
        React.createElement(
          'div',
          { className: 'mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4' },
          cfgPricing?.showBasic !== false
            ? React.createElement(PlanCard, { id: 'basic', title: 'Basic', price: 'Free', meta: 'Local-only, no account features', actionLabel: 'Choose', disabled: false })
            : null,
          cfgPricing?.showTrial !== false
            ? React.createElement(PlanCard, {
                id: 'trial',
                title: 'Trial',
                price: `${trialDays} days free`,
                meta: 'Try Ordinary',
                actionLabel: trialEligible ? 'Choose' : isTrial ? 'Current' : 'Not available',
                disabled: !trialEligible && !isTrial,
              })
            : null,
          cfgPricing?.showStandard !== false
            ? React.createElement(PlanCard, {
                id: 'standard',
                title: 'Ordinary',
                price: `${formatMoney(pricing, billingCycle === 'yearly' ? yearlyStd : monthlyStd)}${billingCycle === 'yearly' ? '/yr' : '/mo'}`,
                meta: billingCycle === 'yearly' ? `Yearly • ${formatMoney(pricing, monthlyStd)}/mo` : `Monthly • ${formatMoney(pricing, yearlyStd)}/yr`,
                actionLabel: 'Choose',
                disabled: false,
                tone: currentKey === 'standard' ? 'dark' : undefined,
              })
            : null,
          cfgPricing?.showPro !== false
            ? React.createElement(PlanCard, {
                id: 'pro',
                title: 'Pro',
                price: `${formatMoney(pricing, billingCycle === 'yearly' ? yearlyPro : monthlyPro)}${billingCycle === 'yearly' ? '/yr' : '/mo'}`,
                meta: billingCycle === 'yearly' ? `Yearly • ${formatMoney(pricing, monthlyPro)}/mo` : `Monthly • ${formatMoney(pricing, yearlyPro)}/yr`,
                actionLabel: 'Choose',
                disabled: false,
                tone: currentKey === 'pro' ? 'dark' : undefined,
              })
            : null,
          cfgPricing?.showAccountant !== false
            ? React.createElement(PlanCard, { id: 'lifetime_pro', title: 'Accountant', price: 'On demand', meta: 'No subscription required', actionLabel: 'Choose', disabled: false })
            : null
        )
      )
    }

    function DownloadsSection() {
      const releaseUrl = 'https://github.com/kivana-software/Kivana/releases/latest'
      const DlCard = ({ title, sub, href }) =>
        React.createElement(
          'a',
          {
            href,
            target: '_blank',
            rel: 'noopener',
            className: 'block rounded-3xl border border-gray-100 bg-white p-6 hover:bg-gray-50 transition-colors',
          },
          React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, title),
          React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, sub)
        )

      return SectionCard({
        title: 'Downloads',
        subtitle: 'Get the desktop app. Your license unlocks features automatically when signed in.',
        children: React.createElement(
          'div',
          { className: 'grid grid-cols-1 md:grid-cols-3 gap-4' },
          React.createElement(DlCard, { title: 'macOS', sub: 'Apple Silicon • v0.4.15', href: releaseUrl }),
          React.createElement(DlCard, { title: 'Windows', sub: 'x64 • v0.4.15', href: releaseUrl }),
          React.createElement(DlCard, { title: 'All releases', sub: 'GitHub • changelog', href: releaseUrl })
        ),
      })
    }

    function SecuritySection() {
      const changedAt = me?.passwordChangedAt ? new Date(String(me.passwordChangedAt)) : null
      const daysAgo = (() => {
        if (!changedAt || !Number.isFinite(changedAt.getTime())) return null
        const diff = Date.now() - changedAt.getTime()
        const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
        return days
      })()

      const sessionsCount = Array.isArray(sessions) ? sessions.length : 0

      const SessionRow = (s) => {
        const ua = String(s?.userAgent || '').trim()
        const ip = String(s?.clientIp || '').trim()
        const label = ua ? ua.split(') ')[0].slice(0, 80) : 'Unknown device'
        const lastUsed = s?.lastUsedAt ? formatRfc3339Short(s.lastUsedAt) : ''
        return React.createElement(
          'div',
          { key: String(s?.id || ''), className: 'flex items-center justify-between gap-4 py-3 border-t border-gray-100' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-sm font-semibold text-[#1B1748]' }, label),
            React.createElement(
              'div',
              { className: 'text-xs text-gray-600 mt-0.5' },
              `${ip ? ip + ' • ' : ''}${lastUsed ? 'Last used ' + lastUsed : ''}`
            )
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => revokeSession(String(s?.id || '')),
              disabled: busy,
              className:
                'px-4 py-2 rounded-full text-[12px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
            },
            'Sign out'
          )
        )
      }

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm' },
          React.createElement(
            'div',
            { className: 'p-8' },
            React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Security'),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Account password and sessions.'),
            React.createElement(
              'div',
              { className: 'mt-6 grid gap-4' },
              React.createElement(
                'div',
                { className: 'rounded-2xl border border-gray-100 px-5 py-4 flex items-center justify-between gap-4' },
                React.createElement(
                  'div',
                  null,
                  React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Password'),
                  React.createElement('div', { className: 'text-xs text-gray-600 mt-0.5' }, daysAgo == null ? 'Last changed —' : `Last changed ${daysAgo} days ago`)
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setPwModal({ current: '', next: '', confirm: '' }),
                    disabled: busy,
                    className:
                      'px-5 py-2.5 rounded-full text-[13px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                  },
                  'Change'
                )
              ),
              React.createElement(
                'div',
                { className: 'rounded-2xl border border-gray-100 px-5 py-4 flex items-center justify-between gap-4' },
                React.createElement(
                  'div',
                  null,
                  React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Active sessions'),
                  React.createElement('div', { className: 'text-xs text-gray-600 mt-0.5' }, `${sessionsCount} sessions`)
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: signOutAll,
                    disabled: busy || sessionsCount === 0,
                    className:
                      'px-5 py-2.5 rounded-full text-[13px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                  },
                  'Sign out all'
                )
              ),
              React.createElement(
                'div',
                { className: 'rounded-2xl border border-gray-100 px-5 py-1' },
                sessionsCount ? sessions.map(SessionRow) : React.createElement('div', { className: 'py-4 text-sm text-gray-600' }, 'No active sessions.')
              )
            )
          )
        )
      )
    }

    function DataSection() {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'My data'),
          React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'This section only covers your account profile and subscription.'),
          React.createElement(
            'div',
            { className: 'mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4' },
            React.createElement(
              'div',
              { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
              React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Export account info'),
              React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, 'Download a JSON of your profile, plan and active sessions.'),
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: exportAccount,
                  disabled: busy,
                  className:
                    'mt-4 px-5 py-2.5 rounded-full text-[14px] font-semibold text-white bg-[#1B1748] hover:bg-[#16123C] disabled:opacity-60 disabled:pointer-events-none',
                },
                'Export'
              )
            ),
            React.createElement(
              'div',
              { className: 'rounded-3xl border border-red-200 bg-red-50 p-6' },
              React.createElement('div', { className: 'text-sm font-bold text-red-700' }, 'Delete account'),
              React.createElement('div', { className: 'mt-1 text-xs text-red-700/80' }, 'Removes your account and cloud-side records. Your local vault remains untouched.'),
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => setDeleteModal({ password: '', confirmText: '' }),
                  disabled: busy,
                  className:
                    'mt-4 px-5 py-2.5 rounded-full text-[14px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
                },
                'Delete'
              )
            )
          )
        )
      )
    }

    function SupportSection() {
      const [subject, setSubject] = useState('')
      const [message, setMessage] = useState('')
      const canSend = String(message || '').trim().length > 0

      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Contact support'),
        React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Send a message to the team from inside the portal.'),
        React.createElement(
          'div',
          { className: 'mt-6 grid gap-4' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'SUBJECT'),
            React.createElement('input', {
              className:
                'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              value: subject,
              onChange: (e) => setSubject(e.target.value),
              disabled: busy,
              placeholder: 'Support request',
            })
          ),
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'MESSAGE'),
            React.createElement('textarea', {
              className:
                'mt-2 w-full min-h-[140px] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              value: message,
              onChange: (e) => setMessage(e.target.value),
              disabled: busy,
              placeholder: 'Write your message…',
            })
          ),
          React.createElement(
            'div',
            { className: 'flex items-center justify-end gap-3' },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: async () => {
                  await sendSupportMessage({ subject, message })
                  setSubject('')
                  setMessage('')
                },
                disabled: busy || !canSend,
                className:
                  'px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
              },
              'Send'
            )
          )
        )
      )
    }

    function CurrentSection() {
      if (section === 'profile') return React.createElement(ProfileSection, null)
      if (section === 'billing') return React.createElement(SectionCard, { title: 'Plan & billing', subtitle: 'Switch tiers anytime. Your finance data is unaffected.' }, React.createElement(BillingSection, null))
      if (section === 'downloads') return React.createElement(DownloadsSection, null)
      if (section === 'security') return React.createElement(SecuritySection, null)
      if (section === 'support') return React.createElement(SupportSection, null)
      if (section === 'data') return React.createElement(DataSection, null)
      if (section === 'admin') return React.createElement(Admin, null)
      return React.createElement(ProfileSection, null)
    }

    return React.createElement(
      'div',
      { className: 'flex flex-col lg:flex-row gap-8' },
      React.createElement(
        'aside',
        { className: 'w-full lg:w-[260px] shrink-0' },
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-2' },
          React.createElement(NavItem, {
            id: 'profile',
            label: 'Profile',
            icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Z', stroke: 'currentColor', strokeWidth: 1.8 }), React.createElement('path', { d: 'M4.5 20c1.8-3.2 5.1-5 7.5-5s5.7 1.8 7.5 5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })),
          }),
          React.createElement(NavItem, {
            id: 'billing',
            label: 'Plan & billing',
            icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M4 8.5C4 7.12 5.12 6 6.5 6H17.5C18.88 6 20 7.12 20 8.5V15.5C20 16.88 18.88 18 17.5 18H6.5C5.12 18 4 16.88 4 15.5V8.5Z', stroke: 'currentColor', strokeWidth: 1.8 }), React.createElement('path', { d: 'M4 10h16', stroke: 'currentColor', strokeWidth: 1.8 })),
          }),
          React.createElement(NavItem, {
            id: 'downloads',
            label: 'Downloads',
            icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M12 3v10', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }), React.createElement('path', { d: 'M8 11l4 4 4-4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }), React.createElement('path', { d: 'M5 20h14', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })),
          }),
          React.createElement(NavItem, {
            id: 'security',
            label: 'Security',
            icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M7.5 11V8.5C7.5 6.02 9.52 4 12 4C14.48 4 16.5 6.02 16.5 8.5V11', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }), React.createElement('path', { d: 'M7 11H17C18.1 11 19 11.9 19 13V18C19 19.1 18.1 20 17 20H7C5.9 20 5 19.1 5 18V13C5 11.9 5.9 11 7 11Z', stroke: 'currentColor', strokeWidth: 1.8 })),
          }),
          React.createElement(NavItem, {
            id: 'support',
            label: 'Contact support',
            icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M4 6.5C4 5.12 5.12 4 6.5 4H17.5C18.88 4 20 5.12 20 6.5V15.5C20 16.88 18.88 18 17.5 18H9l-5 3v-3.5C4 16.12 4 6.5 4 6.5Z', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }), React.createElement('path', { d: 'M7 8h10M7 11h8', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })),
          }),
          React.createElement(NavItem, {
            id: 'data',
            label: 'My data',
            icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M6 7c0-1.66 2.69-3 6-3s6 1.34 6 3-2.69 3-6 3-6-1.34-6-3Z', stroke: 'currentColor', strokeWidth: 1.8 }), React.createElement('path', { d: 'M6 7v10c0 1.66 2.69 3 6 3s6-1.34 6-3V7', stroke: 'currentColor', strokeWidth: 1.8 })),
          }),
          me?.isAdmin
            ? React.createElement(NavItem, {
                id: 'admin',
                label: 'Admin',
                icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M12 2l3 7h7l-5.5 4 2.5 7-7-4.5L5 20l2.5-7L2 9h7l3-7Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' })),
              })
            : null
        )
      ),
      React.createElement(
        'div',
        { className: 'flex-1 min-w-0' },
        React.createElement('div', { className: 'text-3xl font-extrabold text-[#1B1748]', style: { fontFamily: 'Lora, serif' } }, 'Account portal'),
        React.createElement(
          'div',
          { className: 'mt-2 text-[15px] text-gray-600' },
          'Manage your profile and subscription. Your finance data lives in your local Kivana app.'
        ),
        React.createElement(
          'div',
          { className: 'mt-6 grid grid-cols-1 md:grid-cols-3 gap-4' },
          React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
            React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'CURRENT PLAN'),
            React.createElement('div', { className: 'mt-2 text-xl font-extrabold text-[#1B1748]' }, planLabel),
            React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, `Renews ${renews}`)
          ),
          React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
            React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'MEMBER SINCE'),
            React.createElement('div', { className: 'mt-2 text-xl font-extrabold text-[#1B1748]' }, memberSince),
            React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, 'Welcome back!')
          ),
          React.createElement(
            'div',
            { className: 'rounded-3xl border border-[#1B1748] bg-[#1B1748] p-6 text-white' },
            React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-white/70' }, 'VAULT'),
            React.createElement('div', { className: 'mt-2 text-xl font-extrabold' }, 'On your device'),
            React.createElement('div', { className: 'mt-1 text-xs text-white/70' }, 'Kivana never receives it')
          )
        ),
        React.createElement('div', { className: 'mt-8' }, React.createElement(CurrentSection, null)),
        status.text
          ? React.createElement(
              'div',
              { className: `mt-6 text-sm ${status.kind === 'err' ? 'text-red-600' : status.kind === 'ok' ? 'text-emerald-700' : 'text-gray-600'}` },
              status.text
            )
          : null
      )
    )
  }

  function Account() {
    return React.createElement(
      'div',
      { className: 'grid grid-cols-1 lg:grid-cols-2 gap-8' },
      React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-2xl font-bold text-[#1B1748] tracking-tight' }, 'Profile'),
        React.createElement('div', { className: 'mt-2 text-[15px] text-gray-600' }, 'This display name is shown in the portal.'),
        React.createElement(
          'div',
          { className: 'mt-7 grid gap-5' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Display name'),
            React.createElement('input', {
              className:
                'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              ref: displayNameInputRef,
              defaultValue: displayName,
              placeholder: 'Your name',
              disabled: busy,
            })
          ),
          React.createElement(
            'button',
            {
              className:
                'w-full px-5 py-3 rounded-full text-[15px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
              onClick: saveProfile,
              disabled: busy,
              type: 'button',
            },
            busy ? 'Saving…' : 'Save profile'
          ),
          status.text
            ? React.createElement(
                'div',
                { className: `text-sm ${status.kind === 'err' ? 'text-red-600' : status.kind === 'ok' ? 'text-emerald-700' : 'text-gray-600'}` },
                status.text
              )
            : null
        )
      ),
      React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-2xl font-bold text-[#1B1748] tracking-tight' }, 'Back to website'),
        React.createElement('div', { className: 'mt-2 text-[15px] text-gray-600' }, 'Signing out always returns you to the main page.'),
        React.createElement(
          'button',
          {
            className:
              'mt-6 px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
            onClick: () => (window.location.href = '/'),
            disabled: busy,
            type: 'button',
          },
          'Open main page'
        )
      )
    )
  }

  function Admin() {
    const isAdmin = !!me?.isAdmin
    if (!isAdmin) {
      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-2xl font-bold text-[#1B1748] tracking-tight' }, 'Admin'),
        React.createElement('div', { className: 'mt-2 text-[15px] text-gray-600' }, 'You are not an admin.')
      )
    }

    const newMessagesCount = adminMessages.filter((m) => !m.isRead).length
    const adminsCount = adminUsers.filter((u) => !!u.isAdmin).length
    const activePlansCount = adminUsers.filter((u) => {
      const trialActive = u.kivanaTrialEndsAt && new Date(String(u.kivanaTrialEndsAt)).getTime() > Date.now()
      const code = trialActive ? 'trial' : String(u.kivanaPlanCode || 'basic').toLowerCase()
      return code !== 'basic'
    }).length

    const filteredUsers = adminUsers.filter((u) => {
      const q = String(adminUserQuery || '').trim().toLowerCase()
      if (!q) return true
      return String(u.email || '').toLowerCase().includes(q)
    })

    const filteredMessages = adminMessages.filter((m) => {
      if (adminMsgFilter === 'new') return !m.isRead
      if (adminMsgFilter === 'archived') return !!m.isRead
      return true
    })

    function AdminNavItem({ id, label, count }) {
      const active = adminPage === id
      return React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => setAdminPage(id),
          className: `w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl text-[14px] font-semibold transition-colors ${
            active ? 'bg-[#F0EEFC] text-[#4F3DDD]' : 'text-gray-700 hover:bg-gray-50'
          }`,
          disabled: busy,
        },
        React.createElement('span', null, label),
        typeof count === 'number' ? React.createElement('span', { className: 'text-xs font-extrabold px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-700' }, String(count)) : null
      )
    }

    function StatCard({ label, value }) {
      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
        React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, label.toUpperCase()),
        React.createElement('div', { className: 'mt-2 text-2xl font-extrabold text-[#1B1748]' }, String(value))
      )
    }

    function UsersTable() {
      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement(
          'div',
          { className: 'flex items-center justify-between gap-4 flex-wrap' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Users'),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, `${filteredUsers.length} of ${adminUsers.length} accounts`)
          ),
          React.createElement(
            'div',
            { className: 'flex items-center gap-3 flex-wrap' },
            React.createElement('input', {
              value: adminUserQuery,
              onChange: (e) => setAdminUserQuery(e.target.value),
              placeholder: 'Search email',
              className:
                'px-4 py-2.5 rounded-full border border-gray-200 bg-white text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              disabled: busy,
            }),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: loadAdmin,
                disabled: busy,
                className:
                  'px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
              },
              'Reload'
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'mt-6 overflow-x-auto' },
          React.createElement(
            'table',
            { className: 'w-full text-sm min-w-[1040px]' },
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Email'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Created'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Last IP'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Role'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Plan'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Ends'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Set plan'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Actions')
              )
            ),
            React.createElement(
              'tbody',
              null,
              filteredUsers.map((u) => {
                const email = String(u.email || '')
                const trialActive = u.kivanaTrialEndsAt && new Date(String(u.kivanaTrialEndsAt)).getTime() > Date.now()
                const planCode = trialActive ? 'trial' : String(u.kivanaPlanCode || 'basic').toLowerCase()
                const planLabel = trialActive ? 'Trial' : String(u.kivanaPlanName || normalizePlanLabel(planCode) || 'Basic')
                const ends = trialActive ? u.kivanaTrialEndsAt : u.kivanaEndsAt
                const role = u.isAdmin ? 'ADMIN' : u.isModerator ? 'MOD' : 'USER'

                return React.createElement(
                  'tr',
                  { key: String(u.id || email), className: 'border-t border-gray-100' },
                  React.createElement('td', { className: 'py-3 pr-4 font-medium text-[#1B1748]' }, email),
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, formatRfc3339Short(u.createdAt || '')),
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, String(u.lastIp || '—')),
                  React.createElement('td', { className: 'py-3 pr-4' }, React.createElement(Pill, { kind: u.isAdmin ? 'ok' : u.isModerator ? 'warn' : 'muted' }, role)),
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-700 font-semibold' }, planLabel),
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, ends ? formatRfc3339Short(ends) : '—'),
                  React.createElement(
                    'td',
                    { className: 'py-3 pr-4' },
                    React.createElement(
                      'select',
                      {
                        className: 'px-3 py-2 rounded-full border border-gray-200 bg-white text-[13px] font-semibold text-[#1B1748] disabled:opacity-60',
                        value: planCode,
                        onChange: async (e) => {
                          const next = String(e.target.value || 'basic')
                          const trialDays = Number(adminConfig?.pricing?.trialDays || 14)
                          const endsAt = (() => {
                            if (next === 'basic' || next === 'lifetime_pro') return null
                            const days = next === 'trial' ? trialDays : 30
                            return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
                          })()
                          await adminGrantPlan(email, next, endsAt || '')
                        },
                        disabled: busy || !!u.isAdmin,
                      },
                      React.createElement('option', { value: 'basic' }, 'Basic'),
                      React.createElement('option', { value: 'trial' }, 'Trial'),
                      React.createElement('option', { value: 'standard' }, 'Ordinary'),
                      React.createElement('option', { value: 'pro' }, 'Pro'),
                      React.createElement('option', { value: 'lifetime_pro' }, 'Lifetime Pro')
                    )
                  ),
                  React.createElement(
                    'td',
                    { className: 'py-3 pr-4' },
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => openGrantModal(u),
                        disabled: busy || !!u.isAdmin,
                      },
                      'Details'
                    ),
                    ' ',
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => openDiscountModal(u),
                        disabled: busy || !!u.isAdmin,
                      },
                      'Discount'
                    ),
                    ' ',
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => openPasswordModal(u),
                        disabled: busy || !!u.isAdmin,
                      },
                      'Password'
                    ),
                    ' ',
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => adminToggleModerator(String(u.email || ''), !u.isModerator),
                        disabled: busy || !!u.isAdmin,
                      },
                      u.isModerator ? 'Unmod' : 'Mod'
                    ),
                    ' ',
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => openDeleteUserModal(u),
                        disabled: busy || !!u.isAdmin,
                      },
                      'Delete'
                    )
                  )
                )
              })
            )
          )
        )
      )
    }

    function MessagesTable() {
      const statusPill = (m) => (m.isRead ? React.createElement(Pill, { kind: 'muted' }, 'ARCHIVED') : React.createElement(Pill, { kind: 'warn' }, 'NEW'))
      const preview = (m) => {
        const s = String(m.message || '').replace(/\s+/g, ' ').trim()
        return s.length > 44 ? s.slice(0, 44) + '…' : s
      }
      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement(
          'div',
          { className: 'flex items-center justify-between gap-4 flex-wrap' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Inbound messages'),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Contact form submissions from the website.')
          ),
          React.createElement(
            'div',
            { className: 'flex items-center gap-3 flex-wrap' },
            React.createElement(
              'select',
              {
                value: adminMsgFilter,
                onChange: (e) => setAdminMsgFilter(String(e.target.value || 'new')),
                className: 'px-4 py-2.5 rounded-full border border-gray-200 bg-white text-[14px] font-semibold text-[#1B1748]',
                disabled: busy,
              },
              React.createElement('option', { value: 'new' }, `New (${newMessagesCount})`),
              React.createElement('option', { value: 'archived' }, 'Archived'),
              React.createElement('option', { value: 'all' }, `All (${adminMessages.length})`)
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: loadAdmin,
                disabled: busy,
                className:
                  'px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
              },
              'Reload'
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'mt-6 overflow-x-auto' },
          React.createElement(
            'table',
            { className: 'w-full text-sm min-w-[1040px]' },
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Created'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Status'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Name'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Email'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Subject'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Message'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'IP'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Action')
              )
            ),
            React.createElement(
              'tbody',
              null,
              filteredMessages.map((m) => {
                const id = String(m.id || '')
                const read = !!m.isRead
                return React.createElement(
                  'tr',
                  { key: id, className: 'border-t border-gray-100' },
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, formatRfc3339Short(m.createdAt || '')),
                  React.createElement('td', { className: 'py-3 pr-4' }, statusPill(m)),
                  React.createElement('td', { className: 'py-3 pr-4 font-medium text-[#1B1748]' }, String(m.name || '')),
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-700' }, String(m.email || '')),
                  React.createElement(
                    'td',
                    { className: 'py-3 pr-4 text-[#4F3DDD] font-semibold' },
                    React.createElement(
                      'button',
                      { type: 'button', className: 'hover:underline', onClick: () => setMsgModal(m), disabled: busy },
                      String(m.subject || '(no subject)')
                    )
                  ),
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, preview(m)),
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, String(m.clientIp || '—')),
                  React.createElement(
                    'td',
                    { className: 'py-3 pr-4' },
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => setMsgModal(m),
                        disabled: busy,
                      },
                      'Open'
                    ),
                    ' ',
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => adminMark(id, read ? false : true),
                        disabled: busy,
                      },
                      read ? 'Unarchive' : 'Archive'
                    ),
                    ' ',
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => adminDeleteMsg(id),
                        disabled: busy,
                      },
                      'Delete'
                    )
                  )
                )
              })
            )
          )
        )
      )
    }

    function SettingsPanel() {
      const cfg = adminConfig || null
      if (!cfg) {
        return React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Settings'),
          React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'Load settings to edit plan visibility and pricing.'),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: loadAdmin,
              disabled: busy,
              className:
                'mt-6 px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
            },
            'Reload'
          )
        )
      }

      const Toggle = ({ label, value, onChange }) =>
        React.createElement(
          'div',
          { className: 'flex items-center justify-between gap-4 rounded-2xl border border-gray-100 px-5 py-4' },
          React.createElement('div', null, React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, label)),
          React.createElement('input', { type: 'checkbox', checked: !!value, onChange: (e) => onChange(!!e.target.checked), disabled: busy, className: 'w-5 h-5 accent-[#4F3DDD]' })
        )

      const PriceRow = ({ title, obj, onUpdate }) =>
        React.createElement(
          'div',
          { className: 'rounded-2xl border border-gray-100 px-5 py-4' },
          React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, title),
          React.createElement(
            'div',
            { className: 'mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3' },
            ['eur', 'gbp', 'nok'].map((k) =>
              React.createElement('input', {
                key: k,
                type: 'number',
                step: '0.01',
                value: String(obj?.[k] ?? ''),
                onChange: (e) => onUpdate({ ...(obj || {}), [k]: Number(e.target.value) }),
                disabled: busy,
                className:
                  'w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                placeholder: k.toUpperCase(),
              })
            )
          )
        )

      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Settings'),
        React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Global toggles for the portal and pricing.'),
        React.createElement(
          'div',
          { className: 'mt-6 grid gap-4' },
          Toggle({
            label: 'Allow new signups',
            value: cfg.allowSignups,
            onChange: (v) => setAdminConfig((c) => ({ ...(c || {}), allowSignups: v })),
          }),
          Toggle({
            label: 'Show Basic',
            value: cfg.pricing?.showBasic,
            onChange: (v) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), showBasic: v } })),
          }),
          Toggle({
            label: 'Show Trial',
            value: cfg.pricing?.showTrial,
            onChange: (v) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), showTrial: v } })),
          }),
          Toggle({
            label: 'Show Ordinary',
            value: cfg.pricing?.showStandard,
            onChange: (v) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), showStandard: v } })),
          }),
          Toggle({
            label: 'Show Pro',
            value: cfg.pricing?.showPro,
            onChange: (v) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), showPro: v } })),
          }),
          Toggle({
            label: 'Show Lifetime',
            value: cfg.pricing?.showLifetime,
            onChange: (v) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), showLifetime: v } })),
          }),
          Toggle({
            label: 'Show Accountant',
            value: cfg.pricing?.showAccountant,
            onChange: (v) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), showAccountant: v } })),
          }),
          React.createElement(
            'div',
            { className: 'rounded-2xl border border-gray-100 px-5 py-4' },
            React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Yearly factor'),
            React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, 'Yearly price = monthly * factor.'),
            React.createElement('input', {
              type: 'number',
              step: '1',
              value: String(cfg.pricing?.yearlyFactor ?? ''),
              onChange: (e) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), yearlyFactor: Number(e.target.value) } })),
              disabled: busy,
              className:
                'mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
            })
          ),
          React.createElement(
            'div',
            { className: 'rounded-2xl border border-gray-100 px-5 py-4' },
            React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Trial days'),
            React.createElement('input', {
              type: 'number',
              step: '1',
              value: String(cfg.pricing?.trialDays ?? ''),
              onChange: (e) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), trialDays: Number(e.target.value) } })),
              disabled: busy,
              className:
                'mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
            })
          ),
          PriceRow({
            title: 'Ordinary monthly prices',
            obj: cfg.pricing?.standardMonthly,
            onUpdate: (v) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), standardMonthly: v } })),
          }),
          PriceRow({
            title: 'Pro monthly prices',
            obj: cfg.pricing?.proMonthly,
            onUpdate: (v) => setAdminConfig((c) => ({ ...(c || {}), pricing: { ...(c?.pricing || {}), proMonthly: v } })),
          }),
          React.createElement(
            'div',
            { className: 'flex items-center justify-end gap-3' },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => saveAdminConfig(adminConfig),
                disabled: busy,
                className:
                  'px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
              },
              'Save settings'
            )
          )
        )
      )
    }

    function OverviewPanel() {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('div', { className: 'text-4xl font-extrabold text-[#1B1748]', style: { fontFamily: 'Lora, serif' } }, 'Admin control panel'),
        React.createElement('div', { className: 'mt-2 text-[15px] text-gray-600' }, 'User management, plan controls and inbound messages.'),
        React.createElement(
          'div',
          { className: 'mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4' },
          React.createElement(StatCard, { label: 'Users', value: adminUsers.length }),
          React.createElement(StatCard, { label: 'Admins', value: adminsCount }),
          React.createElement(StatCard, { label: 'Active plans', value: activePlansCount }),
          React.createElement(StatCard, { label: 'New messages', value: newMessagesCount })
        ),
        React.createElement('div', { className: 'mt-8' }, React.createElement(MessagesTable, null)),
        React.createElement('div', { className: 'mt-8' }, React.createElement(SettingsPanel, null))
      )
    }

    const panel =
      adminPage === 'overview'
        ? React.createElement(OverviewPanel, null)
        : adminPage === 'users'
          ? React.createElement(UsersTable, null)
          : adminPage === 'messages'
            ? React.createElement(MessagesTable, null)
            : React.createElement(SettingsPanel, null)

    return React.createElement(
      'div',
      { className: 'flex flex-col lg:flex-row gap-8' },
      React.createElement(
        'aside',
        { className: 'w-full lg:w-[260px] shrink-0' },
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-2' },
          React.createElement(AdminNavItem, { id: 'overview', label: 'Overview' }),
          React.createElement(AdminNavItem, { id: 'users', label: 'Users', count: adminUsers.length }),
          React.createElement(AdminNavItem, { id: 'messages', label: 'Messages', count: newMessagesCount }),
          React.createElement(AdminNavItem, { id: 'settings', label: 'Settings' })
        )
      ),
      React.createElement('div', { className: 'flex-1 min-w-0' }, panel)
    )
  }

  function PasswordModal() {
    if (!pwModal) return null
    const current = String(pwModal.current || '')
    const next = String(pwModal.next || '')
    const confirm = String(pwModal.confirm || '')
    const canSave = current && next.length >= 8 && next === confirm

    return React.createElement(
      'div',
      { className: 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6', onClick: () => setPwModal(null), role: 'dialog', 'aria-modal': 'true' },
      React.createElement(
        'div',
        { className: 'w-full max-w-xl rounded-3xl bg-white shadow-xl border border-gray-100', onClick: (e) => e.stopPropagation() },
        React.createElement(
          'div',
          { className: 'px-6 py-5 flex items-center justify-between gap-4 border-b border-gray-100' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Change password'),
          React.createElement(
            'button',
            {
              className: 'w-10 h-10 rounded-full border border-gray-200 text-[#1B1748] hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: () => setPwModal(null),
              disabled: busy,
            },
            '×'
          )
        ),
        React.createElement(
          'div',
          { className: 'px-6 py-6 grid gap-4' },
          React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Current password'),
          React.createElement('input', {
            className:
              'mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
            type: 'password',
            value: current,
            onChange: (e) => setPwModal((m) => ({ ...(m || {}), current: e.target.value })),
            disabled: busy,
            autoComplete: 'current-password',
          }),
          React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'New password (min 8 chars)'),
          React.createElement('input', {
            className:
              'mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
            type: 'password',
            value: next,
            onChange: (e) => setPwModal((m) => ({ ...(m || {}), next: e.target.value })),
            disabled: busy,
            autoComplete: 'new-password',
          }),
          React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Confirm new password'),
          React.createElement('input', {
            className:
              'mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
            type: 'password',
            value: confirm,
            onChange: (e) => setPwModal((m) => ({ ...(m || {}), confirm: e.target.value })),
            disabled: busy,
            autoComplete: 'new-password',
          })
        ),
        React.createElement(
          'div',
          { className: 'px-6 pb-6 flex items-center justify-end gap-3' },
          React.createElement(
            'button',
            {
              className:
                'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: () => setPwModal(null),
              disabled: busy,
            },
            'Cancel'
          ),
          React.createElement(
            'button',
            {
              className:
                'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: () => changeMyPassword(current, next),
              disabled: busy || !canSave,
            },
            busy ? 'Working…' : 'Save'
          )
        )
      )
    )
  }

  function DeleteModal() {
    if (!deleteModal) return null
    const password = String(deleteModal.password || '')
    const confirmText = String(deleteModal.confirmText || '')
    const canDelete = password && confirmText.trim().toUpperCase() === 'DELETE'

    return React.createElement(
      'div',
      { className: 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6', onClick: () => setDeleteModal(null), role: 'dialog', 'aria-modal': 'true' },
      React.createElement(
        'div',
        { className: 'w-full max-w-xl rounded-3xl bg-white shadow-xl border border-gray-100', onClick: (e) => e.stopPropagation() },
        React.createElement(
          'div',
          { className: 'px-6 py-5 flex items-center justify-between gap-4 border-b border-gray-100' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Delete account'),
          React.createElement(
            'button',
            {
              className: 'w-10 h-10 rounded-full border border-gray-200 text-[#1B1748] hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: () => setDeleteModal(null),
              disabled: busy,
            },
            '×'
          )
        ),
        React.createElement(
          'div',
          { className: 'px-6 py-6 grid gap-4' },
          React.createElement('div', { className: 'text-sm text-gray-600' }, 'This permanently deletes your account and cloud-side records.'),
          React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Type DELETE to confirm'),
          React.createElement('input', {
            className:
              'mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-500/60',
            type: 'text',
            value: confirmText,
            onChange: (e) => setDeleteModal((m) => ({ ...(m || {}), confirmText: e.target.value })),
            disabled: busy,
            placeholder: 'DELETE',
          }),
          React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Password'),
          React.createElement('input', {
            className:
              'mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-red-500/10 focus:border-red-500/60',
            type: 'password',
            value: password,
            onChange: (e) => setDeleteModal((m) => ({ ...(m || {}), password: e.target.value })),
            disabled: busy,
            autoComplete: 'current-password',
          })
        ),
        React.createElement(
          'div',
          { className: 'px-6 pb-6 flex items-center justify-end gap-3' },
          React.createElement(
            'button',
            {
              className:
                'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: () => setDeleteModal(null),
              disabled: busy,
            },
            'Cancel'
          ),
          React.createElement(
            'button',
            {
              className: 'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: () => deleteMyAccount(password, confirmText),
              disabled: busy || !canDelete,
            },
            busy ? 'Working…' : 'Delete'
          )
        )
      )
    )
  }

  function MessageModal() {
    if (!msgModal) return null
    const id = String(msgModal.id || '')
    const read = !!msgModal.isRead
    const created = msgModal.createdAt ? formatRfc3339Short(msgModal.createdAt) : ''
    const subject = String(msgModal.subject || '(no subject)')
    const email = String(msgModal.email || '')
    const name = String(msgModal.name || '')
    const ip = String(msgModal.clientIp || '')
    const message = String(msgModal.message || '')

    return React.createElement(
      'div',
      { className: 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6', onClick: () => setMsgModal(null), role: 'dialog', 'aria-modal': 'true' },
      React.createElement(
        'div',
        { className: 'w-full max-w-3xl rounded-3xl bg-white shadow-xl border border-gray-100', onClick: (e) => e.stopPropagation() },
        React.createElement(
          'div',
          { className: 'px-6 py-5 flex items-start justify-between gap-4 border-b border-gray-100' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, subject),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, `${name || 'Unknown'} • ${email || '—'}${created ? ' • ' + created : ''}${ip ? ' • ' + ip : ''}`)
          ),
          React.createElement(
            'button',
            { className: 'w-10 h-10 rounded-full border border-gray-200 text-[#1B1748] hover:bg-gray-50', type: 'button', onClick: () => setMsgModal(null), disabled: busy },
            '×'
          )
        ),
        React.createElement(
          'div',
          { className: 'px-6 py-6' },
          React.createElement(
            'div',
            { className: 'rounded-2xl border border-gray-100 bg-gray-50 p-5 whitespace-pre-wrap text-[14px] text-gray-800 leading-relaxed' },
            message || '—'
          )
        ),
        React.createElement(
          'div',
          { className: 'px-6 pb-6 flex items-center justify-between gap-3 flex-wrap' },
          React.createElement('div', null, read ? React.createElement(Pill, { kind: 'muted' }, 'ARCHIVED') : React.createElement(Pill, { kind: 'warn' }, 'NEW')),
          React.createElement(
            'div',
            { className: 'flex items-center gap-3 flex-wrap justify-end' },
            React.createElement(
              'button',
              {
                className:
                  'px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                type: 'button',
                onClick: async () => {
                  await adminMark(id, read ? false : true)
                  setMsgModal(null)
                },
                disabled: busy,
              },
              read ? 'Unarchive' : 'Archive'
            ),
            React.createElement(
              'button',
              {
                className:
                  'px-5 py-2.5 rounded-full text-[14px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
                type: 'button',
                onClick: async () => {
                  await adminDeleteMsg(id)
                  setMsgModal(null)
                },
                disabled: busy,
              },
              'Delete'
            )
          )
        )
      )
    )
  }

  const content =
    view === 'auth'
      ? React.createElement(AuthCard, null)
      : view === 'account'
        ? React.createElement(Account, null)
        : view === 'admin'
          ? React.createElement(Admin, null)
          : React.createElement(Dashboard, null)

  return React.createElement(
    'div',
    { className: 'min-h-screen bg-[#F6F7FB] text-[#1B1748]' },
    React.createElement(Topbar, null),
    React.createElement(
      'main',
      { className: 'max-w-7xl mx-auto px-6 lg:px-10 py-8' },
      content
    ),
    React.createElement('div', { className: 'max-w-7xl mx-auto px-6 lg:px-10 pb-10 text-sm text-gray-500' }, `© ${new Date().getFullYear()} Kivana`),
    React.createElement(AdminModal, null),
    React.createElement(PasswordModal, null),
    React.createElement(DeleteModal, null),
    React.createElement(MessageModal, null)
  )
}

createRoot(document.getElementById('root')).render(React.createElement(App, null))

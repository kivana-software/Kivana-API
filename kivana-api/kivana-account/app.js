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
  if (isNorway) return { code: 'NOK', symbol: 'kr', monthlyStd: 99, monthlyPro: 299 }
  if (isUk) return { code: 'GBP', symbol: '£', monthlyStd: 9.99, monthlyPro: 29.9 }
  return { code: 'EUR', symbol: '€', monthlyStd: 9.99, monthlyPro: 29.9 }
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

  const yearlyFactor = 11
  const monthlyStd = Number(pricing.monthlyStd)
  const monthlyPro = Number(pricing.monthlyPro)
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
    const list = Array.isArray(json?.entitlements) ? json.entitlements : []
    const kivana = list.find((e) => String(e.productCode || '').toLowerCase() === 'kivana') || null
    setEntitlement(kivana)
    return kivana
  }

  async function loadSession() {
    setBusy(true)
    try {
      await loadMe()
      await loadEntitlements()
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

  async function selectPlan(planCode) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch('/v1/portal/select-plan', { method: 'POST', body: JSON.stringify({ planCode, billingCycle }) })
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
      const [uRes, mRes] = await Promise.all([
        apiFetch('/v1/admin/users', { method: 'GET' }),
        apiFetch('/v1/admin/contact-messages', { method: 'GET' }),
      ])
      const uJson = await uRes.json()
      const mJson = await mRes.json()
      setAdminUsers(Array.isArray(uJson?.users) ? uJson.users : [])
      setAdminMessages(Array.isArray(mJson?.messages) ? mJson.messages : [])
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
                React.createElement('option', { value: 'lifetime' }, 'Lifetime')
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
    const statusText = planName ? `${planName}${planCode ? '' : ''}` : planCode ? planCode : ''

    return React.createElement(
      'header',
      { className: `sticky top-0 z-50 bg-white transition-shadow duration-300 ${navScrolled ? 'shadow-sm' : ''}` },
      React.createElement(
        'div',
        { className: 'max-w-7xl mx-auto px-6 lg:px-10 py-5 flex items-center justify-between gap-4' },
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
          { className: 'flex items-center gap-3 flex-wrap justify-end' },
          me
            ? React.createElement(
                React.Fragment,
                null,
                statusText ? React.createElement(Pill, { kind: 'ok' }, statusText) : null,
                React.createElement(
                  'button',
                  {
                    className:
                      'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                    onClick: () => setView('dashboard'),
                    disabled: busy,
                    type: 'button',
                  },
                  'Plans'
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                    onClick: () => setView('account'),
                    disabled: busy,
                    type: 'button',
                  },
                  'Account'
                ),
                me.isAdmin
                  ? React.createElement(
                      'button',
                      {
                        className:
                          'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                        onClick: async () => {
                          setView('admin')
                          await loadAdmin()
                        },
                        disabled: busy,
                        type: 'button',
                      },
                      'Admin'
                    )
                  : null,
                React.createElement(
                  'button',
                  {
                    className:
                      'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
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
                  'Try free'
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
    const planName = entitlement ? String(entitlement.planName || '').trim() : ''
    const planCode = entitlement ? String(entitlement.planCode || '').trim().toLowerCase() : ''
    const endsAt = entitlement && entitlement.endsAt ? String(entitlement.endsAt) : ''

    return React.createElement(
      'div',
      { className: 'grid grid-cols-1 lg:grid-cols-2 gap-8' },
      React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-2xl font-bold text-[#1B1748] tracking-tight' }, 'Plans'),
        React.createElement('div', { className: 'mt-2 text-[15px] text-gray-600' }, 'Choose a plan. Pricing matches the website currency rules.'),
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
            React.createElement(
              'div',
              { className: 'flex items-center justify-between gap-4' },
              React.createElement('div', { className: 'text-lg font-bold' }, 'Basic'),
              planCode === 'basic' || !planCode ? React.createElement(Pill, { kind: 'ok' }, 'Current') : React.createElement(Pill, { kind: 'ok' }, 'Free')
            ),
            React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'Free.')
          ),
          React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
            React.createElement(
              'div',
              { className: 'flex items-center justify-between gap-4' },
              React.createElement('div', { className: 'text-lg font-bold' }, 'Ordinary'),
              planCode === 'standard' ? React.createElement(Pill, { kind: 'ok' }, 'Current') : React.createElement(Pill, { kind: 'warn' }, 'Coming soon')
            ),
            React.createElement(
              'div',
              { className: 'mt-3 flex items-baseline gap-2 flex-wrap' },
              React.createElement('div', { className: 'text-2xl font-extrabold tracking-tight' }, formatMoney(pricing, billingCycle === 'yearly' ? yearlyStd : monthlyStd)),
              React.createElement('div', { className: 'text-sm text-gray-600' }, billingCycle === 'yearly' ? '/yr' : '/mo')
            ),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, billingCycle === 'yearly' ? `${formatMoney(pricing, monthlyStd)}/mo` : `${formatMoney(pricing, yearlyStd)}/yr`),
            React.createElement(
              'button',
              {
                className:
                  'mt-4 px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                type: 'button',
                onClick: () => selectPlan('standard'),
                disabled: busy || planCode === 'standard',
              },
              planCode === 'standard' ? 'Current plan' : 'Select Ordinary'
            )
          ),
          React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white p-6' },
            React.createElement(
              'div',
              { className: 'flex items-center justify-between gap-4' },
              React.createElement('div', { className: 'text-lg font-bold' }, 'Pro'),
              planCode === 'pro' ? React.createElement(Pill, { kind: 'ok' }, 'Current') : React.createElement(Pill, { kind: 'warn' }, 'Coming soon')
            ),
            React.createElement(
              'div',
              { className: 'mt-3 flex items-baseline gap-2 flex-wrap' },
              React.createElement('div', { className: 'text-2xl font-extrabold tracking-tight' }, formatMoney(pricing, billingCycle === 'yearly' ? yearlyPro : monthlyPro)),
              React.createElement('div', { className: 'text-sm text-gray-600' }, billingCycle === 'yearly' ? '/yr' : '/mo')
            ),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, billingCycle === 'yearly' ? `${formatMoney(pricing, monthlyPro)}/mo` : `${formatMoney(pricing, yearlyPro)}/yr`),
            React.createElement(
              'button',
              {
                className:
                  'mt-4 px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                type: 'button',
                onClick: () => selectPlan('pro'),
                disabled: busy || planCode === 'pro',
              },
              planCode === 'pro' ? 'Current plan' : 'Select Pro'
            )
          )
        ),
        status.text
          ? React.createElement(
              'div',
              { className: `mt-4 text-sm ${status.kind === 'err' ? 'text-red-600' : status.kind === 'ok' ? 'text-emerald-700' : 'text-gray-600'}` },
              status.text
            )
          : null
      ),
      React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-2xl font-bold text-[#1B1748] tracking-tight' }, 'Your account'),
        React.createElement('div', { className: 'mt-2 text-[15px] text-gray-600' }, 'Profile, entitlement status, and admin access.'),
        React.createElement(
          'div',
          { className: 'mt-6 grid gap-3 text-[15px]' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'flex items-center justify-between gap-4 border-b border-gray-100 pb-3' }, React.createElement('div', { className: 'text-gray-600' }, 'Email'), React.createElement('div', { className: 'font-semibold text-[#1B1748]' }, String(me?.email || ''))),
            React.createElement('div', { className: 'flex items-center justify-between gap-4 border-b border-gray-100 pb-3' }, React.createElement('div', { className: 'text-gray-600' }, 'Plan'), React.createElement('div', { className: 'font-semibold text-[#1B1748]' }, planName || planCode || 'Basic')),
            React.createElement('div', { className: 'flex items-center justify-between gap-4 border-b border-gray-100 pb-3' }, React.createElement('div', { className: 'text-gray-600' }, 'Ends'), React.createElement('div', { className: 'font-semibold text-[#1B1748]' }, endsAt || '—')),
            React.createElement(
              'div',
              { className: 'flex items-center justify-between gap-4' },
              React.createElement('div', { className: 'text-gray-600' }, 'Admin'),
              React.createElement('div', null, me?.isAdmin ? React.createElement(Pill, { kind: 'ok' }, 'Yes') : React.createElement(Pill, { kind: 'muted' }, 'No'))
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'mt-6 flex items-center gap-3 flex-wrap' },
          React.createElement(
            'button',
            {
              className:
                'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
              onClick: () => setView('account'),
              disabled: busy,
              type: 'button',
            },
            'Edit profile'
          ),
          me?.isAdmin
            ? React.createElement(
                'button',
                {
                  className:
                    'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                  onClick: async () => {
                    setView('admin')
                    await loadAdmin()
                  },
                  disabled: busy,
                  type: 'button',
                },
                'Open admin'
              )
            : null
        )
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

    const usersView =
      adminTab === 'users'
        ? React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
            React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Users'),
            React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, `${adminUsers.length} users`),
            React.createElement(
              'table',
              { className: 'w-full text-sm mt-6' },
              React.createElement(
                'thead',
                null,
                React.createElement(
                  'tr',
                  null,
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Email'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Created'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Plan'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Ends'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Discount'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Last IP'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Flags'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Actions')
                )
              ),
              React.createElement(
                'tbody',
                null,
                adminUsers.map((u) =>
                  React.createElement(
                    'tr',
                    { key: String(u.id || u.email), className: 'border-t border-gray-100' },
                    React.createElement('td', { className: 'py-3 pr-4 font-medium text-[#1B1748]' }, String(u.email || '')),
                    React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, String(u.createdAt || '')),
                    React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, String(u.kivanaPlanName || u.kivanaPlanCode || 'basic')),
                    React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, String(u.kivanaEndsAt || '—')),
                    React.createElement(
                      'td',
                      { className: 'py-3 pr-4 text-gray-600' },
                      u.discountPercent != null && Number(u.discountPercent) > 0
                        ? `${String(u.discountPercent)}%${u.discountLabel ? ` (${String(u.discountLabel)})` : ''}`
                        : '—'
                    ),
                    React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, String(u.lastIp || '—')),
                    React.createElement(
                      'td',
                      { className: 'py-3 pr-4' },
                      u.isAdmin ? React.createElement(Pill, { kind: 'ok' }, 'admin') : null,
                      ' ',
                      u.isModerator ? React.createElement(Pill, { kind: 'warn' }, 'moderator') : null,
                      ' ',
                      u.isFounder ? React.createElement(Pill, { kind: 'ok' }, 'founder') : null
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
                          onClick: () => openPasswordModal(u),
                          disabled: busy,
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
                          onClick: () => openGrantModal(u),
                          disabled: busy,
                        },
                        'Plan'
                      ),
                      ' ',
                      React.createElement(
                        'button',
                        {
                          className:
                            'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                          type: 'button',
                          onClick: () => openDiscountModal(u),
                          disabled: busy,
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
                )
              )
            )
          )
        : null

    const messagesView =
      adminTab === 'messages'
        ? React.createElement(
            'div',
            { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
            React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Messages'),
            React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, `${adminMessages.length} messages`),
            React.createElement(
              'table',
              { className: 'w-full text-sm mt-6' },
              React.createElement(
                'thead',
                null,
                React.createElement(
                  'tr',
                  null,
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'From'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Subject'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Status'),
                  React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Actions')
                )
              ),
              React.createElement(
                'tbody',
                null,
                adminMessages.map((m) => {
                  const id = String(m.id || '')
                  const read = !!m.isRead
                  return React.createElement(
                    'tr',
                    { key: id, className: 'border-t border-gray-100' },
                    React.createElement(
                      'td',
                      { className: 'py-3 pr-4' },
                      React.createElement('div', { className: 'font-medium text-[#1B1748]' }, String(m.email || '')),
                      React.createElement('div', { className: 'text-gray-600' }, String(m.name || ''))
                    ),
                    React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, String(m.subject || '')),
                    React.createElement('td', { className: 'py-3 pr-4' }, read ? React.createElement(Pill, { kind: 'ok' }, 'read') : React.createElement(Pill, { kind: 'warn' }, 'unread')),
                    React.createElement(
                      'td',
                      { className: 'py-3 pr-4' },
                      React.createElement(
                        'button',
                        {
                          className:
                            'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                          type: 'button',
                          onClick: () => adminMark(id, !read),
                          disabled: busy,
                        },
                        read ? 'Mark unread' : 'Mark read'
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
        : null

    return React.createElement(
      'div',
      { className: 'grid grid-cols-1 lg:grid-cols-2 gap-8' },
      React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-2xl font-bold text-[#1B1748] tracking-tight' }, 'Admin'),
        React.createElement('div', { className: 'mt-2 text-[15px] text-gray-600' }, 'User management and contact inbox.'),
        React.createElement(
          'div',
          { className: 'mt-6 flex items-center gap-3 flex-wrap' },
          React.createElement(
            'button',
            {
              className: `px-4 py-2 rounded-full border-2 text-[13px] font-semibold transition-colors ${
                adminTab === 'users' ? 'border-[#4F3DDD] bg-[#F0EEFC] text-[#4F3DDD]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              } disabled:opacity-60 disabled:pointer-events-none`,
              type: 'button',
              onClick: () => setAdminTab('users'),
              disabled: busy,
            },
            'Users'
          ),
          React.createElement(
            'button',
            {
              className: `px-4 py-2 rounded-full border-2 text-[13px] font-semibold transition-colors ${
                adminTab === 'messages' ? 'border-[#4F3DDD] bg-[#F0EEFC] text-[#4F3DDD]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              } disabled:opacity-60 disabled:pointer-events-none`,
              type: 'button',
              onClick: () => setAdminTab('messages'),
              disabled: busy,
            },
            'Messages'
          ),
          React.createElement(
            'button',
            {
              className:
                'px-5 py-2.5 rounded-full text-[15px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
              type: 'button',
              onClick: loadAdmin,
              disabled: busy,
            },
            busy ? 'Loading…' : 'Reload'
          )
        ),
        status.text
          ? React.createElement(
              'div',
              { className: `mt-4 text-sm ${status.kind === 'err' ? 'text-red-600' : status.kind === 'ok' ? 'text-emerald-700' : 'text-gray-600'}` },
              status.text
            )
          : null
      ),
      React.createElement('div', null, usersView, messagesView)
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
    { className: 'min-h-screen bg-white text-[#1B1748]' },
    React.createElement(Topbar, null),
    React.createElement(
      'main',
      { className: 'max-w-7xl mx-auto px-6 lg:px-10 py-8' },
      content
    ),
    React.createElement('div', { className: 'max-w-7xl mx-auto px-6 lg:px-10 pb-10 text-sm text-gray-500' }, `© ${new Date().getFullYear()} Kivana`),
    React.createElement(AdminModal, null)
  )
}

createRoot(document.getElementById('root')).render(React.createElement(App, null))

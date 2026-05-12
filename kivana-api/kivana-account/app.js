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

function computeDefaultPayPalWebhookUrl() {
  try {
    const u = new URL(window.location.href)
    const hn = String(u.hostname || '').trim().toLowerCase()
    const isLocal = hn === 'localhost' || hn === '127.0.0.1' || hn === '::1'
    if (isLocal) return ''
    return `https://${u.host}/v1/paypal/webhook`
  } catch {
    return ''
  }
}

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

const te = new TextEncoder()
const td = new TextDecoder()

async function fetchCaptchaChallenge() {
  const res = await fetch(apiUrl('/v1/captcha/challenge'), { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json().catch(() => ({}))
  const question = String(json?.question || '').trim()
  const token = String(json?.token || '').trim()
  if (!question || !token) throw new Error('captcha_error')
  return { question, token }
}

function bytesToB64(bytes) {
  let s = ''
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i])
  return btoa(s)
}

function b64ToBytes(b64) {
  const raw = atob(String(b64 || ''))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function randomBytes(len) {
  const out = new Uint8Array(len)
  crypto.getRandomValues(out)
  return out
}

function chatKeyStorageKey(userId) {
  return `kivanaPortal/chatKey:${String(userId || '')}`
}

function deviceSecretKey() {
  return 'kivanaPortal/deviceSecret'
}

function isE2EEBody(v) {
  const s = String(v || '')
  return s.startsWith('e2ee:v1:') || s.startsWith('e2ee:v2:')
}

async function getOrCreateDeviceSecret() {
  try {
    const existing = String(localStorage.getItem(deviceSecretKey()) || '')
    if (existing) return b64ToBytes(existing)
    const secret = randomBytes(32)
    localStorage.setItem(deviceSecretKey(), bytesToB64(secret))
    return secret
  } catch {
    return randomBytes(32)
  }
}

async function encryptJsonWithDeviceSecret(obj, secretBytes) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = randomBytes(12)
  const pt = te.encode(JSON.stringify(obj || {}))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt)
  return { v: 1, iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) }
}

async function decryptJsonWithDeviceSecret(payload, secretBytes) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const iv = b64ToBytes(payload?.iv || '')
  const ct = b64ToBytes(payload?.ct || '')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(td.decode(new Uint8Array(pt)))
}

async function getOrCreateChatKeypair(userId) {
  const storageKey = chatKeyStorageKey(userId)
  const secret = await getOrCreateDeviceSecret()
  try {
    const raw = String(localStorage.getItem(storageKey) || '')
    if (raw) {
      const payload = JSON.parse(raw)
      const jwk = await decryptJsonWithDeviceSecret(payload, secret)
      const privateJwk = jwk?.priv || null
      const publicJwk = jwk?.pub || null
      if (privateJwk && publicJwk) {
        const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
        const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
        return { publicKey, privateKey, publicJwk }
      }
      if (publicJwk && typeof publicJwk === 'object') {
        void 0
      }
    }
  } catch {
    void 0
  }

  const kp = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  )
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey)
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey)
  const wrapped = await encryptJsonWithDeviceSecret({ priv, pub }, secret)
  try {
    localStorage.setItem(storageKey, JSON.stringify(wrapped))
  } catch {
    void 0
  }
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicJwk: pub }
}

async function e2eeEncryptMessage(plainText, recipients) {
  const text = String(plainText || '')
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, te.encode(text))
  const rawKey = await crypto.subtle.exportKey('raw', aesKey)

  const keys = []
  for (const r of Array.isArray(recipients) ? recipients : []) {
    const rid = String(r?.id || '')
    const jwk = r?.publicJwk || r?.public_jwk || null
    if (!rid || !jwk || typeof jwk !== 'object') continue
    const pub = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
    const ek = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawKey)
    keys.push({ id: rid, ek: bytesToB64(new Uint8Array(ek)) })
  }

  const payload = {
    v: 1,
    alg: 'A256GCM+RSA-OAEP-SHA256',
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ct)),
    keys,
  }
  return `e2ee:v2:${btoa(JSON.stringify(payload))}`
}

async function e2eeDecryptMessage(body, myId, privateKey) {
  const s = String(body || '')
  if (!isE2EEBody(s)) return String(body || '')

  const raw = s.startsWith('e2ee:v2:') ? s.slice('e2ee:v2:'.length) : s.slice('e2ee:v1:'.length)
  let payload
  if (s.startsWith('e2ee:v2:')) {
    payload = JSON.parse(atob(raw))
  } else {
    try {
      payload = JSON.parse(atob(raw))
    } catch {
      payload = JSON.parse(td.decode(b64ToBytes(raw)))
    }
  }
  const keys = Array.isArray(payload?.keys) ? payload.keys : []
  const mine = keys.find((k) => String(k?.id || '') === String(myId || '')) || null
  if (!mine?.ek) return null

  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64ToBytes(mine.ek))
  const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(payload?.iv || '') }, aesKey, b64ToBytes(payload?.ct || ''))
  return td.decode(new Uint8Array(pt))
}

async function decryptE2EEMessagesIfPossible(messages, kp) {
  const msgs = Array.isArray(messages) ? messages : []
  if (!kp?.privateKey || !kp?.userId) return msgs
  const out = await Promise.all(
    msgs.map(async (m) => {
      const body = await e2eeDecryptMessage(m?.body, kp.userId, kp.privateKey).catch(() => null)
      return { ...m, body: body == null ? 'Encrypted message' : body }
    })
  )
  return out
}

function SupportChatSection({
  busy,
  supportThreads,
  supportThreadId,
  supportThread,
  supportMessages,
  loadSupportThreads,
  loadSupportThread,
  sendSupportMessage,
  setStatus,
}) {
  const [subject, setSubject] = useState('')
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [supportThreadId, supportMessages.length])

  const canSend = String(draft || '').trim().length > 0
  const active = supportThread || null
  const threads = Array.isArray(supportThreads) ? supportThreads : []
  const activeLabel = active?.subject ? String(active.subject) : supportThreadId ? 'Support' : 'New message'

  const Bubble = (m) => {
    const role = String(m.senderRole || m.sender_role || '').toLowerCase()
    const mine = role !== 'admin'
    const body = String(m.body || '').trim()
    const when = m.createdAt ? formatRfc3339Short(m.createdAt) : ''
    const wrapCls = mine ? 'w-full flex justify-end' : 'w-full flex justify-start'
    const bubbleCls = mine
      ? 'max-w-[80%] rounded-2xl bg-[#4F3DDD] text-white px-4 py-3 text-[14px] leading-relaxed'
      : 'max-w-[80%] rounded-2xl bg-white border border-gray-200 text-gray-800 px-4 py-3 text-[14px] leading-relaxed'
    return React.createElement(
      'div',
      { key: String(m.id || ''), className: wrapCls },
      React.createElement(
        'div',
        { className: mine ? 'flex flex-col items-end' : 'flex flex-col items-start' },
        React.createElement('div', { className: bubbleCls }, body || '—'),
        when ? React.createElement('div', { className: `mt-1 text-[11px] ${mine ? 'text-right text-gray-500' : 'text-left text-gray-500'}` }, when) : null
      )
    )
  }

  return React.createElement(
    'div',
    { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
    React.createElement(
      'div',
      { className: 'flex items-start justify-between gap-4 flex-wrap' },
      React.createElement(
        'div',
        null,
        React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Support chat'),
        React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Talk with the team and keep the full history here.')
      ),
      React.createElement(
        'div',
        { className: 'flex items-center gap-3 flex-wrap' },
        threads.length > 1
          ? React.createElement(
              'select',
              {
                value: supportThreadId || '',
                onChange: async (e) => {
                  const v = String(e.target.value || '')
                  if (!v) return
                  try {
                    await loadSupportThread(v)
                  } catch (err) {
                    setStatus({ kind: 'err', text: String(err?.message || err) })
                  }
                },
                className: 'px-4 py-2.5 rounded-full border border-gray-200 bg-white text-[14px] font-semibold text-[#1B1748]',
              },
              threads.map((t) =>
                React.createElement('option', { key: String(t.id || ''), value: String(t.id || '') }, String(t.subject || 'Support'))
              )
            )
          : null,
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: async () => {
              try {
                const list = await loadSupportThreads()
                const first = list.find((t) => String(t.status || '').toLowerCase() === 'open') || list[0] || null
                if (first && String(first.id || '')) {
                  await loadSupportThread(String(first.id || ''))
                }
              } catch (err) {
                setStatus({ kind: 'err', text: String(err?.message || err) })
              }
            },
            className:
              'px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
          },
          'Reload'
        )
      )
    ),
    React.createElement(
      'div',
      { className: 'mt-6 rounded-3xl border border-gray-100 bg-[#F6F7FB] p-4' },
      React.createElement(
        'div',
        { className: 'flex items-center justify-between gap-3 flex-wrap' },
        React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, activeLabel),
        supportThreadId
          ? null
          : React.createElement('input', {
              className:
                'w-full sm:w-auto sm:min-w-[260px] rounded-full border border-gray-200 bg-white px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              value: subject,
              onChange: (e) => setSubject(e.target.value),
              placeholder: 'Subject (optional)',
            })
      ),
      React.createElement(
        'div',
        { ref: scrollRef, className: 'mt-4 h-[360px] overflow-y-auto flex flex-col gap-3 pr-1' },
        supportMessages.length ? supportMessages.map(Bubble) : React.createElement('div', { className: 'text-sm text-gray-600 py-6 text-center' }, 'No messages yet.')
      ),
      React.createElement(
        'div',
        { className: 'mt-4 flex items-end gap-3' },
        React.createElement('textarea', {
          className:
            'flex-1 min-h-[46px] max-h-[120px] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          placeholder: 'Write a message…',
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: async () => {
              await sendSupportMessage({ subject, message: draft })
              setDraft('')
              setSubject('')
            },
            disabled: busy || !canSend,
            className:
              'px-6 py-3 rounded-full text-[14px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
          },
          busy ? 'Sending…' : 'Send'
        )
      )
    )
  )
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
  const [captchaQuestion, setCaptchaQuestion] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaAnswer, setCaptchaAnswer] = useState('')

  const [displayName, setDisplayName] = useState('')

  const [adminTab, setAdminTab] = useState('users')
  const [adminUsers, setAdminUsers] = useState([])
  const [adminMessages, setAdminMessages] = useState([])
  const [adminModal, setAdminModal] = useState(null)
  const [supportThreads, setSupportThreads] = useState([])
  const [supportThreadId, setSupportThreadId] = useState('')
  const [supportThread, setSupportThread] = useState(null)
  const [supportMessages, setSupportMessages] = useState([])
  const [supportUnreadCount, setSupportUnreadCount] = useState(0)
  const [adminSupportUnreadCount, setAdminSupportUnreadCount] = useState(0)
  const [supportAdminKeys, setSupportAdminKeys] = useState([])
  const [section, setSection] = useState(() => {
    const sp = new URLSearchParams(window.location.search)
    const s = String(sp.get('section') || '').trim().toLowerCase()
    if (s === 'plan' || s === 'plans' || s === 'billing') return 'billing'
    if (s === 'download' || s === 'downloads') return 'downloads'
    if (s === 'security') return 'security'
    if (s === 'support' || s === 'contact') return 'support'
    if (s === 'data' || s === 'my-data') return 'data'
    if (s === 'paypal') return 'paypal'
    if (s === 'users' || s === 'admin-users') return 'admin_users'
    if (s === 'messages' || s === 'admin-messages' || s === 'admin') return 'admin_messages'
    if (s === 'admin-settings' || s === 'settings') return 'admin_settings'
    return 'profile'
  })
  const [sessions, setSessions] = useState([])
  const [pwModal, setPwModal] = useState(null)
  const [deleteModal, setDeleteModal] = useState(null)
  const [publicConfig, setPublicConfig] = useState(null)
  const [adminConfig, setAdminConfig] = useState(null)
  const [adminPayPal, setAdminPayPal] = useState(null)
  const [adminPayPalSecret, setAdminPayPalSecret] = useState('')
  const [adminPayPalWebhookUrl, setAdminPayPalWebhookUrl] = useState('')
  const [adminPricingDraft, setAdminPricingDraft] = useState(null)
  const [adminPage, setAdminPage] = useState('overview')
  const [msgModal, setMsgModal] = useState(null)
  const [adminMsgFilter, setAdminMsgFilter] = useState('new')
  const [adminMsgQuery, setAdminMsgQuery] = useState('')
  const [adminUserQuery, setAdminUserQuery] = useState('')

  const displayNameInputRef = useRef(null)
  const chatKeyRef = useRef({ userId: '', publicJwk: null, privateKey: null })

  function closeAllPopups() {
    setAdminModal(null)
    setPwModal(null)
    setDeleteModal(null)
    setMsgModal(null)
  }

  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true

    ;(async () => {
      await loadPublicConfig().catch(() => null)
      try {
        const sp = new URLSearchParams(window.location.search)
        const subId = String(sp.get('subscription_id') || sp.get('subscriptionId') || '').trim()
        if (subId) {
          localStorage.setItem('kivana/paypalPendingSubId', subId)
          sp.delete('subscription_id')
          sp.delete('subscriptionId')
          const next = `${window.location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}`
          window.history.replaceState({}, '', next)
        }
      } catch {
        void 0
      }
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
    if (!me?.id) return
    let cancelled = false
    ;(async () => {
      let subId = ''
      try {
        subId = String(localStorage.getItem('kivana/paypalPendingSubId') || '').trim()
      } catch {
        subId = ''
      }
      if (!subId) return
      try {
        await apiFetch('/v1/portal/paypal/confirm', { method: 'POST', body: JSON.stringify({ subscriptionId: subId }) })
        if (cancelled) return
        try {
          localStorage.removeItem('kivana/paypalPendingSubId')
        } catch {
          void 0
        }
        await loadEntitlements()
        setStatus({ kind: 'ok', text: 'Subscription activated.' })
      } catch (e) {
        const msg = String(e?.message || e)
        setStatus({ kind: 'err', text: msg === 'paypal_subscription_not_found' ? 'PayPal subscription not found.' : msg })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me?.id])

  useEffect(() => {
    closeAllPopups()
  }, [section])

  useEffect(() => {
    if (!me?.isAdmin) return
    if (section === 'paypal') setAdminPage('paypal')
    if (section === 'admin_users') setAdminPage('users')
    if (section === 'admin_messages') setAdminPage('messages')
    if (section === 'admin_settings') setAdminPage('settings')
    if ((section === 'paypal' || section === 'admin_users' || section === 'admin_messages' || section === 'admin_settings') && (!adminConfig || !adminPayPal)) {
      void loadAdmin()
    }
  }, [section, me?.isAdmin])

  useEffect(() => {
    if (section !== 'support') return
    if (!me?.id) return
    let cancelled = false
    ;(async () => {
      try {
        await loadSupportAdminKeys().catch(() => null)
        const list = await loadSupportThreads()
        if (cancelled) return
        const first = list.find((t) => String(t.status || '').toLowerCase() === 'open') || list[0] || null
        if (!supportThreadId && first && String(first.id || '')) {
          await loadSupportThread(String(first.id || ''))
        } else if (supportThreadId) {
          await loadSupportThread(String(supportThreadId))
        }
      } catch {
        void 0
      }
    })()
    return () => {
      cancelled = true
    }
  }, [section, me?.id])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeAllPopups()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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

  async function ensureChatKeys() {
    if (!(window.crypto && window.crypto.subtle)) return null
    const userId = String(me?.id || '')
    if (!userId) return null
    if (chatKeyRef.current.userId === userId && chatKeyRef.current.privateKey && chatKeyRef.current.publicJwk) {
      return chatKeyRef.current
    }
    const kp = await getOrCreateChatKeypair(userId)
    chatKeyRef.current = { userId, publicJwk: kp.publicJwk, privateKey: kp.privateKey }
    try {
      const res = await apiFetch('/v1/crypto/public-key', { method: 'GET' })
      const json = await res.json().catch(() => ({}))
      if (!json?.publicJwk) {
        await apiFetch('/v1/crypto/public-key', { method: 'POST', body: JSON.stringify({ publicJwk: kp.publicJwk }) })
      }
    } catch {
      void 0
    }
    return chatKeyRef.current
  }

  async function loadSupportAdminKeys() {
    const res = await apiFetch('/v1/support/admin-keys', { method: 'GET' })
    const json = await res.json()
    const list = Array.isArray(json?.admins) ? json.admins : []
    setSupportAdminKeys(list)
    return list
  }

  async function refreshUnreadBadges() {
    try {
      const res = await apiFetch('/v1/support/unread-count', { method: 'GET' })
      const json = await res.json().catch(() => ({}))
      setSupportUnreadCount(Number(json?.count || 0))
    } catch {
      setSupportUnreadCount(0)
    }
    if (me?.isAdmin) {
      try {
        const res = await apiFetch('/v1/admin/support/unread-count', { method: 'GET' })
        const json = await res.json().catch(() => ({}))
        setAdminSupportUnreadCount(Number(json?.count || 0))
      } catch {
        setAdminSupportUnreadCount(0)
      }
    } else {
      setAdminSupportUnreadCount(0)
    }
  }

  useEffect(() => {
    if (!me?.id) return
    let stopped = false
    ;(async () => {
      if (stopped) return
      await refreshUnreadBadges()
    })()
    const t = window.setInterval(() => {
      if (stopped) return
      void refreshUnreadBadges()
    }, 15_000)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  }, [me?.id, me?.isAdmin])

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

  async function refreshCaptcha() {
    try {
      const c = await fetchCaptchaChallenge()
      setCaptchaQuestion(c.question)
      setCaptchaToken(c.token)
      setCaptchaAnswer('')
    } catch {
      setCaptchaQuestion('Reload the page to try again.')
      setCaptchaToken('')
      setCaptchaAnswer('')
    }
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
    if (!String(captchaToken || '').trim() || !String(captchaAnswer || '').trim()) {
      setStatus({ kind: 'err', text: 'Please complete the human check.' })
      return
    }
    setBusy(true)
    try {
      const endpoint = authMode === 'signup' ? '/v1/auth/signup' : '/v1/auth/login'
      const res = await apiFetch(
        endpoint,
        { method: 'POST', body: JSON.stringify({ email: em, password: pw, captchaToken: captchaToken, captchaAnswer: captchaAnswer }) },
        { allowRetry: false }
      )
      const json = await res.json()
      setTokens(json.accessToken, json.refreshToken)
      setPassword('')
      setCaptchaAnswer('')
      await loadSession()
    } catch (err) {
      const msg = String(err?.message || err)
      setStatus({
        kind: 'err',
        text:
          msg === 'captcha_required' || msg === 'captcha_failed'
            ? 'Human check failed. Please try again.'
            : msg,
      })
      await refreshCaptcha().catch(() => null)
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
      const normalized = c === 'lifetime' ? 'lifetime_pro' : c
      if (normalized === 'standard' || normalized === 'pro') {
        const currency = pricing?.code || 'EUR'
        const returnUrl = `${window.location.origin}/account/?section=billing&paypal=1`
        const cancelUrl = `${window.location.origin}/account/?section=billing&paypal=0`
        try {
          const res = await apiFetch('/v1/portal/paypal/start', {
            method: 'POST',
            body: JSON.stringify({ planCode: normalized, billingCycle, currency, returnUrl, cancelUrl }),
          })
          const json = await res.json()
          const url = String(json?.approvalUrl || '').trim()
          if (!url) throw new Error('paypal_start_failed')
          window.location.assign(url)
          return
        } catch (e) {
          const msg = String(e?.message || e)
          if (msg === 'paypal_disabled') {
            await apiFetch('/v1/portal/select-plan', { method: 'POST', body: JSON.stringify({ planCode: normalized, billingCycle }) })
            setStatus({ kind: 'ok', text: 'Plan updated.' })
            await loadEntitlements()
            return
          }
          throw e
        }
      }
      await apiFetch('/v1/portal/select-plan', { method: 'POST', body: JSON.stringify({ planCode: normalized, billingCycle }) })
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
      const [uRes, mRes, cRes, pRes] = await Promise.all([
        apiFetch('/v1/admin/users', { method: 'GET' }),
        apiFetch('/v1/admin/support/threads', { method: 'GET' }),
        apiFetch('/v1/admin/config', { method: 'GET' }),
        apiFetch('/v1/admin/paypal/config', { method: 'GET' }),
      ])
      const uJson = await uRes.json()
      const mJson = await mRes.json()
      const cJson = await cRes.json()
      const pJson = await pRes.json()
      setAdminUsers(Array.isArray(uJson?.users) ? uJson.users : [])
      setAdminMessages(Array.isArray(mJson?.threads) ? mJson.threads : [])
      setAdminConfig(cJson || null)
      setAdminPayPal(pJson || null)
      setAdminPayPalSecret('')
      setAdminPayPalWebhookUrl((prev) => prev || computeDefaultPayPalWebhookUrl())
      setAdminPricingDraft(() => {
        const pricing = cJson?.pricing || {}
        const std = pricing?.standardMonthly || {}
        const pro = pricing?.proMonthly || {}
        return {
          yearlyFactor: String(pricing?.yearlyFactor ?? ''),
          trialDays: String(pricing?.trialDays ?? ''),
          standardMonthly: { eur: formatAmount(std?.eur), gbp: formatAmount(std?.gbp), nok: formatAmount(std?.nok) },
          proMonthly: { eur: formatAmount(pro?.eur), gbp: formatAmount(pro?.gbp), nok: formatAmount(pro?.nok) },
        }
      })
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

  async function savePayPalConfig(nextCfg) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const payload = { ...(nextCfg || {}), secret: adminPayPalSecret || undefined }
      await apiFetch('/v1/admin/paypal/config', { method: 'POST', body: JSON.stringify(payload) })
      setStatus({ kind: 'ok', text: 'PayPal settings saved.' })
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function syncPayPalPlans() {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch('/v1/admin/paypal/sync-plans', { method: 'POST', body: JSON.stringify({}) })
      setStatus({ kind: 'ok', text: 'PayPal plans synced.' })
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function createPayPalWebhook(nextWebhookUrl) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const webhookUrl = String(nextWebhookUrl || '').trim()
      await apiFetch('/v1/admin/paypal/webhook/create', { method: 'POST', body: JSON.stringify({ webhookUrl: webhookUrl || undefined }) })
      setStatus({ kind: 'ok', text: 'PayPal webhook created.' })
      await loadAdmin()
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
      const endpoint = read
        ? `/v1/admin/support/threads/${encodeURIComponent(id)}/archive`
        : `/v1/admin/support/threads/${encodeURIComponent(id)}/unarchive`
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) })
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function adminSolveThread(id, solve) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const endpoint = solve
        ? `/v1/admin/support/threads/${encodeURIComponent(id)}/solve`
        : `/v1/admin/support/threads/${encodeURIComponent(id)}/reopen`
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) })
      await loadAdmin()
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function adminDeleteSupportThread(id) {
    if (busy) return
    if (!window.confirm('Delete this support chat? This cannot be undone.')) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch(`/v1/admin/support/threads/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setMsgModal(null)
      await loadAdmin()
      setStatus({ kind: 'ok', text: 'Chat deleted.' })
    } catch (e) {
      setStatus({ kind: 'err', text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  async function loadSupportThreads() {
    const res = await apiFetch('/v1/support/threads', { method: 'GET' })
    const json = await res.json()
    const list = Array.isArray(json?.threads) ? json.threads : []
    setSupportThreads(list)
    return list
  }

  async function loadSupportThread(threadId) {
    const tid = String(threadId || '')
    if (!tid) return null
    const res = await apiFetch(`/v1/support/threads/${encodeURIComponent(tid)}`, { method: 'GET' })
    const json = await res.json()
    setSupportThread(json?.thread || null)
    const msgs = Array.isArray(json?.messages) ? json.messages : []
    const needsDecrypt = msgs.some((m) => isE2EEBody(m?.body))
    if (needsDecrypt) {
      const kp = await ensureChatKeys().catch(() => null)
      setSupportMessages(await decryptE2EEMessagesIfPossible(msgs, kp))
    } else {
      setSupportMessages(msgs)
    }
    setSupportThreadId(String(json?.thread?.id || tid))
    return json
  }

  async function createSupportThread(subject, message) {
    if (!(window.crypto && window.crypto.subtle)) throw new Error('crypto_unavailable')
    const kp = await ensureChatKeys()
    if (!kp?.userId || !kp?.publicJwk) throw new Error('crypto_key_missing')
    const admins = supportAdminKeys.length ? supportAdminKeys : await loadSupportAdminKeys()
    if (!admins.length) throw new Error('support_keys_missing')
    const recipients = [{ id: kp.userId, publicJwk: kp.publicJwk }, ...admins]
    const enc = await e2eeEncryptMessage(String(message || ''), recipients)
    const res = await apiFetch('/v1/support/threads', { method: 'POST', body: JSON.stringify({ subject: subject || null, message: enc }) })
    const json = await res.json()
    setSupportThread(json?.thread || null)
    const msgs = Array.isArray(json?.messages) ? json.messages : []
    setSupportMessages(await decryptE2EEMessagesIfPossible(msgs, kp))
    setSupportThreadId(String(json?.thread?.id || ''))
    return json
  }

  async function sendSupportThreadMessage(threadId, message) {
    const tid = String(threadId || '')
    if (!tid) throw new Error('Missing thread')
    if (!(window.crypto && window.crypto.subtle)) throw new Error('crypto_unavailable')
    const kp = await ensureChatKeys()
    if (!kp?.userId || !kp?.publicJwk) throw new Error('crypto_key_missing')
    const admins = supportAdminKeys.length ? supportAdminKeys : await loadSupportAdminKeys()
    if (!admins.length) throw new Error('support_keys_missing')
    const recipients = [{ id: kp.userId, publicJwk: kp.publicJwk }, ...admins]
    const enc = await e2eeEncryptMessage(String(message || ''), recipients)
    await apiFetch(`/v1/support/threads/${encodeURIComponent(tid)}/messages`, { method: 'POST', body: JSON.stringify({ message: enc }) })
  }

  async function adminLoadSupportThread(threadId) {
    const tid = String(threadId || '')
    if (!tid) return null
    const res = await apiFetch(`/v1/admin/support/threads/${encodeURIComponent(tid)}`, { method: 'GET' })
    const json = await res.json()
    const kp = await ensureChatKeys().catch(() => null)
    if (kp?.privateKey && kp?.userId) return { ...json, messages: await decryptE2EEMessagesIfPossible(json?.messages, kp) }
    return json
  }

  async function adminListSupportThreadsByUser(userId) {
    const uid = String(userId || '').trim()
    if (!uid) return []
    const res = await apiFetch(`/v1/admin/support/threads?user_id=${encodeURIComponent(uid)}&status=all`, { method: 'GET' })
    const json = await res.json().catch(() => ({}))
    return Array.isArray(json?.threads) ? json.threads : []
  }

  async function adminSendSupportThreadMessage(threadId, userId, message) {
    const tid = String(threadId || '')
    if (!tid) throw new Error('Missing thread')
    const uid = String(userId || '')
    if (!uid) throw new Error('Missing user')
    const kp = await ensureChatKeys()
    const admins = supportAdminKeys.length ? supportAdminKeys : await loadSupportAdminKeys()
    const userRes = await apiFetch(`/v1/admin/users/${encodeURIComponent(uid)}/public-key`, { method: 'GET' })
    const userJson = await userRes.json().catch(() => ({}))
    const userJwk = userJson?.publicJwk || null
    if (!userJwk) throw new Error('user_missing_key')
    const recipients = [{ id: uid, publicJwk: userJwk }, { id: kp.userId, publicJwk: kp.publicJwk }, ...admins]
    const enc = await e2eeEncryptMessage(message, recipients)
    await apiFetch(`/v1/admin/support/threads/${encodeURIComponent(tid)}/messages`, { method: 'POST', body: JSON.stringify({ message: enc }) })
  }

  async function sendSupportMessage({ subject, message }) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      const subj = String(subject || '').trim() || 'Support request'
      const msg = String(message || '').trim()
      if (!msg) throw new Error('Missing fields')
      if (!supportThreadId) {
        await createSupportThread(subj, msg)
      } else {
        await sendSupportThreadMessage(supportThreadId, msg)
        await loadSupportThread(supportThreadId)
      }
      await loadSupportThreads()
      setStatus({ kind: 'ok', text: 'Sent.' })
    } catch (e) {
      const msg = String(e?.message || e)
      setStatus({
        kind: 'err',
        text:
          msg === 'Missing fields'
            ? 'Message is required.'
            : msg === 'crypto_unavailable'
              ? 'Encrypted chat is not supported in this browser.'
              : msg === 'crypto_key_missing'
                ? 'Encrypted chat keys are missing. Refresh and try again.'
                : msg === 'encryption_required'
                  ? 'Encryption is required. Refresh and try again.'
                  : msg === 'support_keys_missing'
                    ? 'Encrypted support chat is not ready yet. Please ask an admin to sign in once to enable it.'
                    : msg,
      })
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

  function openUserModal(user) {
    setStatus({ kind: 'muted', text: '' })
    const uid = String(user?.id || '')
    setAdminModal({ kind: 'user', user, supportThreads: [], supportThreadsLoading: true })
    if (!uid) return
    ;(async () => {
      try {
        const threads = await adminListSupportThreadsByUser(uid)
        setAdminModal((m) => {
          if (!m || String(m.kind || '') !== 'user') return m
          if (String(m.user?.id || '') !== uid) return m
          return { ...m, supportThreads: threads, supportThreadsLoading: false }
        })
      } catch (e) {
        setAdminModal((m) => {
          if (!m || String(m.kind || '') !== 'user') return m
          if (String(m.user?.id || '') !== uid) return m
          return { ...m, supportThreads: [], supportThreadsLoading: false }
        })
        setStatus({ kind: 'err', text: String(e?.message || e) })
      }
    })()
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

  async function adminToggleAdmin(userId, enabled) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch(`/v1/admin/users/${encodeURIComponent(String(userId))}/admin`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !!enabled }),
      })
      setStatus({ kind: 'ok', text: 'Admin role updated.' })
      await loadAdmin()
    } catch (e) {
      const msg = String(e?.message || e)
      setStatus({
        kind: 'err',
        text:
          msg === 'cannot_demote_self'
            ? 'You cannot remove admin from yourself.'
            : msg === 'cannot_remove_last_admin'
              ? 'Cannot remove the last admin.'
              : msg,
      })
    } finally {
      setBusy(false)
    }
  }

  async function adminToggleFounder(userId, enabled) {
    if (busy) return
    setBusy(true)
    setStatus({ kind: 'muted', text: '' })
    try {
      await apiFetch(`/v1/admin/users/${encodeURIComponent(String(userId))}/founder`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !!enabled }),
      })
      setStatus({ kind: 'ok', text: 'Founder updated.' })
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
      kind === 'user'
        ? `User (${email})`
        : kind === 'password'
          ? `Set password (${email})`
          : kind === 'grant'
            ? `Set subscription (${email})`
            : kind === 'discount'
              ? `Set discount (${email})`
              : kind === 'deleteUser'
                ? `Delete user (${email})`
                : 'Admin'

    const body =
      kind === 'user'
        ? (() => {
            const userId = String(user.id || '')
            const createdAt = user.createdAt ? formatRfc3339Short(user.createdAt) : '—'
            const pwChanged = user.passwordChangedAt ? formatRfc3339Short(user.passwordChangedAt) : '—'
            const lastIp = String(user.lastIp || '—')
            const trialActive = user.kivanaTrialEndsAt && new Date(String(user.kivanaTrialEndsAt)).getTime() > Date.now()
            const planCode = trialActive ? 'trial' : String(user.kivanaPlanCode || 'basic').toLowerCase()
            const planLabel = trialActive ? 'Trial' : String(user.kivanaPlanName || normalizePlanLabel(planCode) || 'Basic')
            const ends = trialActive ? user.kivanaTrialEndsAt : user.kivanaEndsAt
            const role = user.isAdmin ? 'ADMIN' : user.isModerator ? 'MOD' : 'USER'
            const discountPct = user.discountPercent != null ? `${user.discountPercent}%` : '—'
            const discountLabel = String(user.discountLabel || '—')
            const discountUntil = user.discountExpiresAt ? formatRfc3339Short(user.discountExpiresAt) : '—'
            const threadsLoading = !!adminModal.supportThreadsLoading
            const threads = Array.isArray(adminModal.supportThreads) ? adminModal.supportThreads : []
            const threadPill = (t) => {
              const s = String(t?.status || '').toLowerCase()
              if (s === 'solved') return React.createElement(Pill, { kind: 'ok' }, 'SOLVED')
              if (s === 'archived') return React.createElement(Pill, { kind: 'muted' }, 'ARCHIVED')
              if (t?.hasUnread) return React.createElement(Pill, { kind: 'warn' }, 'NEW')
              return React.createElement(Pill, { kind: 'muted' }, 'OPEN')
            }

            return React.createElement(
              'div',
              { className: 'grid gap-4' },
              React.createElement(
                'div',
                { className: 'rounded-2xl border border-gray-100 bg-gray-50 p-5' },
                React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, email || '—'),
                React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, `ID: ${userId || '—'}`),
                React.createElement(
                  'div',
                  { className: 'mt-3 flex items-center gap-2 flex-wrap' },
                  React.createElement(Pill, { kind: user.isAdmin ? 'ok' : user.isModerator ? 'warn' : 'muted' }, role),
                  user.isFounder ? React.createElement(Pill, { kind: 'ok' }, 'FOUNDER') : null,
                  React.createElement(Pill, { kind: planCode === 'basic' ? 'muted' : 'ok' }, planLabel)
                )
              ),
              React.createElement(
                'div',
                { className: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
                React.createElement('div', { className: 'rounded-2xl border border-gray-100 px-5 py-4' }, React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'CREATED'), React.createElement('div', { className: 'mt-1 text-sm font-semibold text-[#1B1748]' }, createdAt)),
                React.createElement('div', { className: 'rounded-2xl border border-gray-100 px-5 py-4' }, React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'LAST IP'), React.createElement('div', { className: 'mt-1 text-sm font-semibold text-[#1B1748]' }, lastIp)),
                React.createElement('div', { className: 'rounded-2xl border border-gray-100 px-5 py-4' }, React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'PASSWORD CHANGED'), React.createElement('div', { className: 'mt-1 text-sm font-semibold text-[#1B1748]' }, pwChanged)),
                React.createElement('div', { className: 'rounded-2xl border border-gray-100 px-5 py-4' }, React.createElement('div', { className: 'text-[11px] tracking-wide font-extrabold text-gray-500' }, 'PLAN ENDS'), React.createElement('div', { className: 'mt-1 text-sm font-semibold text-[#1B1748]' }, ends ? formatRfc3339Short(ends) : '—'))
              ),
              React.createElement(
                'div',
                { className: 'rounded-2xl border border-gray-100 px-5 py-4' },
                React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Discount'),
                React.createElement('div', { className: 'mt-2 text-sm text-gray-700' }, `Percent: ${discountPct}`),
                React.createElement('div', { className: 'mt-1 text-sm text-gray-700' }, `Label: ${discountLabel}`),
                React.createElement('div', { className: 'mt-1 text-sm text-gray-700' }, `Expires: ${discountUntil}`)
              ),
              React.createElement(
                'div',
                { className: 'rounded-2xl border border-gray-100 px-5 py-4' },
                React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Support history'),
                threadsLoading
                  ? React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'Loading…')
                  : threads.length
                    ? React.createElement(
                        'div',
                        { className: 'mt-3 grid gap-2' },
                        threads.map((t) => {
                          const tid = String(t.id || '')
                          return React.createElement(
                            'div',
                            { key: tid, className: 'flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 flex-wrap' },
                            React.createElement(
                              'div',
                              null,
                              React.createElement('div', { className: 'text-sm font-semibold text-[#1B1748]' }, String(t.subject || 'Support')),
                              React.createElement('div', { className: 'mt-0.5 text-xs text-gray-600' }, `Last: ${formatRfc3339Short(t.lastMessageAt || t.last_message_at || '')}`)
                            ),
                            React.createElement(
                              'div',
                              { className: 'flex items-center gap-3' },
                              threadPill(t),
                              React.createElement(
                                'button',
                                {
                                  className:
                                    'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                                  type: 'button',
                                  onClick: async () => {
                                    if (!tid) return
                                    setMsgModal({ kind: 'support', threadId: tid, thread: t, messages: [], reply: '', loading: true })
                                    try {
                                      const json = await adminLoadSupportThread(tid)
                                      setMsgModal((m) => {
                                        if (!m || m.kind !== 'support' || String(m.threadId || '') !== tid) return m
                                        return { ...m, thread: json?.thread || t, messages: Array.isArray(json?.messages) ? json.messages : [], loading: false }
                                      })
                                      await loadAdmin()
                                    } catch (err) {
                                      setMsgModal(null)
                                      setStatus({ kind: 'err', text: String(err?.message || err) })
                                    }
                                  },
                                  disabled: busy,
                                },
                                'Open'
                              )
                            )
                          )
                        })
                      )
                    : React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'No support chats for this user.')
              ),
              React.createElement(
                'div',
                { className: 'flex items-center gap-3 flex-wrap justify-end' },
                React.createElement(
                  'button',
                  {
                    className:
                      'px-4 py-2.5 rounded-full text-[14px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                    type: 'button',
                    onClick: () => openGrantModal(user),
                    disabled: busy,
                  },
                  'Subscription'
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-4 py-2.5 rounded-full text-[14px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                    type: 'button',
                    onClick: () => openDiscountModal(user),
                    disabled: busy,
                  },
                  'Discount'
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-4 py-2.5 rounded-full text-[14px] font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                    type: 'button',
                    onClick: () => openPasswordModal(user),
                    disabled: busy,
                  },
                  'Password'
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-4 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                    type: 'button',
                    onClick: () => adminToggleModerator(String(user.email || ''), !user.isModerator),
                    disabled: busy || !!user.isAdmin,
                  },
                  user.isModerator ? 'Remove mod' : 'Make mod'
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-4 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                    type: 'button',
                    onClick: () => adminToggleFounder(user.id, !user.isFounder),
                    disabled: busy || !!user.isAdmin,
                  },
                  user.isFounder ? 'Remove founder' : 'Make founder'
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-4 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                    type: 'button',
                    onClick: () => adminToggleAdmin(user.id, !user.isAdmin),
                    disabled: busy || (String(me?.id || '') === String(user.id || '') && !!user.isAdmin),
                  },
                  user.isAdmin ? 'Remove admin' : 'Make admin'
                ),
                React.createElement(
                  'button',
                  {
                    className:
                      'px-4 py-2.5 rounded-full text-[14px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
                    type: 'button',
                    onClick: () => openDeleteUserModal(user),
                    disabled: busy || !!user.isAdmin,
                  },
                  'Delete'
                )
              )
            )
          })()
        : kind === 'password'
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
                    autoFocus: true,
                  })
                )
              : null

    const confirmLabel = kind === 'deleteUser' ? 'Delete' : kind === 'user' ? 'Close' : 'Save'
    const confirmKind =
      kind === 'deleteUser'
        ? 'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none'
        : 'px-5 py-2.5 rounded-full text-[15px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none'

    const onConfirm = async () => {
      if (kind === 'user') {
        closeAdminModal()
        return
      }
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
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    disabled: busy,
                    onClick: async () => {
                      closeAllPopups()
                      if (me?.isAdmin) {
                      setSection('admin_messages')
                        setAdminPage('messages')
                        await loadAdmin()
                      } else {
                        setSection('support')
                      }
                    },
                    className:
                      'relative w-11 h-11 rounded-full border border-gray-200 bg-white text-[#1B1748] hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center',
                    title: me?.isAdmin ? 'Support inbox' : 'Support chat',
                  },
                  React.createElement(
                    'svg',
                    { viewBox: '0 0 24 24', fill: 'none', className: 'w-5 h-5' },
                    React.createElement('path', { d: 'M4 6.5C4 5.12 5.12 4 6.5 4H17.5C18.88 4 20 5.12 20 6.5V15.5C20 16.88 18.88 18 17.5 18H9l-5 3v-3.5C4 16.12 4 6.5 4 6.5Z', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }),
                    React.createElement('path', { d: 'M7 8h10M7 11h8', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })
                  ),
                  (me?.isAdmin ? adminSupportUnreadCount : supportUnreadCount) > 0
                    ? React.createElement(
                        'span',
                        {
                          className:
                            'absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-[#4F3DDD] text-white text-[11px] font-extrabold flex items-center justify-center',
                        },
                        String(me?.isAdmin ? adminSupportUnreadCount : supportUnreadCount)
                      )
                    : null
                ),
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
    useEffect(() => {
      void refreshCaptcha()
    }, [authMode])

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
            'div',
            null,
            React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Human check'),
            React.createElement('div', { className: 'mt-2 text-sm text-gray-600 font-semibold' }, captchaQuestion || 'Loading…'),
            React.createElement('input', {
              className:
                'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              type: 'text',
              inputMode: 'numeric',
              value: captchaAnswer,
              onChange: (e) => setCaptchaAnswer(e.target.value),
              autoComplete: 'off',
              placeholder: 'Answer',
              disabled: busy || !String(captchaToken || '').trim(),
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

    function NavItem({ id, label, icon, count, onSelect }) {
      const active = section === id
      return React.createElement(
        'button',
        {
          type: 'button',
          onClick: async () => {
            closeAllPopups()
            if (onSelect) {
              await onSelect()
              return
            }
            setSection(id)
            if ((id === 'paypal' || id === 'admin_users' || id === 'admin_messages' || id === 'admin_settings') && me?.isAdmin) await loadAdmin()
          },
          className: `w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[14px] font-semibold transition-colors ${
            active ? 'bg-[#F0EEFC] text-[#4F3DDD]' : 'text-gray-700 hover:bg-gray-50'
          }`,
        },
        React.createElement('span', { className: 'w-5 h-5 text-current' }, icon),
        React.createElement('span', null, label),
        typeof count === 'number' && count > 0
          ? React.createElement(
              'span',
              { className: 'ml-auto min-w-[26px] h-6 px-2 rounded-full bg-[#4F3DDD] text-white text-xs font-extrabold flex items-center justify-center' },
              String(count)
            )
          : null
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
          { className: 'mt-6 kp-grid kp-plan-grid' },
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
      const basicMacUrl = 'https://github.com/kivana-software/Kivana/releases/download/v0.4.16-basic/Kivana_0.4.16_aarch64.dmg'
      const basicWinUrl = 'https://github.com/kivana-software/Kivana/releases/download/v0.4.16-basic/Kivana_0.4.16_x64_en-US.msi'
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
          React.createElement(DlCard, { title: 'macOS', sub: 'Apple Silicon • v0.4.16 Basic', href: basicMacUrl }),
          React.createElement(DlCard, { title: 'Windows', sub: 'x64 • v0.4.16 Basic', href: basicWinUrl }),
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
            { className: 'mt-6 kp-grid kp-two-col' },
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
      const [draft, setDraft] = useState('')
      const scrollRef = useRef(null)

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const list = await loadSupportThreads()
            if (!alive) return
            const first = list.find((t) => String(t.status || '').toLowerCase() === 'open') || list[0] || null
            if (first && String(first.id || '')) {
              await loadSupportThread(String(first.id || ''))
            }
          } catch {
            void 0
          }
        })()
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
      }, [supportThreadId, supportMessages.length])

      const canSend = String(draft || '').trim().length > 0
      const active = supportThread || null
      const threads = Array.isArray(supportThreads) ? supportThreads : []
      const activeLabel = active?.subject ? String(active.subject) : supportThreadId ? 'Support' : 'New message'

      const Bubble = (m) => {
        const role = String(m.senderRole || m.sender_role || '').toLowerCase()
        const mine = role !== 'admin'
        const body = String(m.body || '').trim()
        const when = m.createdAt ? formatRfc3339Short(m.createdAt) : ''
        const wrapCls = mine ? 'w-full flex justify-end' : 'w-full flex justify-start'
        const bubbleCls = mine
          ? 'max-w-[80%] rounded-2xl bg-[#4F3DDD] text-white px-4 py-3 text-[14px] leading-relaxed'
          : 'max-w-[80%] rounded-2xl bg-white border border-gray-200 text-gray-800 px-4 py-3 text-[14px] leading-relaxed'
        return React.createElement(
          'div',
          { key: String(m.id || Math.random()), className: wrapCls },
          React.createElement(
            'div',
            { className: mine ? 'flex flex-col items-end' : 'flex flex-col items-start' },
            React.createElement('div', { className: bubbleCls }, body || '—'),
            when ? React.createElement('div', { className: `mt-1 text-[11px] ${mine ? 'text-right text-gray-500' : 'text-left text-gray-500'}` }, when) : null
          )
        )
      }

      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement(
          'div',
          { className: 'flex items-start justify-between gap-4 flex-wrap' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Support chat'),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Talk with the team and keep the full history here.')
          ),
          React.createElement(
            'div',
            { className: 'flex items-center gap-3 flex-wrap' },
            threads.length > 1
              ? React.createElement(
                  'select',
                  {
                    value: supportThreadId || '',
                    onChange: async (e) => {
                      const v = String(e.target.value || '')
                      if (!v) return
                      try {
                        await loadSupportThread(v)
                      } catch (err) {
                        setStatus({ kind: 'err', text: String(err?.message || err) })
                      }
                    },
                    className: 'px-4 py-2.5 rounded-full border border-gray-200 bg-white text-[14px] font-semibold text-[#1B1748]',
                    disabled: busy,
                  },
                  threads.map((t) =>
                    React.createElement('option', { key: String(t.id || ''), value: String(t.id || '') }, String(t.subject || 'Support'))
                  )
                )
              : null,
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: async () => {
                  try {
                    const list = await loadSupportThreads()
                    const first = list.find((t) => String(t.status || '').toLowerCase() === 'open') || list[0] || null
                    if (first && String(first.id || '')) {
                      await loadSupportThread(String(first.id || ''))
                    }
                  } catch (err) {
                    setStatus({ kind: 'err', text: String(err?.message || err) })
                  }
                },
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
          { className: 'mt-6 rounded-3xl border border-gray-100 bg-[#F6F7FB] p-4' },
          React.createElement(
            'div',
            { className: 'flex items-center justify-between gap-3 flex-wrap' },
            React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, activeLabel),
            supportThreadId
              ? null
              : React.createElement(
                  'input',
                  {
                    className:
                      'w-full sm:w-auto sm:min-w-[260px] rounded-full border border-gray-200 bg-white px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                    value: subject,
                    onChange: (e) => setSubject(e.target.value),
                    disabled: busy,
                    placeholder: 'Subject (optional)',
                  }
                )
          ),
          React.createElement(
            'div',
            { ref: scrollRef, className: 'mt-4 h-[360px] overflow-y-auto flex flex-col gap-3 pr-1' },
            supportMessages.length ? supportMessages.map(Bubble) : React.createElement('div', { className: 'text-sm text-gray-600 py-6 text-center' }, 'No messages yet.')
          ),
          React.createElement(
            'div',
            { className: 'mt-4 flex items-end gap-3' },
            React.createElement('textarea', {
              className:
                'flex-1 min-h-[46px] max-h-[120px] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              value: draft,
              onChange: (e) => setDraft(e.target.value),
              disabled: busy,
              placeholder: 'Write a message…',
            }),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: async () => {
                  await sendSupportMessage({ subject, message: draft })
                  setDraft('')
                  setSubject('')
                },
                disabled: busy || !canSend,
                className:
                  'px-6 py-3 rounded-full text-[14px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
              },
              busy ? 'Sending…' : 'Send'
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
      if (section === 'support')
        return React.createElement(SupportChatSection, {
          busy,
          supportThreads,
          supportThreadId,
          supportThread,
          supportMessages,
          loadSupportThreads,
          loadSupportThread,
          sendSupportMessage,
          setStatus,
        })
      if (section === 'data') return React.createElement(DataSection, null)
      if (section === 'paypal' || section === 'admin_users' || section === 'admin_messages' || section === 'admin_settings') return React.createElement(Admin, null)
      return React.createElement(ProfileSection, null)
    }

    return React.createElement(
      'div',
      { className: 'kp-shell' },
      React.createElement(
        'aside',
        { className: 'kp-aside shrink-0' },
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-2' },
          React.createElement(NavItem, {
            id: 'profile',
            label: 'Profile',
            icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Z', stroke: 'currentColor', strokeWidth: 1.8 }), React.createElement('path', { d: 'M4.5 20c1.8-3.2 5.1-5 7.5-5s5.7 1.8 7.5 5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })),
          }),
          me?.isAdmin
            ? React.createElement(NavItem, {
                id: 'paypal',
                label: 'PayPal',
                onSelect: async () => {
                  setSection('paypal')
                  setAdminPage('paypal')
                  await loadAdmin()
                },
                icon: React.createElement(
                  'svg',
                  { viewBox: '0 0 24 24', fill: 'none' },
                  React.createElement('path', { d: 'M7 7.5C7 6.12 8.12 5 9.5 5H14.5C15.88 5 17 6.12 17 7.5V16.5C17 17.88 15.88 19 14.5 19H9.5C8.12 19 7 17.88 7 16.5V7.5Z', stroke: 'currentColor', strokeWidth: 1.8 }),
                  React.createElement('path', { d: 'M9.5 9.5h5M9.5 12h5M9.5 14.5h3', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })
                ),
              })
            : null,
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
          me?.isAdmin
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement(NavItem, {
                  id: 'admin_users',
                  label: 'Users',
                  count: adminUsers.length,
                  onSelect: async () => {
                    setSection('admin_users')
                    setAdminPage('users')
                    await loadAdmin()
                  },
                  icon: React.createElement(
                    'svg',
                    { viewBox: '0 0 24 24', fill: 'none' },
                    React.createElement('path', { d: 'M8 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8 11Z', stroke: 'currentColor', strokeWidth: 1.8 }),
                    React.createElement('path', { d: 'M4.5 20c.9-2.9 3-4.5 3.5-4.5s2.6 1.6 3.5 4.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
                    React.createElement('path', { d: 'M16 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 16 11Z', stroke: 'currentColor', strokeWidth: 1.8 }),
                    React.createElement('path', { d: 'M12.5 20c.9-2.9 3-4.5 3.5-4.5s2.6 1.6 3.5 4.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })
                  ),
                }),
                React.createElement(NavItem, {
                  id: 'admin_messages',
                  label: 'Messages',
                  count: adminSupportUnreadCount,
                  onSelect: async () => {
                    setSection('admin_messages')
                    setAdminPage('messages')
                    await loadAdmin()
                  },
                  icon: React.createElement(
                    'svg',
                    { viewBox: '0 0 24 24', fill: 'none' },
                    React.createElement('path', { d: 'M4 6.5C4 5.12 5.12 4 6.5 4H17.5C18.88 4 20 5.12 20 6.5V15.5C20 16.88 18.88 18 17.5 18H9l-5 3v-3.5C4 16.12 4 6.5 4 6.5Z', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }),
                    React.createElement('path', { d: 'M7 8h10M7 11h8', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })
                  ),
                }),
                React.createElement(NavItem, {
                  id: 'admin_settings',
                  label: 'Admin settings',
                  onSelect: async () => {
                    setSection('admin_settings')
                    setAdminPage('settings')
                    await loadAdmin()
                  },
                  icon: React.createElement(
                    'svg',
                    { viewBox: '0 0 24 24', fill: 'none' },
                    React.createElement('path', { d: 'M12 15a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z', stroke: 'currentColor', strokeWidth: 1.8 }),
                    React.createElement('path', { d: 'M19.4 15a7.9 7.9 0 0 0 .1-2l2-1.5-2-3.5-2.3.7a7.6 7.6 0 0 0-1.7-1l-.3-2.4H11l-.3 2.4a7.6 7.6 0 0 0-1.7 1L6.7 8 4.7 11.5 6.7 13a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.5 2.3-.7a7.6 7.6 0 0 0 1.7 1l.3 2.4h4l.3-2.4a7.6 7.6 0 0 0 1.7-1l2.3.7 2-3.5Z', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' })
                  ),
                })
              )
            : React.createElement(NavItem, {
                id: 'support',
                label: 'Contact support',
                count: supportUnreadCount,
                icon: React.createElement(
                  'svg',
                  { viewBox: '0 0 24 24', fill: 'none' },
                  React.createElement('path', { d: 'M4 6.5C4 5.12 5.12 4 6.5 4H17.5C18.88 4 20 5.12 20 6.5V15.5C20 16.88 18.88 18 17.5 18H9l-5 3v-3.5C4 16.12 4 6.5 4 6.5Z', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }),
                  React.createElement('path', { d: 'M7 8h10M7 11h8', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' })
                ),
              }),
          React.createElement(NavItem, {
            id: 'data',
            label: 'My data',
            icon: React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: 'M6 7c0-1.66 2.69-3 6-3s6 1.34 6 3-2.69 3-6 3-6-1.34-6-3Z', stroke: 'currentColor', strokeWidth: 1.8 }), React.createElement('path', { d: 'M6 7v10c0 1.66 2.69 3 6 3s6-1.34 6-3V7', stroke: 'currentColor', strokeWidth: 1.8 })),
          })
        )
      ),
      React.createElement(
        'div',
        { className: 'kp-main' },
        React.createElement('div', { className: 'text-3xl font-extrabold text-[#1B1748]', style: { fontFamily: 'Lora, serif' } }, 'Account portal'),
        React.createElement(
          'div',
          { className: 'mt-2 text-[15px] text-gray-600' },
          'Manage your profile and subscription. Your finance data lives in your local Kivana app.'
        ),
        React.createElement(
          'div',
          { className: 'mt-6 kp-grid kp-user-stats' },
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

    const newMessagesCount = Number(adminSupportUnreadCount || 0)
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

    const filteredMessages = adminMessages.filter((t) => {
      const status = String(t.status || '').toLowerCase()
      const archived = status === 'archived'
      const solved = status === 'solved'
      const open = status === 'open'
      const unread = !!t.hasUnread
      if (adminMsgFilter === 'new') return open && unread
      if (adminMsgFilter === 'open') return open
      if (adminMsgFilter === 'solved') return solved
      if (adminMsgFilter === 'archived') return archived
      return true
    }).filter((t) => {
      const q = String(adminMsgQuery || '').trim().toLowerCase()
      if (!q) return true
      const subject = String(t.subject || '').toLowerCase()
      const email = String(t.userEmail || '').toLowerCase()
      const name = String(t.userName || '').toLowerCase()
      return subject.includes(q) || email.includes(q) || name.includes(q)
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
                const role = u.isAdmin ? 'ADMIN' : u.isModerator ? 'MOD' : u.isFounder ? 'FOUNDER' : 'USER'

                return React.createElement(
                  'tr',
                  { key: String(u.id || email), className: 'border-t border-gray-100' },
                  React.createElement(
                    'td',
                    { className: 'py-3 pr-4 font-medium text-[#1B1748]' },
                    React.createElement(
                      'button',
                      { type: 'button', className: 'hover:underline', onClick: () => openUserModal(u), disabled: busy },
                      email
                    )
                  ),
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
                        onClick: () => openUserModal(u),
                        disabled: busy,
                      },
                      'Open'
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
      const statusPill = (t) => {
        const status = String(t.status || '').toLowerCase()
        if (status === 'solved') return React.createElement(Pill, { kind: 'ok' }, 'SOLVED')
        if (status === 'archived') return React.createElement(Pill, { kind: 'muted' }, 'ARCHIVED')
        if (t.hasUnread) return React.createElement(Pill, { kind: 'warn' }, 'NEW')
        return React.createElement(Pill, { kind: 'muted' }, 'OPEN')
      }
      const openCount = adminMessages.filter((t) => String(t.status || '').toLowerCase() === 'open').length
      const solvedCount = adminMessages.filter((t) => String(t.status || '').toLowerCase() === 'solved').length
      const archivedCount = adminMessages.filter((t) => String(t.status || '').toLowerCase() === 'archived').length
      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement(
          'div',
          { className: 'flex items-center justify-between gap-4 flex-wrap' },
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Support inbox'),
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Conversations between users and admins.')
          ),
          React.createElement(
            'div',
            { className: 'flex items-center gap-3 flex-wrap' },
            React.createElement('input', {
              value: adminMsgQuery,
              onChange: (e) => setAdminMsgQuery(e.target.value),
              placeholder: 'Search',
              className:
                'px-4 py-2.5 rounded-full border border-gray-200 bg-white text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
            }),
            React.createElement(
              'select',
              {
                value: adminMsgFilter,
                onChange: (e) => setAdminMsgFilter(String(e.target.value || 'new')),
                className: 'px-4 py-2.5 rounded-full border border-gray-200 bg-white text-[14px] font-semibold text-[#1B1748]',
                disabled: busy,
              },
              React.createElement('option', { value: 'new' }, `New (${newMessagesCount})`),
              React.createElement('option', { value: 'open' }, `Open (${openCount})`),
              React.createElement('option', { value: 'solved' }, `Solved (${solvedCount})`),
              React.createElement('option', { value: 'archived' }, `Archived (${archivedCount})`),
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
            { className: 'w-full text-sm min-w-[920px]' },
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Last'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Status'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'User'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Subject'),
                React.createElement('th', { className: 'text-left font-semibold text-gray-600 py-3 pr-4' }, 'Action')
              )
            ),
            React.createElement(
              'tbody',
              null,
              filteredMessages.map((t) => {
                const id = String(t.id || '')
                const status = String(t.status || '').toLowerCase()
                const archived = status === 'archived'
                const solved = status === 'solved'
                return React.createElement(
                  'tr',
                  { key: id, className: 'border-t border-gray-100' },
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-600' }, formatRfc3339Short(t.lastMessageAt || t.last_message_at || '')),
                  React.createElement('td', { className: 'py-3 pr-4' }, statusPill(t)),
                  React.createElement(
                    'td',
                    { className: 'py-3 pr-4' },
                    React.createElement('div', { className: 'font-medium text-[#1B1748]' }, String(t.userName || '')),
                    React.createElement('div', { className: 'text-gray-600 text-xs' }, String(t.userEmail || ''))
                  ),
                  React.createElement('td', { className: 'py-3 pr-4 text-gray-700 font-semibold' }, String(t.subject || 'Support')),
                  React.createElement(
                    'td',
                    { className: 'py-3 pr-4' },
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: async () => {
                          setMsgModal({ kind: 'support', threadId: id, thread: t, messages: [], reply: '', loading: true })
                          try {
                            const json = await adminLoadSupportThread(id)
                            setMsgModal((m) => {
                              if (!m || m.kind !== 'support' || String(m.threadId || '') !== id) return m
                              return { ...m, thread: json?.thread || t, messages: Array.isArray(json?.messages) ? json.messages : [], loading: false }
                            })
                            await loadAdmin()
                          } catch (err) {
                            setMsgModal(null)
                            setStatus({ kind: 'err', text: String(err?.message || err) })
                          }
                        },
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
                        onClick: () => adminMark(id, archived ? false : true),
                        disabled: busy,
                      },
                      archived ? 'Unarchive' : 'Archive'
                    ),
                    archived
                      ? null
                      : React.createElement(
                          React.Fragment,
                          null,
                          ' ',
                          React.createElement(
                            'button',
                            {
                              className:
                                'px-3 py-2 rounded-full text-xs font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                              type: 'button',
                              onClick: () => adminSolveThread(id, solved ? false : true),
                              disabled: busy,
                            },
                            solved ? 'Reopen' : 'Solve'
                          )
                        ),
                    ' ',
                    React.createElement(
                      'button',
                      {
                        className:
                          'px-3 py-2 rounded-full text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
                        type: 'button',
                        onClick: () => adminDeleteSupportThread(id),
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
          React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'Reload to edit settings.'),
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

      return React.createElement(
        'div',
        { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
        React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Settings'),
        React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Global portal toggles.'),
        React.createElement(
          'div',
          { className: 'mt-6 grid gap-4' },
          React.createElement(
            'div',
            { className: 'flex items-center justify-between gap-4 rounded-2xl border border-gray-100 px-5 py-4' },
            React.createElement('div', null, React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Allow new signups')),
            React.createElement('input', {
              type: 'checkbox',
              checked: !!cfg.allowSignups,
              onChange: (e) => setAdminConfig((c) => ({ ...(c || {}), allowSignups: !!e.target.checked })),
              disabled: busy,
              className: 'w-5 h-5 accent-[#4F3DDD]',
            })
          ),
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

    function PayPalPanel() {
      const cfg = adminConfig || null
      const pp = adminPayPal || null
      const draft = adminPricingDraft || null

      if (!cfg || !pp) {
        return React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'PayPal'),
          React.createElement('div', { className: 'mt-2 text-sm text-gray-600' }, 'Reload to edit PayPal, pricing and automation.'),
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

      const DraftInput = ({ label, value, onChange, placeholder, inputMode }) =>
        React.createElement(
          'div',
          { className: 'flex items-center justify-between gap-3 flex-wrap' },
          React.createElement('div', { className: 'text-sm font-semibold text-gray-700' }, label),
          React.createElement('input', {
            value: String(value ?? ''),
            onChange: (e) => onChange(e.target.value),
            disabled: busy,
            inputMode: inputMode || 'decimal',
            className:
              'w-full sm:w-48 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
            placeholder: placeholder || '',
          })
        )

      const MoneyEditor = ({ title, values, onUpdate }) =>
        React.createElement(
          'div',
          { className: 'rounded-2xl border border-gray-100 px-5 py-4' },
          React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, title),
          React.createElement(
            'div',
            { className: 'mt-4 grid gap-3' },
            DraftInput({
              label: 'EUR',
              value: values?.eur,
              onChange: (v) => onUpdate({ ...(values || {}), eur: v }),
              placeholder: '9.99',
            }),
            DraftInput({
              label: 'GBP',
              value: values?.gbp,
              onChange: (v) => onUpdate({ ...(values || {}), gbp: v }),
              placeholder: '9.99',
            }),
            DraftInput({
              label: 'NOK',
              value: values?.nok,
              onChange: (v) => onUpdate({ ...(values || {}), nok: v }),
              placeholder: '99',
            })
          )
        )

      const webhookUrl = String(adminPayPalWebhookUrl || '')
      const credsOk = !!String(pp.clientId || '').trim() && !!pp.hasSecret
      const webhookOk = !!String(pp.webhookId || '').trim()
      const planCells = [
        { label: 'Ordinary • Monthly • EUR', id: pp.plans?.standard?.monthly?.eur },
        { label: 'Ordinary • Monthly • GBP', id: pp.plans?.standard?.monthly?.gbp },
        { label: 'Ordinary • Monthly • NOK', id: pp.plans?.standard?.monthly?.nok },
        { label: 'Ordinary • Yearly • EUR', id: pp.plans?.standard?.yearly?.eur },
        { label: 'Ordinary • Yearly • GBP', id: pp.plans?.standard?.yearly?.gbp },
        { label: 'Ordinary • Yearly • NOK', id: pp.plans?.standard?.yearly?.nok },
        { label: 'Pro • Monthly • EUR', id: pp.plans?.pro?.monthly?.eur },
        { label: 'Pro • Monthly • GBP', id: pp.plans?.pro?.monthly?.gbp },
        { label: 'Pro • Monthly • NOK', id: pp.plans?.pro?.monthly?.nok },
        { label: 'Pro • Yearly • EUR', id: pp.plans?.pro?.yearly?.eur },
        { label: 'Pro • Yearly • GBP', id: pp.plans?.pro?.yearly?.gbp },
        { label: 'Pro • Yearly • NOK', id: pp.plans?.pro?.yearly?.nok },
      ]
      const plansMissing = planCells.filter((c) => !String(c.id || '').trim()).length
      const plansOk = plansMissing === 0
      const discountedUsers = adminUsers
        .filter((u) => Number(u?.discountPercent || 0) > 0)
        .slice()
        .sort((a, b) => Number(b?.discountPercent || 0) - Number(a?.discountPercent || 0))

      return React.createElement(
        'div',
        { className: 'grid gap-6 max-w-5xl' },
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Setup status'),
          React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Everything needed to run subscriptions from admin.'),
          React.createElement(
            'div',
            { className: 'mt-5 flex items-center gap-2 flex-wrap' },
            React.createElement(Pill, { kind: credsOk ? 'ok' : 'warn' }, credsOk ? 'Credentials OK' : 'Missing credentials'),
            React.createElement(Pill, { kind: webhookOk ? 'ok' : 'warn' }, webhookOk ? 'Webhook OK' : 'Missing webhook'),
            React.createElement(Pill, { kind: plansOk ? 'ok' : 'warn' }, plansOk ? 'Plans OK' : `${plansMissing} missing plan IDs`)
          ),
          React.createElement(
            'div',
            { className: 'mt-5 flex flex-wrap items-center justify-end gap-3' },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => savePayPalConfig(adminPayPal),
                disabled: busy,
                className:
                  'px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-[#1B1748] hover:bg-black disabled:opacity-60 disabled:pointer-events-none',
              },
              'Save PayPal'
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => createPayPalWebhook(adminPayPalWebhookUrl),
                disabled: busy,
                className:
                  'px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-[#0E7490] hover:bg-[#0B5F76] disabled:opacity-60 disabled:pointer-events-none',
              },
              'Create webhook'
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => syncPayPalPlans(),
                disabled: busy,
                className:
                  'px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
              },
              'Sync plans'
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Plans & pricing'),
          React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Edit pricing, then sync PayPal plans to apply it.'),
          React.createElement(
            'div',
            { className: 'mt-6 grid gap-4' },
            React.createElement(
              'div',
              { className: 'grid grid-cols-1 md:grid-cols-2 gap-3' },
              React.createElement(
                'div',
                { className: 'rounded-2xl border border-gray-100 px-5 py-4' },
                React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Yearly factor'),
                React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, 'Yearly price = monthly * factor.'),
                DraftInput({
                  label: 'Factor',
                  value: draft?.yearlyFactor,
                  onChange: (v) => setAdminPricingDraft((d) => ({ ...(d || {}), yearlyFactor: v })),
                  placeholder: '11',
                  inputMode: 'numeric',
                })
              ),
              React.createElement(
                'div',
                { className: 'rounded-2xl border border-gray-100 px-5 py-4' },
                React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Trial days'),
                DraftInput({
                  label: 'Days',
                  value: draft?.trialDays,
                  onChange: (v) => setAdminPricingDraft((d) => ({ ...(d || {}), trialDays: v })),
                  placeholder: '14',
                  inputMode: 'numeric',
                })
              )
            ),
            MoneyEditor({
              title: 'Ordinary monthly prices',
              values: draft?.standardMonthly,
              onUpdate: (v) => setAdminPricingDraft((d) => ({ ...(d || {}), standardMonthly: v })),
            }),
            MoneyEditor({
              title: 'Pro monthly prices',
              values: draft?.proMonthly,
              onUpdate: (v) => setAdminPricingDraft((d) => ({ ...(d || {}), proMonthly: v })),
            }),
            React.createElement(
              'div',
              { className: 'flex items-center justify-end gap-3' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    const base = adminConfig || {}
                    const pricing = base?.pricing || {}
                    const d = adminPricingDraft || {}
                    const intOr = (raw, fallback) => {
                      const n = Number.parseInt(String(raw || '').trim(), 10)
                      return Number.isFinite(n) ? n : fallback
                    }
                    const numOr = (raw, fallback) => {
                      const s = String(raw || '').trim().replace(',', '.')
                      const n = Number.parseFloat(s)
                      return Number.isFinite(n) ? n : fallback
                    }
                    const nextPricing = {
                      ...(pricing || {}),
                      yearlyFactor: intOr(d.yearlyFactor, pricing.yearlyFactor),
                      trialDays: intOr(d.trialDays, pricing.trialDays),
                      standardMonthly: {
                        ...(pricing.standardMonthly || {}),
                        eur: numOr(d?.standardMonthly?.eur, pricing.standardMonthly?.eur),
                        gbp: numOr(d?.standardMonthly?.gbp, pricing.standardMonthly?.gbp),
                        nok: numOr(d?.standardMonthly?.nok, pricing.standardMonthly?.nok),
                      },
                      proMonthly: {
                        ...(pricing.proMonthly || {}),
                        eur: numOr(d?.proMonthly?.eur, pricing.proMonthly?.eur),
                        gbp: numOr(d?.proMonthly?.gbp, pricing.proMonthly?.gbp),
                        nok: numOr(d?.proMonthly?.nok, pricing.proMonthly?.nok),
                      },
                    }
                    const nextCfg = { ...(base || {}), pricing: nextPricing }
                    setAdminConfig(nextCfg)
                    void saveAdminConfig(nextCfg)
                  },
                  disabled: busy,
                  className:
                    'px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
                },
                'Save pricing'
              )
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'PayPal connection'),
          React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Credentials, webhook and product mapping.'),
          React.createElement(
            'div',
            { className: 'mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3' },
            React.createElement(
              'label',
              { className: 'flex items-center gap-3 rounded-2xl border border-gray-100 px-4 py-3' },
              React.createElement('input', {
                type: 'checkbox',
                checked: !!pp.enabled,
                onChange: (e) => setAdminPayPal((p) => ({ ...(p || {}), enabled: !!e.target.checked })),
                disabled: busy,
                className: 'w-5 h-5 accent-[#4F3DDD]',
              }),
              React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Enabled')
            ),
            React.createElement(
              'div',
              null,
              React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Mode'),
              React.createElement(
                'select',
                {
                  value: String(pp.mode || 'sandbox'),
                  onChange: (e) => {
                    const nextMode = String(e.target.value || 'sandbox')
                    setAdminPayPal((p) => {
                      const prevMode = String(p?.mode || 'sandbox')
                      if (prevMode === nextMode) return { ...(p || {}), mode: nextMode }
                      return {
                        ...(p || {}),
                        mode: nextMode,
                        webhookId: '',
                        productId: '',
                        plans: { standard: { monthly: {}, yearly: {} }, pro: { monthly: {}, yearly: {} } },
                      }
                    })
                  },
                  disabled: busy,
                  className:
                    'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                },
                React.createElement('option', { value: 'sandbox' }, 'Sandbox'),
                React.createElement('option', { value: 'live' }, 'Live')
              )
            ),
            React.createElement(
              'div',
              { className: 'sm:col-span-2' },
              React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Client ID'),
              React.createElement('input', {
                value: String(pp.clientId || ''),
                onChange: (e) => setAdminPayPal((p) => ({ ...(p || {}), clientId: e.target.value })),
                disabled: busy,
                className:
                  'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                placeholder: 'PayPal Client ID',
              })
            ),
            React.createElement(
              'div',
              { className: 'sm:col-span-2' },
              React.createElement(
                'div',
                { className: 'flex items-center justify-between gap-3' },
                React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Secret'),
                React.createElement('div', { className: 'text-xs text-gray-600' }, pp.hasSecret ? 'Saved' : 'Not saved')
              ),
              React.createElement('input', {
                value: adminPayPalSecret,
                onChange: (e) => setAdminPayPalSecret(e.target.value),
                disabled: busy,
                type: 'password',
                className:
                  'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                placeholder: pp.hasSecret ? '•••••••• (leave blank to keep current)' : 'PayPal Secret',
              })
            ),
            React.createElement(
              'div',
              { className: 'sm:col-span-2' },
              React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Webhook ID'),
              React.createElement('input', {
                value: String(pp.webhookId || ''),
                onChange: (e) => setAdminPayPal((p) => ({ ...(p || {}), webhookId: e.target.value })),
                disabled: busy,
                className:
                  'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                placeholder: 'Auto-created or from PayPal dashboard',
              })
            ),
            React.createElement(
              'div',
              { className: 'sm:col-span-2' },
              React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Product ID'),
              React.createElement('input', {
                value: String(pp.productId || ''),
                onChange: (e) => setAdminPayPal((p) => ({ ...(p || {}), productId: e.target.value })),
                disabled: busy,
                className:
                  'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                placeholder: 'Leave empty to auto-create',
              })
            ),
            React.createElement(
              'div',
              { className: 'sm:col-span-2' },
              React.createElement('div', { className: 'text-sm font-medium text-[#1B1748]' }, 'Webhook URL'),
              React.createElement('input', {
                value: webhookUrl,
                onChange: (e) => setAdminPayPalWebhookUrl(e.target.value),
                disabled: busy,
                className:
                  'mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
                placeholder: computeDefaultPayPalWebhookUrl() || 'https://your-domain.com/v1/paypal/webhook',
              })
            )
          ),
          React.createElement(
            'div',
            { className: 'mt-4 flex flex-wrap items-center justify-between gap-3' },
            React.createElement(
              'div',
              { className: 'text-xs text-gray-600' },
              webhookUrl.trim() ? 'Webhook URL is ready. Create webhook to auto-save webhook ID.' : 'Set your HTTPS webhook URL (public domain) to create it automatically.'
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Plan IDs'),
          React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'These are filled automatically by Sync plans.'),
          React.createElement(
            'div',
            { className: 'mt-5 grid gap-2' },
            planCells.map((c) =>
              React.createElement(
                'div',
                { key: c.label, className: 'flex items-center justify-between gap-3 rounded-2xl border border-gray-100 px-4 py-3 flex-wrap' },
                React.createElement('div', { className: 'text-sm font-semibold text-[#1B1748]' }, c.label),
                React.createElement('div', { className: `text-sm font-mono ${String(c.id || '').trim() ? 'text-gray-700' : 'text-gray-400'}` }, String(c.id || '—'))
              )
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'rounded-3xl border border-gray-100 bg-white shadow-sm p-8' },
          React.createElement('div', { className: 'text-lg font-bold text-[#1B1748]' }, 'Discounts'),
          React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, 'Per-user discounts (auto-applied to PayPal by creating discounted PayPal plans).'),
          discountedUsers.length
            ? React.createElement(
                'div',
                { className: 'mt-5 grid gap-2' },
                discountedUsers.slice(0, 12).map((u) => {
                  const email = String(u.email || '')
                  const pct = Number(u.discountPercent || 0)
                  const until = u.discountExpiresAt ? formatRfc3339Short(u.discountExpiresAt) : ''
                  const label = String(u.discountLabel || '')
                  return React.createElement(
                    'div',
                    { key: String(u.id || email), className: 'flex items-center justify-between gap-3 rounded-2xl border border-gray-100 px-4 py-3 flex-wrap' },
                    React.createElement(
                      'div',
                      null,
                      React.createElement('div', { className: 'text-sm font-semibold text-[#1B1748]' }, email || '—'),
                      React.createElement('div', { className: 'mt-0.5 text-xs text-gray-600' }, `${pct}%${label ? ` • ${label}` : ''}${until ? ` • until ${until}` : ''}`)
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        onClick: () => openDiscountModal(u),
                        disabled: busy || !!u.isAdmin,
                        className:
                          'px-4 py-2 rounded-full text-xs font-semibold text-[#4F3DDD] border-2 border-[#4F3DDD] hover:bg-[#F0EEFC] disabled:opacity-60 disabled:pointer-events-none',
                      },
                      'Edit'
                    )
                  )
                })
              )
            : React.createElement('div', { className: 'mt-5 text-sm text-gray-600' }, 'No active discounts.')
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
          { className: 'mt-6 kp-grid kp-admin-stats' },
          React.createElement(StatCard, { label: 'Users', value: adminUsers.length }),
          React.createElement(StatCard, { label: 'Admins', value: adminsCount }),
          React.createElement(StatCard, { label: 'Active plans', value: activePlansCount }),
          React.createElement(StatCard, { label: 'New messages', value: newMessagesCount })
        ),
        React.createElement(
          'div',
          { className: 'mt-8 grid grid-cols-1 md:grid-cols-3 gap-4' },
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: async () => {
                setSection('admin_users')
                setAdminPage('users')
                await loadAdmin()
              },
              disabled: busy,
              className:
                'text-left rounded-3xl border border-gray-100 bg-white shadow-sm p-6 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
            },
            React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Users'),
            React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, 'Manage roles, plans, discounts and passwords.')
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: async () => {
                setSection('admin_messages')
                setAdminPage('messages')
                await loadAdmin()
              },
              disabled: busy,
              className:
                'text-left rounded-3xl border border-gray-100 bg-white shadow-sm p-6 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
            },
            React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'Messages'),
            React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, 'Inbox and support threads.')
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: async () => {
                setSection('paypal')
                setAdminPage('paypal')
                await loadAdmin()
              },
              disabled: busy,
              className:
                'text-left rounded-3xl border border-gray-100 bg-white shadow-sm p-6 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
            },
            React.createElement('div', { className: 'text-sm font-bold text-[#1B1748]' }, 'PayPal'),
            React.createElement('div', { className: 'mt-1 text-xs text-gray-600' }, 'Pricing, credentials, webhook and plan sync.')
          )
        )
      )
    }

    const panel =
      adminPage === 'overview'
        ? React.createElement(OverviewPanel, null)
        : adminPage === 'users'
          ? React.createElement(UsersTable, null)
          : adminPage === 'messages'
            ? React.createElement(MessagesTable, null)
            : adminPage === 'paypal'
              ? React.createElement(PayPalPanel, null)
            : React.createElement(SettingsPanel, null)

    return panel
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
    if (String(msgModal.kind || '') !== 'support') return null
    const threadId = String(msgModal.threadId || msgModal.thread?.id || '')
    const thread = msgModal.thread || {}
    const subject = String(thread.subject || 'Support')
    const status = String(thread.status || '').toLowerCase()
    const archived = status === 'archived'
    const solved = status === 'solved'
    const userId = String(thread.userId || thread.user_id || '').trim()
    const userName = String(thread.userName || thread.user_name || '').trim()
    const userEmail = String(thread.userEmail || thread.user_email || '').trim()
    const lastAt = thread.lastMessageAt ? formatRfc3339Short(thread.lastMessageAt) : thread.last_message_at ? formatRfc3339Short(thread.last_message_at) : ''
    const loading = !!msgModal.loading
    const messages = Array.isArray(msgModal.messages) ? msgModal.messages : []
    const reply = String(msgModal.reply || '')
    const scrollRef = (node) => {
      if (!node) return
      node.scrollTop = node.scrollHeight
    }
    const Bubble = (m) => {
      const role = String(m.senderRole || m.sender_role || '').toLowerCase()
      const mine = role === 'admin'
      const body = String(m.body || '').trim()
      const when = m.createdAt ? formatRfc3339Short(m.createdAt) : ''
      const wrapCls = mine ? 'w-full flex justify-end' : 'w-full flex justify-start'
      const bubbleCls = mine
        ? 'max-w-[80%] rounded-2xl bg-[#1B1748] text-white px-4 py-3 text-[14px] leading-relaxed'
        : 'max-w-[80%] rounded-2xl bg-white border border-gray-200 text-gray-800 px-4 py-3 text-[14px] leading-relaxed'
      return React.createElement(
        'div',
        { key: String(m.id || ''), className: wrapCls },
        React.createElement(
          'div',
          { className: mine ? 'flex flex-col items-end' : 'flex flex-col items-start' },
          React.createElement('div', { className: bubbleCls }, body || '—'),
          when ? React.createElement('div', { className: `mt-1 text-[11px] ${mine ? 'text-right text-gray-500' : 'text-left text-gray-500'}` }, when) : null
        )
      )
    }

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
            React.createElement('div', { className: 'mt-1 text-sm text-gray-600' }, `${userName || 'User'} • ${userEmail || '—'}${lastAt ? ' • ' + lastAt : ''}`)
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
            { ref: scrollRef, className: 'h-[360px] overflow-y-auto rounded-2xl border border-gray-100 bg-[#F6F7FB] p-4 flex flex-col gap-3 pr-1' },
            loading
              ? React.createElement('div', { className: 'text-sm text-gray-600 py-6 text-center' }, 'Loading…')
              : messages.length
                ? messages.map(Bubble)
                : React.createElement('div', { className: 'text-sm text-gray-600 py-6 text-center' }, 'No messages yet.')
          ),
          React.createElement(
            'div',
            { className: 'mt-4 flex items-end gap-3' },
            React.createElement('textarea', {
              className:
                'flex-1 min-h-[46px] max-h-[120px] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4F3DDD]/20 focus:border-[#4F3DDD]',
              value: reply,
              onChange: (e) => setMsgModal((m) => (m && m.kind === 'support' ? { ...m, reply: e.target.value } : m)),
              disabled: loading,
              placeholder: 'Reply as admin…',
              autoFocus: true,
            }),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: async () => {
                  const body = String(reply || '').trim()
                  if (!body) return
                  setStatus({ kind: 'muted', text: '' })
                  try {
                    await adminSendSupportThreadMessage(threadId, userId, body)
                    const json = await adminLoadSupportThread(threadId)
                    setMsgModal((m) => (m && m.kind === 'support' && String(m.threadId || '') === threadId ? { ...m, thread: json?.thread || m.thread, messages: Array.isArray(json?.messages) ? json.messages : [], reply: '', loading: false } : m))
                    await loadAdmin()
                  } catch (err) {
                    const msg = String(err?.message || err)
                    setStatus({
                      kind: 'err',
                      text:
                        msg === 'user_missing_key'
                          ? 'User has not enabled encrypted chat yet.'
                          : msg === 'encryption_required'
                            ? 'Encryption is required.'
                            : msg,
                    })
                  }
                },
                disabled: busy || loading || !String(reply || '').trim(),
                className:
                  'px-6 py-3 rounded-full text-[14px] font-semibold text-white bg-[#4F3DDD] hover:bg-[#3F2FCB] disabled:opacity-60 disabled:pointer-events-none',
              },
              busy ? 'Sending…' : 'Send'
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'px-6 pb-6 flex items-center justify-between gap-3 flex-wrap' },
          React.createElement(
            'div',
            null,
            archived
              ? React.createElement(Pill, { kind: 'muted' }, 'ARCHIVED')
              : solved
                ? React.createElement(Pill, { kind: 'ok' }, 'SOLVED')
                : thread.hasUnread
                  ? React.createElement(Pill, { kind: 'warn' }, 'NEW')
                  : React.createElement(Pill, { kind: 'muted' }, 'OPEN')
          ),
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
                  await adminMark(threadId, archived ? false : true)
                  const json = await adminLoadSupportThread(threadId).catch(() => null)
                  setMsgModal((m) => (m && m.kind === 'support' && String(m.threadId || '') === threadId ? { ...m, thread: json?.thread || m.thread } : m))
                  await loadAdmin()
                },
                disabled: busy,
              },
              archived ? 'Unarchive' : 'Archive'
            ),
            archived
              ? null
              : React.createElement(
                  'button',
                  {
                    className:
                      'px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#1B1748] bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none',
                    type: 'button',
                    onClick: async () => {
                      await adminSolveThread(threadId, solved ? false : true)
                      const json = await adminLoadSupportThread(threadId).catch(() => null)
                      setMsgModal((m) => (m && m.kind === 'support' && String(m.threadId || '') === threadId ? { ...m, thread: json?.thread || m.thread } : m))
                    },
                    disabled: busy,
                  },
                  solved ? 'Reopen' : 'Mark solved'
                ),
            React.createElement(
              'button',
              {
                className:
                  'px-5 py-2.5 rounded-full text-[14px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:pointer-events-none',
                type: 'button',
                onClick: () => adminDeleteSupportThread(threadId),
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
    AdminModal(),
    PasswordModal(),
    DeleteModal(),
    MessageModal()
  )
}

createRoot(document.getElementById('root')).render(React.createElement(App, null))

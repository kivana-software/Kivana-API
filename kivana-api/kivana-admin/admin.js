// Admin portal script.
//
// Purpose:
// - Provides a small, dependency-free admin UI for the Kivana API.
// - Handles authentication (JWT access/refresh), user listing, and admin actions (plan changes, bootstrap admin).
//
// Storage:
// - Persists admin base URL and tokens in localStorage so admins can reconnect quickly.

const LS_BASE = 'kivanaAdmin/baseUrl'
const LS_ACCESS = 'kivanaAdmin/accessToken'
const LS_REFRESH = 'kivanaAdmin/refreshToken'
const LS_EMAIL = 'kivanaAdmin/email'

const els = {
  baseUrl: document.getElementById('baseUrl'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  login: document.getElementById('login'),
  logout: document.getElementById('logout'),
  refresh: document.getElementById('refresh'),
  authCard: document.getElementById('authCard'),
  panel: document.getElementById('panel'),
  usersBody: document.getElementById('usersBody'),
  authStatus: document.getElementById('authStatus'),
  panelStatus: document.getElementById('panelStatus'),
  me: document.getElementById('me'),
  bootstrapEmail: document.getElementById('bootstrapEmail'),
  bootstrapToken: document.getElementById('bootstrapToken'),
  bootstrapBtn: document.getElementById('bootstrapBtn'),
  bootstrapStatus: document.getElementById('bootstrapStatus'),
  actionModal: document.getElementById('actionModal'),
  actionModalTitle: document.getElementById('actionModalTitle'),
  actionModalBody: document.getElementById('actionModalBody'),
  actionModalOk: document.getElementById('actionModalOk'),
  actionModalCancel: document.getElementById('actionModalCancel'),
  actionModalBackdrop: document.getElementById('actionModalBackdrop'),
  btnCloseActionModal: document.getElementById('btnCloseActionModal'),
}

function normalizeBaseUrl(v) {
  const s = String(v || '').trim().replace(/\/+$/, '')
  return s
}

function setStatus(el, msg) {
  el.textContent = msg || ''
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

async function promptPassword(email) {
  return openActionModal({
    title: `Reset password for ${email}`,
    okText: 'Set password',
    cancelText: 'Cancel',
    build: (body) => {
      const wrap = document.createElement('div')
      wrap.className = 'modalForm'

      const r1 = document.createElement('div')
      r1.className = 'row'
      const l1 = document.createElement('label')
      l1.className = 'label'
      l1.textContent = 'New password'
      const p1 = document.createElement('input')
      p1.className = 'input'
      p1.type = 'password'
      r1.appendChild(l1)
      r1.appendChild(p1)

      const r2 = document.createElement('div')
      r2.className = 'row'
      const l2 = document.createElement('label')
      l2.className = 'label'
      l2.textContent = 'Confirm password'
      const p2 = document.createElement('input')
      p2.className = 'input'
      p2.type = 'password'
      r2.appendChild(l2)
      r2.appendChild(p2)

      wrap.appendChild(r1)
      wrap.appendChild(r2)
      body.appendChild(wrap)

      const note = document.createElement('div')
      note.className = 'modalText'
      note.textContent = 'Minimum 8 characters.'
      body.appendChild(note)

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
      const wrap = document.createElement('div')
      wrap.className = 'modalForm'

      const r = document.createElement('div')
      r.className = 'row'
      const l = document.createElement('label')
      l.className = 'label'
      l.textContent = 'Ends at (date)'
      const i = document.createElement('input')
      i.className = 'input'
      i.type = 'date'
      r.appendChild(l)
      r.appendChild(i)
      wrap.appendChild(r)
      body.appendChild(wrap)

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
  return localStorage.getItem(LS_ACCESS) || ''
}

function getRefreshToken() {
  return localStorage.getItem(LS_REFRESH) || ''
}

function setTokens(access, refresh) {
  if (access) localStorage.setItem(LS_ACCESS, access)
  if (refresh) localStorage.setItem(LS_REFRESH, refresh)
}

function clearTokens() {
  localStorage.removeItem(LS_ACCESS)
  localStorage.removeItem(LS_REFRESH)
}

function apiUrl(path) {
  const base = normalizeBaseUrl(els.baseUrl.value)
  if (!base) throw new Error('Missing backend URL')
  return base + path
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

async function apiFetch(path, init = {}) {
  const access = getAccessToken()
  const headers = new Headers(init.headers || {})
  headers.set('content-type', 'application/json')
  if (access) headers.set('authorization', `Bearer ${access}`)
  const res = await fetch(apiUrl(path), { ...init, headers })
  if (res.ok) return res
  let err = `HTTP ${res.status}`
  try {
    const j = await res.json()
    if (j && j.error) err = String(j.error)
  } catch {
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

async function loadMe() {
  const res = await apiFetch('/v1/me', { method: 'GET', headers: {} })
  const me = await res.json()
  els.me.textContent = me?.email ? `Signed in: ${me.email}` : ''
}

async function loadUsers() {
  setStatus(els.panelStatus, 'Loading…')
  const res = await apiFetch('/v1/admin/users', { method: 'GET', headers: {} })
  const json = await res.json()
  const users = Array.isArray(json.users) ? json.users : []
  els.usersBody.innerHTML = ''

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
    adminTd.innerHTML = u.isAdmin ? '<span class="pill">Yes</span>' : '<span class="pill">No</span>'
    tr.appendChild(adminTd)

    const planTd = document.createElement('td')
    planTd.textContent = u.kivanaPlanName ? `kivana / ${u.kivanaPlanName}` : 'None'
    tr.appendChild(planTd)

    const endsTd = document.createElement('td')
    if (!u.kivanaEndsAt) {
      endsTd.textContent = 'None'
    } else {
      const t = new Date(u.kivanaEndsAt)
      if (!Number.isNaN(t.getTime()) && t.getTime() <= Date.now()) {
        endsTd.textContent = `Expired (${fmtDateTime(u.kivanaEndsAt)})`
      } else {
        endsTd.textContent = fmtDateTime(u.kivanaEndsAt)
      }
    }
    tr.appendChild(endsTd)

    const setTd = document.createElement('td')
    const sel = document.createElement('select')
    sel.className = 'select'
    const plans = [
      { code: 'basic', name: 'Basic' },
      { code: 'standard', name: 'Standard' },
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

    const durationTd = document.createElement('td')
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
    durationTd.appendChild(durationSel)
    tr.appendChild(durationTd)

    const btn = document.createElement('button')
    btn.className = 'btn'
    btn.textContent = 'Apply'
    btn.addEventListener('click', async () => {
      setStatus(els.panelStatus, 'Applying…')
      try {
        const endsAt = await computeEndsAt(String(durationSel.value || 'lifetime'))
        if (endsAt === undefined) {
          setStatus(els.panelStatus, 'Cancelled.')
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
        await loadUsers()
        setStatus(els.panelStatus, 'Updated.')
      } catch (e) {
        setStatus(els.panelStatus, `Failed: ${String(e?.message || e)}`)
      }
    })

    const wrap = document.createElement('div')
    wrap.style.display = 'flex'
    wrap.style.gap = '8px'
    wrap.style.alignItems = 'center'
    wrap.appendChild(sel)
    wrap.appendChild(btn)
    setTd.appendChild(wrap)
    tr.appendChild(setTd)

    const actionsTd = document.createElement('td')
    const pwBtn = document.createElement('button')
    pwBtn.className = 'btn'
    pwBtn.textContent = 'Reset password'
    pwBtn.onclick = async () => {
      const pw = await promptPassword(u.email || '')
      if (!pw) return
      pwBtn.disabled = true
      pwBtn.textContent = '...'
      try {
        await apiFetch(`/v1/admin/users/${u.id}/password`, {
          method: 'POST',
          body: JSON.stringify({ password: String(pw || '') }),
        })
        await loadUsers()
      } catch (e) {
        setStatus(els.panelStatus, `Failed: ${String(e?.message || e)}`)
      } finally {
        pwBtn.disabled = false
        pwBtn.textContent = 'Reset password'
      }
    }

    const delBtn = document.createElement('button')
    delBtn.className = 'btn'
    delBtn.style.color = 'rgba(255, 255, 255, 0.92)'
    delBtn.style.backgroundColor = '#441111'
    delBtn.textContent = 'Delete'
    delBtn.onclick = async () => {
      const ok = await confirmAction({
        title: 'Delete user',
        message: `Delete ${u.email}? This cannot be undone.`,
        okText: 'Delete',
      })
      if (!ok) return
      delBtn.disabled = true
      delBtn.textContent = '...'
      try {
        await apiFetch(`/v1/admin/users/${u.id}`, { method: 'DELETE' })
        await loadUsers()
      } catch (e) {
        setStatus(els.panelStatus, `Failed: ${String(e?.message || e)}`)
        delBtn.disabled = false
        delBtn.textContent = 'Delete'
      }
    }
    actionsTd.appendChild(pwBtn)
    actionsTd.appendChild(delBtn)
    tr.appendChild(actionsTd)

    els.usersBody.appendChild(tr)
  }

  setStatus(els.panelStatus, `${users.length} users`)
}

async function showAuthed() {
  els.authCard.style.display = 'none'
  els.panel.style.display = 'block'
  try {
    await loadMe()
  } catch {
  }
  await loadUsers()
}

async function showLoggedOut() {
  els.me.textContent = ''
  els.panel.style.display = 'none'
  els.authCard.style.display = 'block'
}

async function signIn() {
  setStatus(els.authStatus, '')
  const email = String(els.email.value || '').trim()
  const password = String(els.password.value || '')
  if (!email || !password) {
    setStatus(els.authStatus, 'Missing email or password.')
    return
  }
  localStorage.setItem(LS_EMAIL, email)

  const res = await apiFetch('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  const json = await res.json()
  setTokens(json.accessToken, json.refreshToken)
  await showAuthed()
}

async function signOut() {
  try {
    const refreshToken = getRefreshToken()
    clearTokens()
    await apiFetch('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) })
  } catch {
  }
  await showLoggedOut()
  window.location.replace('/')
}

async function bootstrapAdmin() {
  setStatus(els.bootstrapStatus, '')
  const email = String(els.bootstrapEmail.value || '').trim()
  const token = String(els.bootstrapToken.value || '').trim()
  if (!email || !token) {
    setStatus(els.bootstrapStatus, 'Missing email or token.')
    return
  }
  try {
    const base = normalizeBaseUrl(els.baseUrl.value)
    const res = await fetch(base + '/v1/admin/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const j = await res.json()
        if (j?.error) msg = String(j.error)
      } catch {
      }
      throw new Error(msg)
    }
    setStatus(els.bootstrapStatus, 'Admin granted. Now sign in.')
  } catch (e) {
    setStatus(els.bootstrapStatus, `Failed: ${String(e?.message || e)}`)
  }
}

function loadDefaults() {
  const savedBase = localStorage.getItem(LS_BASE) || ''
  const savedEmail = localStorage.getItem(LS_EMAIL) || ''
  els.baseUrl.value = savedBase || window.location.origin.replace(/\/admin\/?$/, '')
  els.email.value = savedEmail
  els.bootstrapEmail.value = savedEmail
}

els.baseUrl.addEventListener('change', () => localStorage.setItem(LS_BASE, normalizeBaseUrl(els.baseUrl.value)))
els.login.addEventListener('click', () => void signIn())
els.logout.addEventListener('click', () => void signOut())
els.refresh.addEventListener('click', async () => {
  try {
    await refreshAccessToken()
    await showAuthed()
  } catch (e) {
    setStatus(els.panelStatus, `Failed: ${String(e?.message || e)}`)
  }
})
els.bootstrapBtn.addEventListener('click', () => void bootstrapAdmin())

loadDefaults()

;(async () => {
  if (getAccessToken()) {
    try {
      await refreshAccessToken()
      await showAuthed()
      return
    } catch {
      clearTokens()
    }
  }
  await showLoggedOut()
})()

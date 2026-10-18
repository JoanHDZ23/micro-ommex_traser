/**
 * Identidad del usuario dentro del microfrontend de trazabilidad.
 *
 * La app se embebe en un iframe desde el portal (front-turnos), que pasa
 * `companyId`, `user` y `role` como query params. Antes esos valores solo se
 * guardaban en sessionStorage, por lo que se perdían al cerrar el navegador y
 * NO servían sin red si el iframe se abría sin params.
 *
 * Ahora, además, se persiste el ÚLTIMO usuario (logueado con internet) en
 * localStorage. Si al arrancar no llegan params por URL (reinicio del
 * navegador, apertura directa o modo offline), se restauran rápidamente los
 * datos de ese último usuario.
 */

let _companyId = ''
let _user = ''
let _role = ''
let _initialized = false
/** True si la identidad se restauró del último usuario guardado (no vino por URL). */
let _restoredFromCache = false

// Backup por pestaña (sobrevive cambios de ruta dentro de la SPA).
const SS_COMPANY = 'ommex_tracer_companyId'
const SS_USER = 'ommex_tracer_user'
const SS_ROLE = 'ommex_tracer_role'

// Último usuario logueado con internet (sobrevive al cierre del navegador).
// Se usa como validación + carga rápida cuando no hay params ni red.
const LS_LAST_USER = 'ommex_tracer_last_user'
/** Vigencia de la sesión offline del tracer: 30 días desde el último acceso con params/red. */
const LS_LAST_EXPIRY = 'ommex_tracer_last_expiry'
const OFFLINE_DAYS = 30

interface LastUser {
  companyId: string
  user: string
  role: string
  savedAt: number
}

function safeGet(storage: Storage, key: string): string {
  try { return storage.getItem(key) ?? '' } catch { return '' }
}
function safeSet(storage: Storage, key: string, value: string): void {
  try { storage.setItem(key, value) } catch { /* cuota / modo privado */ }
}

/** Persiste al último usuario logueado y renueva la ventana offline (30 días). */
function saveLastUser(companyId: string, user: string, role: string): void {
  if (!companyId) return
  const payload: LastUser = { companyId, user, role, savedAt: Date.now() }
  safeSet(localStorage, LS_LAST_USER, JSON.stringify(payload))
  safeSet(localStorage, LS_LAST_EXPIRY, String(Date.now() + OFFLINE_DAYS * 24 * 60 * 60 * 1000))
}

/** Lee el último usuario guardado si la ventana offline sigue vigente. */
function readLastUser(): LastUser | null {
  const raw = safeGet(localStorage, LS_LAST_USER)
  if (!raw) return null
  const expiry = Number(safeGet(localStorage, LS_LAST_EXPIRY) || '0')
  if (expiry && Date.now() > expiry) return null // sesión offline caducada
  try {
    const parsed = JSON.parse(raw) as LastUser
    return parsed.companyId ? parsed : null
  } catch {
    return null
  }
}

function initFromUrl() {
  if (_initialized) return
  _initialized = true

  // 1) Intentar leer la identidad de los query params (sesión normal con el portal).
  const params = new URLSearchParams(window.location.search)
  _companyId = params.get('companyId') ?? ''
  _user = params.get('user') ?? ''
  _role = params.get('role') ?? ''

  // Fallback al hash (por si se usa HashRouter).
  if (!_companyId && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    _companyId = hashParams.get('companyId') ?? ''
    _user = hashParams.get('user') ?? ''
    _role = hashParams.get('role') ?? _role
  }

  if (_companyId) {
    // Identidad fresca (vino por URL → hay red / el portal nos abrió).
    // Backup por pestaña + persistir como "último usuario" para uso offline.
    safeSet(sessionStorage, SS_COMPANY, _companyId)
    safeSet(sessionStorage, SS_USER, _user)
    safeSet(sessionStorage, SS_ROLE, _role)
    saveLastUser(_companyId, _user, _role)
    return
  }

  // 2) Sin params: recuperar el backup de la pestaña actual.
  _companyId = safeGet(sessionStorage, SS_COMPANY)
  _user = safeGet(sessionStorage, SS_USER)
  _role = safeGet(sessionStorage, SS_ROLE)
  if (_companyId) return

  // 3) Sin params ni backup de pestaña (reinicio del navegador / offline):
  //    validar y cargar rápidamente los datos del último usuario logueado.
  const last = readLastUser()
  if (last) {
    _companyId = last.companyId
    _user = last.user
    _role = last.role
    _restoredFromCache = true
    // Repuebla el backup de pestaña para el resto de la navegación.
    safeSet(sessionStorage, SS_COMPANY, _companyId)
    safeSet(sessionStorage, SS_USER, _user)
    safeSet(sessionStorage, SS_ROLE, _role)
  }
}

export function getCompanyId(): string {
  initFromUrl()
  return _companyId
}

export function getOperatorName(): string {
  initFromUrl()
  return _user
}

/** Rol del usuario que embebe la app (admin, supervisor, operativo, ...). */
export function getUserRole(): string {
  initFromUrl()
  return _role
}

/** True si el usuario es el administrador principal (role === 'admin'). */
export function isAdmin(): boolean {
  initFromUrl()
  return _role === 'admin'
}

/** True si la identidad se restauró del último usuario guardado (sin params/red). */
export function isRestoredFromCache(): boolean {
  initFromUrl()
  return _restoredFromCache
}

/** True si hay alguna identidad disponible (por URL, pestaña o último usuario). */
export function hasIdentity(): boolean {
  initFromUrl()
  return Boolean(_companyId)
}

/** Borra el último usuario guardado (p. ej. al cerrar sesión en el portal). */
export function clearLastUser(): void {
  try {
    localStorage.removeItem(LS_LAST_USER)
    localStorage.removeItem(LS_LAST_EXPIRY)
  } catch { /* noop */ }
}

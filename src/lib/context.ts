/**
 * Reads companyId and user from URL params (passed by parent iframe).
 * Stores in memory so navigation within the app doesn't lose the values.
 */

let _companyId = ''
let _user = ''
let _role = ''
let _initialized = false

function initFromUrl() {
  if (_initialized) return
  _initialized = true

  // Read from the FULL page URL (including hash/search from initial load)
  // React Router with BrowserRouter keeps the initial search params on first load
  const params = new URLSearchParams(window.location.search)
  _companyId = params.get('companyId') ?? ''
  _user = params.get('user') ?? ''
  _role = params.get('role') ?? ''

  // Also check the hash-based params (in case of HashRouter)
  if (!_companyId && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    _companyId = hashParams.get('companyId') ?? ''
    _user = hashParams.get('user') ?? ''
    _role = hashParams.get('role') ?? _role
  }

  // Store in sessionStorage as backup (survives route changes)
  if (_companyId) {
    sessionStorage.setItem('ommex_tracer_companyId', _companyId)
    sessionStorage.setItem('ommex_tracer_user', _user)
    sessionStorage.setItem('ommex_tracer_role', _role)
  } else {
    // Try to recover from sessionStorage
    _companyId = sessionStorage.getItem('ommex_tracer_companyId') ?? ''
    _user = sessionStorage.getItem('ommex_tracer_user') ?? ''
    _role = sessionStorage.getItem('ommex_tracer_role') ?? ''
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

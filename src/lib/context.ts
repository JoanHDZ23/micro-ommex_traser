/**
 * Reads companyId and user from URL params (passed by parent iframe).
 * This isolates operations per company.
 */
function getParams(): { companyId: string; user: string } {
  const params = new URLSearchParams(window.location.search)
  return {
    companyId: params.get('companyId') ?? '',
    user: params.get('user') ?? '',
  }
}

export function getCompanyId(): string {
  return getParams().companyId
}

export function getOperatorName(): string {
  return getParams().user
}

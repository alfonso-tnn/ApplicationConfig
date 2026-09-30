export const APP_VERSION_HISTORY_LIMIT = 20

export function normalizeAppVersionHistory(
  values: unknown,
  limit = APP_VERSION_HISTORY_LIMIT,
): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  const versions = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)

  return [...new Set(versions)].slice(0, limit)
}

export function rememberAppVersion(
  history: string[],
  value: string,
): string[] {
  const version = value.trim()
  if (!version) {
    return history
  }

  return normalizeAppVersionHistory([version, ...history])
}

export function removeAppVersion(
  history: string[],
  value: string,
): string[] {
  return history.filter((version) => version !== value)
}
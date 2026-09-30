import type { ConfigDocument } from './applicationConfig'

export interface BackendOption extends Record<string, unknown> {
  name: string
  value: unknown
}

export interface BackendElement extends Record<string, unknown> {
  name: string
  url: string
  options: BackendOption[]
}

export interface BackendEntry {
  id: string
  index: number
  element: BackendElement
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readBackendEntries(document: ConfigDocument): BackendEntry[] {
  if (!isRecord(document) || !Array.isArray(document.backendElements)) {
    throw new Error('The backends response does not contain a backendElements array.')
  }

  const occurrences = new Map<string, number>()
  return document.backendElements.map((element: unknown, index) => {
    if (
      !isRecord(element) ||
      typeof element.name !== 'string' ||
      typeof element.url !== 'string' ||
      !Array.isArray(element.options)
    ) {
      throw new Error(`Backend element ${index + 1} must contain a name, URL, and options array.`)
    }

    const options = element.options.map((option: unknown, optionIndex) => {
      if (!isRecord(option) || typeof option.name !== 'string' || !('value' in option)) {
        throw new Error(`Backend "${element.name}" option ${optionIndex + 1} must contain a name and value.`)
      }
      return { ...option, name: option.name, value: option.value }
    })
    const occurrence = (occurrences.get(element.name) ?? 0) + 1
    occurrences.set(element.name, occurrence)
    return {
      id: JSON.stringify(['backends', 'element', element.name, occurrence]),
      index,
      element: { ...element, name: element.name, url: element.url, options },
    }
  })
}

export interface EndpointDetails {
  protocol: string
  host: string
  path: string
  query: [string, string][]
  fragment: string
  version?: string
  scalerValue?: string
}

export function inspectEndpoint(value: unknown): EndpointDetails | null {
  if (typeof value !== 'string' || !/^(https?|wss?):\/\//i.test(value)) {
    return null
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  return {
    protocol: url.protocol.slice(0, -1),
    host: url.host,
    path: url.pathname,
    query: [...url.searchParams],
    fragment: url.hash,
    version: url.pathname.match(/(?:^|\/)(v\d+)(?:\/|$)/i)?.[1],
    scalerValue: url.pathname.match(/\/image\.scaler\/rest\/image\/(\d+)(?:\/|$)/i)?.[1],
  }
}

export function backendRoles(document: ConfigDocument, name: string): string[] {
  if (!isRecord(document) || !isRecord(document.backendSet)) return []
  const mapping = document.backendSet.mapping
  if (!Array.isArray(mapping)) return []
  return mapping.flatMap((item: unknown) =>
    isRecord(item) && item.element === name && typeof item.type === 'string'
      ? [item.type]
      : [],
  )
}

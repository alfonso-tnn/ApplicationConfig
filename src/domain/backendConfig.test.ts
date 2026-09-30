import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertApplicationConfigDocument,
  buildApplicationConfigUrl,
  compareApplicationConfigs,
  fetchAllComparisonDocuments,
  flattenBackends,
  type ApplicationConfigRequest,
} from './applicationConfig'
import { backendRoles, inspectEndpoint, readBackendEntries } from './backendConfig'

const request: ApplicationConfigRequest = {
  environment: 'p', appVersion: 'example-version', customer: 'cdk',
  deploymentPhase: 'WebPortal 6.1', device: 'pc', schemaVersion: '', variant: 'adb_g3',
}
const scaler = {
  name: 'Scaler', url: 'https://images.example.test/image.scaler/rest/image/75/', options: [],
}
const content = {
  name: 'Content', url: 'https://api.example.test/content-api/v3',
  options: [
    { name: 'profiles-api', value: 'https://api.example.test/account-api?limit=10&format=json' },
    { name: 'enabled', value: 'true', type: 'boolean' },
  ],
}
const document = {
  backendElements: [scaler, content],
  backendSet: {
    name: 'default/pc',
    mapping: [{ type: 'Scaler', element: 'Scaler' }, { type: 'CBA', element: 'Content' }],
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('backends comparison', () => {
  it('builds backends requests with the same source parameters', () => {
    const url = new URL(buildApplicationConfigUrl(request, 'backends'))
    expect(url.pathname).toBe('/application-config-api/v2/')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appVersion: 'example-version', customer: 'cdk', data: 'backends',
      deploymentPhase: 'WebPortal 6.1', device: 'pc', variant: 'adb_g3',
    })
  })

  it('aligns services by name and ignores order of services, options, and mappings', () => {
    const reordered = {
      backendElements: [{ ...content, options: [...content.options].reverse() }, scaler],
      backendSet: { ...document.backendSet, mapping: [...document.backendSet.mapping].reverse() },
    }
    const comparison = compareApplicationConfigs(document, reordered, 'backends')
    expect(comparison.stats.unchanged).toBe(3)
    expect(comparison.stats.changed).toBe(0)
  })

  it('detects changed scaler path, nested APIs, option types, mappings, and extra fields', () => {
    const comparison = compareApplicationConfigs(document, {
      backendElements: [
        { ...scaler, url: scaler.url.replace('/75/', '/85/') },
        { ...content, options: [
          { ...content.options[0], value: 'https://api.example.test/account-api?limit=20' },
          { ...content.options[1], type: 'string' },
        ] },
      ],
      backendSet: { ...document.backendSet, variant: 'changed' },
      extra: { flags: [false, 1] },
    }, 'backends')
    expect(comparison.stats.changed).toBe(3)
    expect(comparison.rows.find((row) => row.key === 'metadata.extra')?.status).toBe('onlyCandidate')
    expect(comparison.rows.find((row) => row.key === 'Content')?.baseline.options).toContain('boolean')
  })

  it('detects type-only and additional backend field changes without losing empty values', () => {
    const baseline = { backendElements: [{ ...content, flag: false, options: [{ name: 'x', value: false }] }] }
    const candidate = { backendElements: [{ ...content, flag: 'false', options: [{ name: 'x', value: 'false' }] }] }
    expect(compareApplicationConfigs(baseline, candidate, 'backends').stats.changed).toBe(1)
    const rows = flattenBackends({ backendElements: [], extra: {}, empty: [], text: '' })
    expect(rows.map((row) => row.values.value)).toEqual(['[]', '{}', ''])
    expect(compareApplicationConfigs(
      { backendElements: [{ ...scaler, flag: false }] },
      { backendElements: [{ ...scaler, flag: 'false' }] },
      'backends',
    ).stats.changed).toBe(1)
    expect(compareApplicationConfigs(
      { backendElements: [], extra: 75 },
      { backendElements: [], extra: '75' },
      'backends',
    ).stats.changed).toBe(1)
  })

  it('preserves duplicate service names and duplicate options', () => {
    const entries = readBackendEntries({ backendElements: [scaler, scaler] })
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2)
    const repeated = { backendElements: [{ ...content, options: [
      { name: 'duplicate', value: 1 }, { name: 'duplicate', value: 2 },
    ] }] }
    const rows = flattenBackends(repeated)
    expect(JSON.parse(rows[0].values.options!)).toHaveLength(2)
  })

  it('handles added and removed services, plus an empty inventory', () => {
    const comparison = compareApplicationConfigs(
      { backendElements: [scaler] }, { backendElements: [content] }, 'backends',
    )
    expect(comparison.stats.onlyBaseline).toBe(1)
    expect(comparison.stats.onlyCandidate).toBe(1)
    expect(flattenBackends({ backendElements: [] })).toEqual([])
  })

  it('rejects malformed responses and options explicitly', () => {
    expect(() => assertApplicationConfigDocument({}, 'backends')).toThrow('backendElements array')
    expect(() => readBackendEntries({ backendElements: [null] })).toThrow('name, URL, and options')
    expect(() => readBackendEntries({ backendElements: [{ ...scaler, options: [{}] }] })).toThrow('name and value')
  })

  it('keeps other results when backends fail validation', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input)
      const type = url.searchParams.get('data')
      const payload = type === 'backends' ? { unexpected: true }
        : type === 'errors' ? [] : {};
      return new Response(JSON.stringify(payload), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const results = await fetchAllComparisonDocuments(request, { ...request, appVersion: 'candidate' })
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(results.backends.status).toBe('rejected')
    expect(results.translations.status).toBe('fulfilled')
    expect(results.errors.status).toBe('fulfilled')
    expect(results.globals.status).toBe('fulfilled')
    expect(results.branding.status).toBe('fulfilled')
  })
})

describe('endpoint inspection', () => {
  it('extracts a scaler path setting without guessing compression semantics', () => {
    expect(inspectEndpoint(scaler.url)?.scalerValue).toBe('75')
    expect(inspectEndpoint('https://example.test/something/75/')?.scalerValue).toBeUndefined()
  })

  it('preserves repeated and encoded query params, versions, ports, and fragments', () => {
    expect(inspectEndpoint('https://example.test:8443/api/v3/items?tag=a&tag=b&label=Web%20Portal&empty=#section')).toEqual({
      protocol: 'https', host: 'example.test:8443', path: '/api/v3/items', version: 'v3',
      query: [['tag', 'a'], ['tag', 'b'], ['label', 'Web Portal'], ['empty', '']],
      fragment: '#section', scalerValue: undefined,
    })
  })

  it('supports websocket URLs and does not invent endpoints from ordinary values', () => {
    expect(inspectEndpoint('ws://mqtt.example.test:443')?.protocol).toBe('ws')
    expect(inspectEndpoint('wss://mqtt.example.test/v2')?.version).toBe('v2')
    for (const value of ['true', '75', '', 'https://', 'javascript:alert(1)', 123]) {
      expect(inspectEndpoint(value)).toBeNull()
    }
  })

  it('resolves mapped roles by backend name', () => {
    expect(backendRoles(document, 'Content')).toEqual(['CBA'])
    expect(backendRoles(document, 'Missing')).toEqual([])
  })
})

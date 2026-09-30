import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertApplicationConfigDocument,
  buildApplicationConfigUrl,
  compareApplicationConfigs,
  fetchAllComparisonDocuments,
  fetchComparisonDocuments,
  flattenBranding,
  flattenTranslations,
  type ConfigDocument,
} from './applicationConfig'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildApplicationConfigUrl', () => {
  it('uses the selected data type and includes every populated parameter', () => {
    const result = new URL(
      buildApplicationConfigUrl(
        {
          environment: 's',
          appVersion: '25.01-93',
          customer: 'cdk',
          deploymentPhase: 'WebPortal 6.0',
          device: 'pc',
          schemaVersion: '634',
          variant: 'adb_g3',
        },
        'errors',
      ),
    )

    expect(result.hostname).toBe('s-front.tvs.telenor.net')
    expect(Object.fromEntries(result.searchParams)).toEqual({
      appVersion: '25.01-93',
      customer: 'cdk',
      data: 'errors',
      deploymentPhase: 'WebPortal 6.0',
      device: 'pc',
      schemaVersion: '634',
      variant: 'adb_g3',
    })
  })

  it('omits parameters when their values are empty', () => {
    const result = new URL(
      buildApplicationConfigUrl(
        {
          environment: 'p',
          appVersion: '  ',
          customer: 'cdk',
          deploymentPhase: '',
          device: 'pc',
          schemaVersion: ' ',
          variant: 'adb_g3',
        },
        'globals',
      ),
    )

    expect(result.searchParams.has('appVersion')).toBe(false)
    expect(result.searchParams.has('deploymentPhase')).toBe(false)
    expect(result.searchParams.has('schemaVersion')).toBe(false)
    expect(result.searchParams.get('data')).toBe('globals')
  })

  it('uses the dedicated branding path and defaults its required schema', () => {
    const result = new URL(
      buildApplicationConfigUrl(
        {
          environment: 'p',
          appVersion: '',
          customer: 'cdk',
          deploymentPhase: '',
          device: 'pc',
          schemaVersion: '',
          variant: 'adb_g3',
        },
        'branding',
      ),
    )

    expect(result.pathname).toBe('/application-config-api/v2/branding/')
    expect(result.searchParams.get('schemaVersion')).toBe('5')
    expect(result.searchParams.has('data')).toBe(false)
  })

  it('uses an explicitly selected branding schema version', () => {
    const result = new URL(
      buildApplicationConfigUrl(
        {
          environment: 'p',
          appVersion: '',
          customer: 'cdk',
          deploymentPhase: '',
          device: 'pc',
          schemaVersion: '7',
          variant: 'adb_g3',
        },
        'branding',
      ),
    )

    expect(result.searchParams.get('schemaVersion')).toBe('7')
  })
})

describe('branding comparison', () => {
  it('compares nested typed leaves and keeps wrapper fields as metadata', () => {
    const baseline: ConfigDocument = {
      version: 8,
      variant: 'adb_g3',
      data: {
        colors: { primary: '#ffffff' },
        tile: { enabled: false, dimensions: { width: 320 } },
      },
      customer: 'cdk',
    }
    const candidate: ConfigDocument = {
      version: 9,
      variant: 'adb_g3',
      data: {
        colors: { primary: '#ffffff', secondary: '#000000' },
        tile: { enabled: 'false', dimensions: { width: 320 } },
      },
      customer: 'cdk',
    }

    const comparison = compareApplicationConfigs(
      baseline,
      candidate,
      'branding',
    )

    expect(comparison.fields).toEqual(['type', 'value'])
    expect(
      Object.fromEntries(comparison.rows.map((row) => [row.key, row.status])),
    ).toEqual({
      'colors.primary': 'unchanged',
      'colors.secondary': 'onlyCandidate',
      'metadata.customer': 'unchanged',
      'metadata.variant': 'unchanged',
      'metadata.version': 'changed',
      'tile.dimensions.width': 'unchanged',
      'tile.enabled': 'changed',
    })
    expect(
      comparison.rows.find((row) => row.key === 'tile.enabled')?.baseline,
    ).toEqual({ type: 'boolean', value: 'false' })
    expect(
      comparison.rows.find((row) => row.key === 'tile.enabled')?.candidate,
    ).toEqual({ type: 'string', value: 'false' })
  })

  it('retains empty containers and uses readable array paths', () => {
    expect(
      flattenBranding({
        version: 1,
        data: {
          emptyObject: {},
          emptyArray: [],
          stops: [{ color: '#ffffff' }],
        },
      }).map(({ key, values }) => ({ key, values })),
    ).toEqual([
      { key: 'emptyArray', values: { type: 'array', value: '[]' } },
      { key: 'emptyObject', values: { type: 'object', value: '{}' } },
      {
        key: 'metadata.version',
        values: { type: 'number', value: '1' },
      },
      {
        key: 'stops[0].color',
        values: { type: 'string', value: '#ffffff' },
      },
    ])
  })
})

describe('translations comparison', () => {
  const baseline: ConfigDocument = {
    en: { common: 'Same', changed: 'Before', oldOnly: 'Removed' },
    nb: { oldOnly: 'Fjernet' },
  }
  const candidate: ConfigDocument = {
    en: { common: 'Same', changed: 'After', newOnly: 'Added' },
    no: { newOnly: 'Lagt til' },
  }

  it('groups values from each language under the same translation path', () => {
    expect(
      flattenTranslations({
        en: { epg: { title: 'Guide' } },
        nb: { epg: { title: 'TV-guide' } },
      }),
    ).toEqual([
      {
        id: '["epg","title"]',
        key: 'epg.title',
        path: ['epg', 'title'],
        values: { en: 'Guide', nb: 'TV-guide' },
      },
    ])
  })

  it('classifies changed, unchanged and unique translation keys', () => {
    const comparison = compareApplicationConfigs(
      baseline,
      candidate,
      'translations',
    )

    expect(comparison.fields).toEqual(['en', 'nb', 'no'])
    expect(comparison.stats).toEqual({
      baseline: 3,
      candidate: 3,
      changed: 1,
      onlyBaseline: 1,
      onlyCandidate: 1,
      unchanged: 1,
    })
  })

  it('applies ignored-key filters only to translations', () => {
    const comparison = compareApplicationConfigs(
      {
        en: {
          customer: { '1title': 'Old numeric title', profile: 'Old profile' },
        },
      },
      {
        en: {
          customer: { '1title': 'New numeric title', profile: 'New profile' },
        },
      },
      'translations',
      { patterns: ['^customer\\.\\d'], useRegex: true },
    )

    expect(comparison.rows.map((row) => row.key)).toEqual(['customer.profile'])
  })

  it('rejects invalid regular expressions', () => {
    expect(() =>
      compareApplicationConfigs(baseline, candidate, 'translations', {
        patterns: ['customer.['],
        useRegex: true,
      }),
    ).toThrow('Invalid regular expression: customer.[')
  })
})

describe('errors comparison', () => {
  it('loads all data types once per source and shares translation documents', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      )
      const version = url.searchParams.get('appVersion')
      const dataType = url.pathname.endsWith('/branding/')
        ? 'branding'
        : url.searchParams.get('data')
      const payload = dataType === 'translations'
        ? { en: { customer: { version } } }
        : dataType === 'errors'
          ? [{ name: `${version}Error` }]
          : dataType === 'branding'
            ? { version: 8, data: { logo: version } }
            : dataType === 'backends'
              ? { backendElements: [{ name: 'Content', url: `https://example.test/${version}`, options: [] }] }
            : { values: [{ key: 'version', value: version }] }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const baselineRequest = {
      environment: 'p' as const,
      appVersion: 'baseline-version',
      customer: 'cdk',
      deploymentPhase: '',
      device: 'pc',
      schemaVersion: '',
      variant: 'adb_g3',
    }
    const candidateRequest = {
      ...baselineRequest,
      appVersion: 'candidate-version',
    }

    const documents = await fetchAllComparisonDocuments(
      baselineRequest,
      candidateRequest,
    )

    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(
      fetchMock.mock.calls.map(([input]) => {
        const url = new URL(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        )
        return url.pathname.endsWith('/branding/')
          ? 'branding'
          : url.searchParams.get('data')
      }),
    ).toEqual([
      'translations',
      'translations',
      'errors',
      'errors',
      'globals',
      'globals',
      'branding',
      'branding',
      'backends',
      'backends',
    ])
    expect(documents.errors.status).toBe('fulfilled')
    expect(documents.translations.status).toBe('fulfilled')
    expect(documents.branding.status).toBe('fulfilled')
    expect(documents.backends.status).toBe('fulfilled')
    if (
      documents.errors.status !== 'fulfilled' ||
      documents.translations.status !== 'fulfilled' ||
      documents.branding.status !== 'fulfilled'
    ) {
      throw new Error('Expected all data types to load.')
    }
    expect(documents.errors.value.errorTranslations).toEqual({
      baseline: documents.translations.value.baselineDocument,
      candidate: documents.translations.value.candidateDocument,
    })
    expect(documents.branding.value.baselineDocument).toEqual({
      version: 8,
      data: { logo: 'baseline-version' },
    })
  })

  it('preserves successful data types when branding is unavailable', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      )
      const dataType = url.pathname.endsWith('/branding/')
        ? 'branding'
        : url.searchParams.get('data')
      if (dataType === 'branding') {
        return new Response(null, { status: 404 })
      }

      const payload = dataType === 'errors'
        ? []
        : dataType === 'translations'
          ? { en: { customer: { title: 'Title' } } }
          : dataType === 'backends'
            ? { backendElements: [] }
          : { values: [] }
      return new Response(JSON.stringify(payload), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const baselineRequest = {
      environment: 'p' as const,
      appVersion: 'baseline-version',
      customer: 'cdk',
      deploymentPhase: '',
      device: 'appletv',
      schemaVersion: '',
      variant: 'default',
    }

    const documents = await fetchAllComparisonDocuments(
      baselineRequest,
      { ...baselineRequest, appVersion: 'candidate-version' },
    )

    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(documents.translations.status).toBe('fulfilled')
    expect(documents.errors.status).toBe('fulfilled')
    expect(documents.globals.status).toBe('fulfilled')
    expect(documents.backends.status).toBe('fulfilled')
    expect(documents.branding.status).toBe('rejected')
    if (documents.branding.status !== 'rejected') {
      throw new Error('Expected branding to be unavailable.')
    }
    expect(documents.branding.error.message).toBe('Request failed with 404 .')
  })

  it('fetches errors and translations with the matching request for A and B', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      )
      const version = url.searchParams.get('appVersion')
      const data = url.searchParams.get('data')
      const payload = data === 'errors'
        ? [{ name: `${version}Error` }]
        : { en: { customer: { version } } }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const baselineRequest = {
      environment: 'p' as const,
      appVersion: 'baseline-version',
      customer: 'baseline-customer',
      deploymentPhase: '',
      device: 'pc',
      schemaVersion: '',
      variant: 'baseline-variant',
    }
    const candidateRequest = {
      ...baselineRequest,
      environment: 's' as const,
      appVersion: 'candidate-version',
      customer: 'candidate-customer',
      variant: 'candidate-variant',
    }

    const documents = await fetchComparisonDocuments(
      baselineRequest,
      candidateRequest,
      'errors',
    )
    const requestUrls = fetchMock.mock.calls.map(([input]) => new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    ))

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(
      requestUrls.map((url) => ({
        host: url.host,
        version: url.searchParams.get('appVersion'),
        customer: url.searchParams.get('customer'),
        data: url.searchParams.get('data'),
        variant: url.searchParams.get('variant'),
      })),
    ).toEqual([
      {
        host: 'p-front.tvs.telenor.net',
        version: 'baseline-version',
        customer: 'baseline-customer',
        data: 'errors',
        variant: 'baseline-variant',
      },
      {
        host: 's-front.tvs.telenor.net',
        version: 'candidate-version',
        customer: 'candidate-customer',
        data: 'errors',
        variant: 'candidate-variant',
      },
      {
        host: 'p-front.tvs.telenor.net',
        version: 'baseline-version',
        customer: 'baseline-customer',
        data: 'translations',
        variant: 'baseline-variant',
      },
      {
        host: 's-front.tvs.telenor.net',
        version: 'candidate-version',
        customer: 'candidate-customer',
        data: 'translations',
        variant: 'candidate-variant',
      },
    ])
    expect(documents.baselineDocument).toEqual([
      { name: 'baseline-versionError' },
    ])
    expect(documents.candidateDocument).toEqual([
      { name: 'candidate-versionError' },
    ])
    expect(documents.errorTranslations).toEqual({
      baseline: {
        en: { customer: { version: 'baseline-version' } },
      },
      candidate: {
        en: { customer: { version: 'candidate-version' } },
      },
    })
  })

  it('compares error messages by name instead of array position', () => {
    const comparison = compareApplicationConfigs(
      [
        { code: 'E1', name: 'networkError', textId: 'network_old' },
        { name: 'legacyError', textId: 'legacy' },
      ],
      [
        { name: 'newError', textId: 'new' },
        { code: 'E1', name: 'networkError', textId: 'network_new' },
      ],
      'errors',
    )

    expect(comparison.fields).toEqual(['code', 'textId'])
    expect(
      Object.fromEntries(comparison.rows.map((row) => [row.key, row.status])),
    ).toEqual({
      legacyError: 'onlyBaseline',
      networkError: 'changed',
      newError: 'onlyCandidate',
    })
  })

  it('does not apply translation key filters to errors', () => {
    const comparison = compareApplicationConfigs(
      [{ name: 'customer.error', textId: 'old' }],
      [{ name: 'customer.error', textId: 'new' }],
      'errors',
      { patterns: ['customer.'], useRegex: false },
    )

    expect(comparison.rows).toHaveLength(1)
    expect(comparison.stats.changed).toBe(1)
  })

  it('compares translated customer values instead of error translation keys', () => {
    const comparison = compareApplicationConfigs(
      [
        {
          name: 'sameMeaning',
          textId: 'oldText',
          headerId: 'oldHeader',
          shortcut: {
            key: 'red',
            type: 'External',
            value: 'app.open',
            labelId: 'oldLabel',
          },
        },
        { name: 'changedNorwegian', textId: 'changedText' },
      ],
      [
        {
          name: 'sameMeaning',
          textId: 'newText',
          headerId: 'newHeader',
          shortcut: {
            key: 'red',
            type: 'External',
            value: 'app.open',
            labelId: 'newLabel',
          },
        },
        { name: 'changedNorwegian', textId: 'changedText' },
      ],
      'errors',
      undefined,
      {
        baseline: {
          en: {
            customer: {
              oldText: 'Same text',
              oldHeader: 'Same header',
              oldLabel: 'Same label',
              changedText: 'Same English text',
            },
          },
          nb: {
            customer: {
              oldText: 'Samme tekst',
              oldHeader: 'Samme overskrift',
              oldLabel: 'Samme etikett',
              changedText: 'Før',
            },
          },
        },
        candidate: {
          en: {
            customer: {
              newText: 'Same text',
              newHeader: 'Same header',
              newLabel: 'Same label',
              changedText: 'Same English text',
            },
          },
          nb: {
            customer: {
              newText: 'Samme tekst',
              newHeader: 'Samme overskrift',
              newLabel: 'Samme etikett',
              changedText: 'Etter',
            },
          },
        },
      },
    )

    expect(
      Object.fromEntries(comparison.rows.map((row) => [row.key, row.status])),
    ).toEqual({
      changedNorwegian: 'changed',
      sameMeaning: 'unchanged',
    })
    expect(comparison.fields).toEqual([
      'textId.en',
      'textId.nb',
      'headerId.en',
      'headerId.nb',
      'shortcut.key',
      'shortcut.type',
      'shortcut.value',
      'shortcut.labelId.en',
      'shortcut.labelId.nb',
    ])
    expect(comparison.rows[1].baseline).not.toHaveProperty('textId')
    expect(comparison.rows[1].baseline['textId.en']).toBe('Same text')
    expect(comparison.rows[1].candidate['shortcut.labelId.nb']).toBe(
      'Samme etikett',
    )
  })

  it('never compares unresolved error translation keys literally', () => {
    const comparison = compareApplicationConfigs(
      [
        {
          name: 'unresolvedOnBoth',
          textId: 'baselineMissing',
          headerId: 'baselineHeaderMissing',
          shortcut: { labelId: 'baselineLabelMissing' },
        },
        { name: 'resolvedOnCandidate', textId: 'baselineMissingAgain' },
      ],
      [
        {
          name: 'unresolvedOnBoth',
          textId: 'candidateMissing',
          headerId: 'candidateHeaderMissing',
          shortcut: { labelId: 'candidateLabelMissing' },
        },
        { name: 'resolvedOnCandidate', textId: 'candidateText' },
      ],
      'errors',
      undefined,
      {
        baseline: { en: { customer: {} } },
        candidate: {
          en: { customer: { candidateText: 'Candidate text' } },
        },
      },
    )

    expect(
      Object.fromEntries(comparison.rows.map((row) => [row.key, row.status])),
    ).toEqual({
      resolvedOnCandidate: 'changed',
      unresolvedOnBoth: 'unchanged',
    })
    expect(comparison.fields).toEqual(['textId.en'])
    expect(comparison.rows[1].baseline).toEqual({})
    expect(comparison.rows[1].candidate).toEqual({})
  })
})

describe('globals comparison', () => {
  it('compares settings by key and includes top-level metadata', () => {
    const comparison = compareApplicationConfigs(
      {
        device: 'pc',
        updatedAt: 'before',
        values: [
          { key: 'feature.enabled', type: 'boolean', value: false },
          { key: 'unchanged.count', type: 'number', value: 2 },
        ],
      },
      {
        device: 'pc',
        updatedAt: 'after',
        values: [
          { key: 'unchanged.count', type: 'number', value: 2 },
          { key: 'feature.enabled', type: 'boolean', value: true },
        ],
      },
      'globals',
    )

    expect(comparison.fields).toEqual(['type', 'value'])
    expect(
      Object.fromEntries(comparison.rows.map((row) => [row.key, row.status])),
    ).toEqual({
      'feature.enabled': 'changed',
      'metadata.device': 'unchanged',
      'metadata.updatedAt': 'changed',
      'unchanged.count': 'unchanged',
    })
  })
})

describe('assertApplicationConfigDocument', () => {
  it('accepts each expected root shape and rejects mismatches', () => {
    expect(assertApplicationConfigDocument([], 'errors')).toEqual([])
    expect(assertApplicationConfigDocument({}, 'globals')).toEqual({})
    expect(() => assertApplicationConfigDocument({}, 'errors')).toThrow(
      'not a JSON array',
    )
    expect(() => assertApplicationConfigDocument([], 'translations')).toThrow(
      'not a JSON object',
    )
  })
})
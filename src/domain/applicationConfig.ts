import { readBackendEntries } from './backendConfig'

export type Environment = 'p' | 's' | 't'
export type ConfigDataType = 'translations' | 'errors' | 'globals' | 'branding' | 'backends'

export const CONFIG_DATA_TYPES: ConfigDataType[] = [
  'translations', 'errors', 'globals', 'branding', 'backends',
]

export interface ApplicationConfigRequest {
  environment: Environment
  appVersion: string
  customer: string
  deploymentPhase: string
  device: string
  schemaVersion: string
  variant: string
}

export type ConfigDocument = Record<string, unknown> | unknown[]
export type ConfigValues = Record<string, string | undefined>
export type DiffStatus = 'changed' | 'onlyBaseline' | 'onlyCandidate' | 'unchanged'

export interface FlatConfigEntry {
  id: string
  key: string
  path: string[]
  values: ConfigValues
}

export interface ComparisonRow {
  id: string
  key: string
  path: string[]
  status: DiffStatus
  baseline: ConfigValues
  candidate: ConfigValues
}

export interface ComparisonStats {
  baseline: number
  candidate: number
  changed: number
  onlyBaseline: number
  onlyCandidate: number
  unchanged: number
}

export interface ConfigComparison {
  dataType: ConfigDataType
  rows: ComparisonRow[]
  fields: string[]
  stats: ComparisonStats
}

export interface TranslationKeyFilter {
  patterns: string[]
  useRegex: boolean
}

export interface ErrorTranslationDocuments {
  baseline: ConfigDocument
  candidate: ConfigDocument
}

export interface ComparisonDocuments {
  baselineDocument: ConfigDocument
  candidateDocument: ConfigDocument
  errorTranslations?: ErrorTranslationDocuments
}

export type ComparisonDocumentsResult =
  | { status: 'fulfilled'; value: ComparisonDocuments }
  | { status: 'rejected'; error: Error }

export type ComparisonDocumentsByDataType = Record<
  ConfigDataType,
  ComparisonDocumentsResult
>

const DEFAULT_BRANDING_SCHEMA_VERSION = '5'

const FIELD_PRIORITY: Record<ConfigDataType, string[]> = {
  translations: ['en', 'nb', 'no'],
  errors: [
    'code',
    'textId',
    'headerId',
    'shortcut.key',
    'shortcut.type',
    'shortcut.value',
    'shortcut.labelId',
    'shortcut',
    'value',
  ],
  globals: ['type', 'value'],
  branding: ['type', 'value'],
  backends: ['url', 'options', 'value'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function displayKey(path: string[]): string {
  return path.join('.')
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue)
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeJsonValue(child)]),
    )
  }

  return value
}

export function valueToString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined) {
    return 'undefined'
  }

  if (value === null) {
    return 'null'
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(normalizeJsonValue(value))
}

function sortFields(
  fields: Iterable<string>,
  dataType: ConfigDataType,
): string[] {
  const priority = FIELD_PRIORITY[dataType]

  return [...new Set(fields)].sort((left, right) => {
    const leftPriority = priority.findIndex(
      (field) => left === field || left.startsWith(`${field}.`),
    )
    const rightPriority = priority.findIndex(
      (field) => right === field || right.startsWith(`${field}.`),
    )

    if (leftPriority !== -1 || rightPriority !== -1) {
      if (leftPriority === -1) return 1
      if (rightPriority === -1) return -1
      return leftPriority - rightPriority
    }

    return left.localeCompare(right)
  })
}

function collectTranslationLeaves(
  language: string,
  value: unknown,
  path: string[],
  entries: Map<string, FlatConfigEntry>,
): void {
  if (isRecord(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) {
      collectTranslationLeaves(language, child, [...path, key], entries)
    }
    return
  }

  if (path.length === 0) {
    return
  }

  const id = JSON.stringify(path)
  const entry = entries.get(id) ?? {
    id,
    key: displayKey(path),
    path,
    values: {},
  }

  entry.values[language] = valueToString(value)
  entries.set(id, entry)
}

function valuesFromRecord(
  value: Record<string, unknown>,
  omittedFields: string[] = [],
): ConfigValues {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([field]) => !omittedFields.includes(field))
      .map(([field, fieldValue]) => [field, valueToString(fieldValue)]),
  )
}

function customerTranslationValues(
  document: ConfigDocument,
): Map<string, ConfigValues> {
  if (!isRecord(document)) {
    throw new Error('The translations response is not a JSON object.')
  }

  const translations = new Map<string, ConfigValues>()

  for (const [language, tree] of Object.entries(document)) {
    if (!isRecord(tree) || !isRecord(tree.customer)) {
      continue
    }

    for (const [translationKey, translationValue] of Object.entries(
      tree.customer,
    )) {
      const values = translations.get(translationKey) ?? {}
      values[language] = valueToString(translationValue)
      translations.set(translationKey, values)
    }
  }

  return translations
}

function addResolvedTranslation(
  values: ConfigValues,
  field: string,
  translationKey: unknown,
  translations: Map<string, ConfigValues>,
): boolean {
  if (typeof translationKey !== 'string') {
    return false
  }

  const translatedValues = translations.get(translationKey)
  if (translatedValues) {
    for (const [language, translatedValue] of Object.entries(translatedValues)) {
      values[`${field}.${language}`] = translatedValue
    }
  }

  return true
}

function valuesFromError(
  error: Record<string, unknown>,
  translations?: Map<string, ConfigValues>,
): ConfigValues {
  if (!translations) {
    return valuesFromRecord(error, ['name'])
  }

  const values: ConfigValues = {}

  for (const [field, fieldValue] of Object.entries(error)) {
    if (field === 'name') {
      continue
    }

    if (
      (field === 'textId' || field === 'headerId') &&
      addResolvedTranslation(values, field, fieldValue, translations)
    ) {
      continue
    }

    if (field === 'shortcut' && isRecord(fieldValue)) {
      for (const [shortcutField, shortcutValue] of Object.entries(fieldValue)) {
        const flattenedField = `shortcut.${shortcutField}`
        if (
          shortcutField === 'labelId' &&
          addResolvedTranslation(
            values,
            flattenedField,
            shortcutValue,
            translations,
          )
        ) {
          continue
        }

        values[flattenedField] = valueToString(shortcutValue)
      }
      continue
    }

    values[field] = valueToString(fieldValue)
  }

  return values
}

function flattenErrors(
  document: ConfigDocument,
  translationDocument?: ConfigDocument,
): FlatConfigEntry[] {
  if (!Array.isArray(document)) {
    throw new Error('The errors response is not a JSON array.')
  }

  const occurrences = new Map<string, number>()
  const translations = translationDocument
    ? customerTranslationValues(translationDocument)
    : undefined

  return document
    .map((value, index): FlatConfigEntry => {
      if (!isRecord(value)) {
        const key = `errors[${index}]`
        return {
          id: JSON.stringify(['errors', index]),
          key,
          path: [String(index)],
          values: { value: valueToString(value) },
        }
      }

      const name = typeof value.name === 'string' && value.name
        ? value.name
        : `errors[${index}]`
      const occurrence = (occurrences.get(name) ?? 0) + 1
      occurrences.set(name, occurrence)
      const key = occurrence === 1 ? name : `${name} #${occurrence}`

      return {
        id: JSON.stringify(['errors', name, occurrence]),
        key,
        path: [String(index)],
        values: valuesFromError(value, translations),
      }
    })
    .sort((left, right) => left.key.localeCompare(right.key))
}

function flattenGlobals(document: ConfigDocument): FlatConfigEntry[] {
  if (!isRecord(document)) {
    throw new Error('The globals response is not a JSON object.')
  }

  const entries: FlatConfigEntry[] = Object.entries(document)
    .filter(([key]) => key !== 'values')
    .map(([key, value]) => ({
      id: JSON.stringify(['globals', 'metadata', key]),
      key: `metadata.${key}`,
      path: [key],
      values: { value: valueToString(value) },
    }))

  if (!Array.isArray(document.values)) {
    entries.push({
      id: JSON.stringify(['globals', 'metadata', 'values']),
      key: 'metadata.values',
      path: ['values'],
      values: { value: valueToString(document.values) },
    })
  } else {
    const occurrences = new Map<string, number>()

    document.values.forEach((value, index) => {
      if (!isRecord(value)) {
        entries.push({
          id: JSON.stringify(['globals', 'setting', index]),
          key: `values[${index}]`,
          path: ['values', String(index)],
          values: { value: valueToString(value) },
        })
        return
      }

      const settingKey = typeof value.key === 'string' && value.key
        ? value.key
        : `values[${index}]`
      const occurrence = (occurrences.get(settingKey) ?? 0) + 1
      occurrences.set(settingKey, occurrence)
      const key = occurrence === 1
        ? settingKey
        : `${settingKey} #${occurrence}`

      entries.push({
        id: JSON.stringify(['globals', 'setting', settingKey, occurrence]),
        key,
        path: ['values', String(index)],
        values: valuesFromRecord(value, ['key']),
      })
    })
  }

  return entries.sort((left, right) => left.key.localeCompare(right.key))
}

function displayBrandingPath(path: string[]): string {
  return path.reduce(
    (result, segment) => segment.startsWith('[')
      ? `${result}${segment}`
      : result
        ? `${result}.${segment}`
        : segment,
    '',
  )
}

function brandingValueType(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  return typeof value
}

function collectBrandingLeaves(
  value: unknown,
  path: string[],
  namespace: 'data' | 'metadata',
  entries: FlatConfigEntry[],
): void {
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((child, index) => {
      collectBrandingLeaves(child, [...path, `[${index}]`], namespace, entries)
    })
    return
  }

  if (isRecord(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) {
      collectBrandingLeaves(child, [...path, key], namespace, entries)
    }
    return
  }

  const displayPath = namespace === 'metadata'
    ? ['metadata', ...path]
    : path

  entries.push({
    id: JSON.stringify(['branding', namespace, ...path]),
    key: displayBrandingPath(displayPath),
    path: namespace === 'data' ? ['data', ...path] : path,
    values: {
      type: brandingValueType(value),
      value: valueToString(value),
    },
  })
}

export function flattenBranding(document: ConfigDocument): FlatConfigEntry[] {
  if (!isRecord(document) || !isRecord(document.data)) {
    throw new Error('The branding response does not contain a data object.')
  }

  const data = document.data
  const entries: FlatConfigEntry[] = []

  for (const [key, value] of Object.entries(document)) {
    if (key === 'data') {
      for (const [dataKey, dataValue] of Object.entries(data)) {
        collectBrandingLeaves(dataValue, [dataKey], 'data', entries)
      }
      continue
    }

    collectBrandingLeaves(value, [key], 'metadata', entries)
  }

  if (Object.keys(data).length === 0) {
    collectBrandingLeaves(data, ['data'], 'data', entries)
  }

  return entries.sort((left, right) => left.key.localeCompare(right.key))
}

export function flattenBackends(document: ConfigDocument): FlatConfigEntry[] {
  const entries: FlatConfigEntry[] = readBackendEntries(document).map(
    ({ id, index, element }) => ({
      id,
      key: element.name,
      path: ['backendElements', String(index)],
      values: {
        ...Object.fromEntries(
          Object.entries(element)
            .filter(([field]) => !['name', 'url', 'options'].includes(field))
            .map(([field, value]) => [field, JSON.stringify(normalizeJsonValue(value))]),
        ),
        url: element.url,
        options: valueToString(
          [...element.options].sort((left, right) =>
            left.name.localeCompare(right.name) ||
            valueToString(left).localeCompare(valueToString(right)),
          ),
        ),
      },
    }),
  )

  for (const [key, value] of Object.entries(document)) {
    if (key === 'backendElements') continue
    const normalized = key === 'backendSet' && isRecord(value) && Array.isArray(value.mapping)
      ? {
          ...value,
          mapping: [...value.mapping].sort((left, right) =>
            valueToString(left).localeCompare(valueToString(right)),
          ),
        }
      : value
    entries.push({
      id: JSON.stringify(['backends', 'metadata', key]),
      key: `metadata.${key}`,
      path: [key],
      values: { type: brandingValueType(normalized), value: valueToString(normalized) },
    })
  }

  return entries.sort((left, right) => left.key.localeCompare(right.key))
}

function valuesMatch(
  baseline: ConfigValues,
  candidate: ConfigValues,
  fields: string[],
): boolean {
  return fields.every((field) => baseline[field] === candidate[field])
}

function createIgnoredKeyMatcher(
  filter?: TranslationKeyFilter,
): (key: string) => boolean {
  const patterns = filter?.patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean) ?? []

  if (patterns.length === 0) {
    return () => false
  }

  if (!filter?.useRegex) {
    return (key) => patterns.some((prefix) => key.startsWith(prefix))
  }

  const expressions = patterns.map((pattern) => {
    try {
      return new RegExp(pattern)
    } catch {
      throw new Error(`Invalid regular expression: ${pattern}`)
    }
  })

  return (key) => expressions.some((expression) => expression.test(key))
}

export function validateTranslationKeyFilter(
  filter: TranslationKeyFilter,
): void {
  createIgnoredKeyMatcher(filter)
}

export function buildApplicationConfigUrl(
  request: ApplicationConfigRequest,
  dataType: ConfigDataType,
): string {
  const endpoint = dataType === 'branding' ? 'branding/' : ''
  const url = new URL(
    `https://${request.environment}-front.tvs.telenor.net/application-config-api/v2/${endpoint}`,
  )

  const searchParams = new URLSearchParams()
  if (request.appVersion.trim()) {
    searchParams.set('appVersion', request.appVersion.trim())
  }
  searchParams.set('customer', request.customer)
  if (dataType !== 'branding') {
    searchParams.set('data', dataType)
  }
  if (request.deploymentPhase.trim()) {
    searchParams.set('deploymentPhase', request.deploymentPhase.trim())
  }
  searchParams.set('device', request.device)
  const schemaVersion = request.schemaVersion.trim() ||
    (dataType === 'branding' ? DEFAULT_BRANDING_SCHEMA_VERSION : '')
  if (schemaVersion) {
    searchParams.set('schemaVersion', schemaVersion)
  }
  searchParams.set('variant', request.variant)

  url.search = searchParams.toString()

  return url.toString()
}

export function assertApplicationConfigDocument(
  value: unknown,
  dataType: ConfigDataType,
): ConfigDocument {
  if (dataType === 'errors') {
    if (!Array.isArray(value)) {
      throw new Error('The errors response is not a JSON array.')
    }
    return value
  }

  if (!isRecord(value)) {
    throw new Error(`The ${dataType} response is not a JSON object.`)
  }

  if (dataType === 'backends') {
    readBackendEntries(value)
  }

  return value
}

export async function fetchApplicationConfig(
  request: ApplicationConfigRequest,
  dataType: ConfigDataType,
  signal?: AbortSignal,
): Promise<ConfigDocument> {
  const response = await fetch(buildApplicationConfigUrl(request, dataType), {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}.`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('The endpoint returned invalid JSON.')
  }

  return assertApplicationConfigDocument(payload, dataType)
}

export async function fetchComparisonDocuments(
  baselineRequest: ApplicationConfigRequest,
  candidateRequest: ApplicationConfigRequest,
  dataType: ConfigDataType,
  signal?: AbortSignal,
): Promise<ComparisonDocuments> {
  if (dataType === 'errors') {
    const [
      baselineDocument,
      candidateDocument,
      baselineTranslations,
      candidateTranslations,
    ] = await Promise.all([
      fetchApplicationConfig(baselineRequest, dataType, signal),
      fetchApplicationConfig(candidateRequest, dataType, signal),
      fetchApplicationConfig(baselineRequest, 'translations', signal),
      fetchApplicationConfig(candidateRequest, 'translations', signal),
    ])

    return {
      baselineDocument,
      candidateDocument,
      errorTranslations: {
        baseline: baselineTranslations,
        candidate: candidateTranslations,
      },
    }
  }

  const [baselineDocument, candidateDocument] = await Promise.all([
    fetchApplicationConfig(baselineRequest, dataType, signal),
    fetchApplicationConfig(candidateRequest, dataType, signal),
  ])

  return { baselineDocument, candidateDocument }
}

export async function fetchAllComparisonDocuments(
  baselineRequest: ApplicationConfigRequest,
  candidateRequest: ApplicationConfigRequest,
  signal?: AbortSignal,
): Promise<ComparisonDocumentsByDataType> {
  const baselineTranslations = fetchApplicationConfig(
    baselineRequest,
    'translations',
    signal,
  )
  const candidateTranslations = fetchApplicationConfig(
    candidateRequest,
    'translations',
    signal,
  )
  const baselineErrors = fetchApplicationConfig(
    baselineRequest,
    'errors',
    signal,
  )
  const candidateErrors = fetchApplicationConfig(
    candidateRequest,
    'errors',
    signal,
  )
  const baselineGlobals = fetchApplicationConfig(
    baselineRequest,
    'globals',
    signal,
  )
  const candidateGlobals = fetchApplicationConfig(
    candidateRequest,
    'globals',
    signal,
  )
  const baselineBranding = fetchApplicationConfig(
    baselineRequest,
    'branding',
    signal,
  )
  const candidateBranding = fetchApplicationConfig(
    candidateRequest,
    'branding',
    signal,
  )
  const baselineBackends = fetchApplicationConfig(baselineRequest, 'backends', signal)
  const candidateBackends = fetchApplicationConfig(candidateRequest, 'backends', signal)

  const results = await Promise.allSettled([
    Promise.all([baselineTranslations, candidateTranslations]).then(
      ([baselineDocument, candidateDocument]) => ({
        baselineDocument,
        candidateDocument,
      }),
    ),
    Promise.all([
      baselineErrors,
      candidateErrors,
      baselineTranslations,
      candidateTranslations,
    ]).then(
      ([
        baselineDocument,
        candidateDocument,
        baselineErrorTranslations,
        candidateErrorTranslations,
      ]) => ({
        baselineDocument,
        candidateDocument,
        errorTranslations: {
          baseline: baselineErrorTranslations,
          candidate: candidateErrorTranslations,
        },
      }),
    ),
    Promise.all([baselineGlobals, candidateGlobals]).then(
      ([baselineDocument, candidateDocument]) => ({
        baselineDocument,
        candidateDocument,
      }),
    ),
    Promise.all([baselineBranding, candidateBranding]).then(
      ([baselineDocument, candidateDocument]) => ({
        baselineDocument,
        candidateDocument,
      }),
    ),
    Promise.all([baselineBackends, candidateBackends]).then(
      ([baselineDocument, candidateDocument]) => ({
        baselineDocument,
        candidateDocument,
      }),
    ),
  ])

  const normalizeResult = (
    result: PromiseSettledResult<ComparisonDocuments>,
  ): ComparisonDocumentsResult => {
    if (result.status === 'fulfilled') {
      return result
    }

    return {
      status: 'rejected',
      error: result.reason instanceof Error
        ? result.reason
        : new Error('The application config files could not be loaded.'),
    }
  }

  return {
    translations: normalizeResult(results[0]),
    errors: normalizeResult(results[1]),
    globals: normalizeResult(results[2]),
    branding: normalizeResult(results[3]),
    backends: normalizeResult(results[4]),
  }
}

export function flattenTranslations(
  document: ConfigDocument,
): FlatConfigEntry[] {
  if (!isRecord(document)) {
    throw new Error('The translations response is not a JSON object.')
  }

  const entries = new Map<string, FlatConfigEntry>()

  for (const [language, tree] of Object.entries(document)) {
    if (isRecord(tree)) {
      collectTranslationLeaves(language, tree, [], entries)
    }
  }

  return [...entries.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  )
}

export function flattenApplicationConfig(
  document: ConfigDocument,
  dataType: ConfigDataType,
  translationDocument?: ConfigDocument,
): FlatConfigEntry[] {
  switch (dataType) {
    case 'translations':
      return flattenTranslations(document)
    case 'errors':
      return flattenErrors(document, translationDocument)
    case 'globals':
      return flattenGlobals(document)
    case 'branding':
      return flattenBranding(document)
    case 'backends':
      return flattenBackends(document)
  }
}

export function compareApplicationConfigs(
  baselineDocument: ConfigDocument,
  candidateDocument: ConfigDocument,
  dataType: ConfigDataType,
  keyFilter?: TranslationKeyFilter,
  errorTranslations?: ErrorTranslationDocuments,
): ConfigComparison {
  const isIgnoredKey = dataType === 'translations'
    ? createIgnoredKeyMatcher(keyFilter)
    : () => false
  const baselineRows = flattenApplicationConfig(
    baselineDocument,
    dataType,
    errorTranslations?.baseline,
  )
    .filter((row) => !isIgnoredKey(row.key))
  const candidateRows = flattenApplicationConfig(
    candidateDocument,
    dataType,
    errorTranslations?.candidate,
  )
    .filter((row) => !isIgnoredKey(row.key))
  const baselineById = new Map(baselineRows.map((row) => [row.id, row]))
  const candidateById = new Map(candidateRows.map((row) => [row.id, row]))
  const ids = new Set([...baselineById.keys(), ...candidateById.keys()])
  const fields = sortFields(
    [...baselineRows, ...candidateRows].flatMap((row) =>
      Object.keys(row.values),
    ),
    dataType,
  )

  const rows = [...ids]
    .map((id): ComparisonRow => {
      const baseline = baselineById.get(id)
      const candidate = candidateById.get(id)
      let status: DiffStatus

      if (!candidate) {
        status = 'onlyBaseline'
      } else if (!baseline) {
        status = 'onlyCandidate'
      } else if (valuesMatch(baseline.values, candidate.values, fields)) {
        status = 'unchanged'
      } else {
        status = 'changed'
      }

      const source = baseline ?? candidate!
      return {
        id,
        key: source.key,
        path: source.path,
        status,
        baseline: baseline?.values ?? {},
        candidate: candidate?.values ?? {},
      }
    })
    .sort((left, right) => left.key.localeCompare(right.key))

  const stats = rows.reduce<ComparisonStats>(
    (result, row) => ({ ...result, [row.status]: result[row.status] + 1 }),
    {
      baseline: baselineRows.length,
      candidate: candidateRows.length,
      changed: 0,
      onlyBaseline: 0,
      onlyCandidate: 0,
      unchanged: 0,
    },
  )

  return { dataType, rows, fields, stats }
}
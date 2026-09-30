import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  AlertCircle,
  ArrowLeftRight,
  Braces,
  Database,
  Files,
  KeyRound,
  Languages,
  ListFilter,
  LoaderCircle,
  Network,
  Regex,
  Search,
} from 'lucide-react'
import { ConfigPanel } from './components/ConfigPanel'
import { BackendExplorer } from './components/BackendExplorer'
import { JsonViewer } from './components/JsonViewer'
import { ResultsTable } from './components/ResultsTable'
import {
  normalizeAppVersionHistory,
  rememberAppVersion,
  removeAppVersion,
} from './domain/appVersionHistory'
import {
  buildApplicationConfigUrl,
  CONFIG_DATA_TYPES,
  compareApplicationConfigs,
  fetchAllComparisonDocuments,
  validateTranslationKeyFilter,
  type ApplicationConfigRequest,
  type ConfigComparison,
  type ConfigDataType,
  type ConfigDocument,
  type TranslationKeyFilter,
} from './domain/applicationConfig'

type ViewMode = 'files' | 'differences' | 'unique' | 'endpoints'

interface LoadedDataTypeComparison {
  baselineDocument: ConfigDocument
  candidateDocument: ConfigDocument
  comparison: ConfigComparison
}

interface LoadedComparison {
  results: Partial<Record<ConfigDataType, LoadedDataTypeComparison>>
  failures: Partial<Record<ConfigDataType, string>>
  baselineRequest: ApplicationConfigRequest
  candidateRequest: ApplicationConfigRequest
  keyFilter?: TranslationKeyFilter
  loadedAt: Date
}

interface ComparisonInput {
  baselineRequest: ApplicationConfigRequest
  candidateRequest: ApplicationConfigRequest
  keyFilter?: TranslationKeyFilter
  requestUrl: string
}

interface DataTypeContent {
  entryLabel: string
  summaryLabel: string
  keyColumnLabel: string
  uniqueLabel: string
  searchLabel: string
  searchPlaceholder: string
  emptyMessage: string
}

const RESULT_PAGE_SIZE = 150
const APP_VERSION_HISTORY_STORAGE_KEY =
  'application-config.app-version-history.v1'

const DEFAULT_REQUEST: ApplicationConfigRequest = {
  environment: 'p',
  appVersion: '',
  customer: 'cdk',
  deploymentPhase: '',
  device: 'pc',
  schemaVersion: '',
  variant: 'adb_g3',
}

const DATA_TYPE_CONTENT: Record<ConfigDataType, DataTypeContent> = {
  translations: {
    entryLabel: 'translation keys',
    summaryLabel: 'Keys',
    keyColumnLabel: 'Translation key',
    uniqueLabel: 'Unique keys',
    searchLabel: 'Search translation keys and values',
    searchPlaceholder: 'Search keys or translations',
    emptyMessage: 'No matching translation keys',
  },
  errors: {
    entryLabel: 'error messages',
    summaryLabel: 'Errors',
    keyColumnLabel: 'Error name',
    uniqueLabel: 'Unique errors',
    searchLabel: 'Search error names and fields',
    searchPlaceholder: 'Search errors or fields',
    emptyMessage: 'No matching error messages',
  },
  globals: {
    entryLabel: 'config entries',
    summaryLabel: 'Entries',
    keyColumnLabel: 'Global setting',
    uniqueLabel: 'Unique settings',
    searchLabel: 'Search global settings and values',
    searchPlaceholder: 'Search settings or values',
    emptyMessage: 'No matching global settings',
  },
  branding: {
    entryLabel: 'branding properties',
    summaryLabel: 'Properties',
    keyColumnLabel: 'Branding path',
    uniqueLabel: 'Unique properties',
    searchLabel: 'Search branding paths and values',
    searchPlaceholder: 'Search paths or values',
    emptyMessage: 'No matching branding properties',
  },
  backends: {
    entryLabel: 'backend and metadata entries',
    summaryLabel: 'Entries',
    keyColumnLabel: 'Backend / metadata',
    uniqueLabel: 'Unique backends',
    searchLabel: 'Search backend names, hosts, URLs, options and mappings',
    searchPlaceholder: 'Search APIs, hosts, options or URL parameters',
    emptyMessage: 'No matching backends',
  },
}

const REQUEST_FIELDS = Object.keys(DEFAULT_REQUEST) as (keyof ApplicationConfigRequest)[]

function loadAppVersionHistory(): string[] {
  try {
    const storedHistory = localStorage.getItem(APP_VERSION_HISTORY_STORAGE_KEY)
    return storedHistory
      ? normalizeAppVersionHistory(JSON.parse(storedHistory))
      : []
  } catch {
    return []
  }
}

function requestsMatch(
  current: ApplicationConfigRequest,
  loaded: ApplicationConfigRequest,
): boolean {
  return REQUEST_FIELDS.every((field) => current[field] === loaded[field])
}

function countDifferences(comparison: ConfigComparison): number {
  return comparison.stats.changed +
    comparison.stats.onlyBaseline +
    comparison.stats.onlyCandidate
}

export default function App() {
  const [baselineRequest, setBaselineRequest] =
    useState<ApplicationConfigRequest>(DEFAULT_REQUEST)
  const [candidateRequest, setCandidateRequest] =
    useState<ApplicationConfigRequest>(DEFAULT_REQUEST)
  const [appVersionHistory, setAppVersionHistory] =
    useState<string[]>(loadAppVersionHistory)
  const [activeDataType, setActiveDataType] =
    useState<ConfigDataType>('translations')
  const [loaded, setLoaded] = useState<LoadedComparison | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('differences')
  const [language, setLanguage] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [ignoredKeyPatterns, setIgnoredKeyPatterns] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(RESULT_PAGE_SIZE)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingIdenticalComparison, setPendingIdenticalComparison] =
    useState<ComparisonInput | null>(null)
  const requestController = useRef<AbortController | null>(null)
  const warningDialogRef = useRef<HTMLDialogElement | null>(null)
  const deferredSearch = useDeferredValue(searchQuery)

  useEffect(
    () => () => {
      requestController.current?.abort()
    },
    [],
  )

  useEffect(() => {
    const dialog = warningDialogRef.current
    if (pendingIdenticalComparison && dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [pendingIdenticalComparison])

  useEffect(() => {
    try {
      localStorage.setItem(
        APP_VERSION_HISTORY_STORAGE_KEY,
        JSON.stringify(appVersionHistory),
      )
    } catch {
      return
    }
  }, [appVersionHistory])

  function updateBaseline<Field extends keyof ApplicationConfigRequest>(
    field: Field,
    value: ApplicationConfigRequest[Field],
  ) {
    setBaselineRequest((current) => ({ ...current, [field]: value }))
  }

  function updateCandidate<Field extends keyof ApplicationConfigRequest>(
    field: Field,
    value: ApplicationConfigRequest[Field],
  ) {
    setCandidateRequest((current) => ({ ...current, [field]: value }))
  }

  function rememberVersion(value: string) {
    setAppVersionHistory((current) => rememberAppVersion(current, value))
  }

  function forgetVersion(value: string) {
    setAppVersionHistory((current) => removeAppVersion(current, value))
  }

  function selectDataType(nextDataType: ConfigDataType) {
    setActiveDataType(nextDataType)
    setViewMode((current) => nextDataType === 'backends'
      ? 'endpoints'
      : current === 'endpoints' ? 'differences' : current)
    setLanguage('all')
    setSearchQuery('')
    setVisibleLimit(RESULT_PAGE_SIZE)
  }

  async function runComparison(input: ComparisonInput) {
    requestController.current?.abort()

    const controller = new AbortController()
    requestController.current = controller
    setIsLoading(true)
    setError(null)

    try {
      const documents = await fetchAllComparisonDocuments(
        input.baselineRequest,
        input.candidateRequest,
        controller.signal,
      )
      const results: Partial<Record<
        ConfigDataType,
        LoadedDataTypeComparison
      >> = {}
      const failures: Partial<Record<ConfigDataType, string>> = {}
      const buildResult = (
        resultDataType: ConfigDataType,
      ): void => {
        const resultDocuments = documents[resultDataType]

        if (resultDocuments.status === 'rejected') {
          failures[resultDataType] = resultDocuments.error.message
          return
        }

        try {
          results[resultDataType] = {
            baselineDocument: resultDocuments.value.baselineDocument,
            candidateDocument: resultDocuments.value.candidateDocument,
            comparison: compareApplicationConfigs(
              resultDocuments.value.baselineDocument,
              resultDocuments.value.candidateDocument,
              resultDataType,
              resultDataType === 'translations' ? input.keyFilter : undefined,
              resultDocuments.value.errorTranslations,
            ),
          }
        } catch (comparisonError) {
          failures[resultDataType] = comparisonError instanceof Error
            ? comparisonError.message
            : `The ${resultDataType} response could not be compared.`
        }
      }

      CONFIG_DATA_TYPES.forEach(buildResult)
      const availableDataTypes = CONFIG_DATA_TYPES.filter(
        (dataType) => results[dataType],
      )
      if (availableDataTypes.length === 0) {
        const firstFailure = CONFIG_DATA_TYPES
          .map((dataType) => documents[dataType])
          .find((result) => result.status === 'rejected')
        throw firstFailure?.status === 'rejected'
          ? firstFailure.error
          : new Error(Object.values(failures).join(' ') || 'The application config files could not be loaded.')
      }

      startTransition(() => {
        setLoaded({
          results,
          failures,
          baselineRequest: { ...input.baselineRequest },
          candidateRequest: { ...input.candidateRequest },
          keyFilter: input.keyFilter
            ? {
                ...input.keyFilter,
                patterns: [...input.keyFilter.patterns],
              }
            : undefined,
          loadedAt: new Date(),
        })
        setActiveDataType(availableDataTypes[0])
        setViewMode('differences')
        setLanguage('all')
        setSearchQuery('')
        setVisibleLimit(RESULT_PAGE_SIZE)
      })
    } catch (requestError) {
      if (
        requestError instanceof DOMException &&
        requestError.name === 'AbortError'
      ) {
        return
      }

      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The application config files could not be loaded.',
      )
    } finally {
      if (requestController.current === controller) {
        setIsLoading(false)
      }
    }
  }

  function handleCompare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const keyFilter = {
      patterns: ignoredKeyPatterns.split(/\r?\n/),
      useRegex,
    }

    try {
      validateTranslationKeyFilter(keyFilter)
    } catch (filterError) {
      setError(
        filterError instanceof Error
          ? filterError.message
          : 'The ignored key filter is invalid.',
      )
      return
    }

    const input: ComparisonInput = {
      baselineRequest: { ...baselineRequest },
      candidateRequest: { ...candidateRequest },
      keyFilter,
      requestUrl: buildApplicationConfigUrl(baselineRequest, 'translations'),
    }
    const candidateUrl = buildApplicationConfigUrl(
      candidateRequest,
      'translations',
    )

    setAppVersionHistory((current) => {
      const withBaseline = rememberAppVersion(
        current,
        input.baselineRequest.appVersion,
      )
      return rememberAppVersion(withBaseline, input.candidateRequest.appVersion)
    })

    if (input.requestUrl === candidateUrl) {
      setPendingIdenticalComparison(input)
      return
    }

    void runComparison(input)
  }

  function compareIdenticalSources() {
    if (!pendingIdenticalComparison) {
      return
    }

    const input = pendingIdenticalComparison
    setPendingIdenticalComparison(null)
    void runComparison(input)
  }

  function selectView(nextView: ViewMode) {
    setViewMode(nextView)
    setVisibleLimit(RESULT_PAGE_SIZE)
  }

  const activeResult = loaded?.results[activeDataType]
  const loadedDataTypeCount = loaded
    ? CONFIG_DATA_TYPES.filter((dataType) => loaded.results[dataType]).length
    : 0
  const failedDataTypes = loaded
    ? CONFIG_DATA_TYPES.filter((dataType) => loaded.failures[dataType])
    : []
  const comparison = activeResult?.comparison
  const visibleFields = comparison
    ? activeDataType === 'translations' && language !== 'all'
      ? [language]
      : comparison.fields
    : []
  const normalizedSearch = deferredSearch.trim().toLocaleLowerCase()
  const filteredRows = comparison
    ? comparison.rows.filter((row) => {
        const isInView =
          viewMode === 'endpoints'
            ? true
            : viewMode === 'differences'
            ? row.status !== 'unchanged'
            : row.status === 'onlyBaseline' || row.status === 'onlyCandidate'

        if (!isInView) {
          return false
        }

        if (!normalizedSearch) {
          return true
        }

        const fieldValues = visibleFields.flatMap((field) => [
          row.baseline[field],
          row.candidate[field],
        ])
        return [row.key, ...fieldValues]
          .join('\n')
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      })
    : []
  const visibleRows = filteredRows.slice(0, visibleLimit)
  const differenceCount = comparison ? countDifferences(comparison) : 0
  const uniqueCount = comparison
    ? comparison.stats.onlyBaseline + comparison.stats.onlyCandidate
    : 0
  const baselineIsCurrent = loaded
    ? requestsMatch(baselineRequest, loaded.baselineRequest)
    : false
  const candidateIsCurrent = loaded
    ? requestsMatch(candidateRequest, loaded.candidateRequest)
    : false
  const resultContent = DATA_TYPE_CONTENT[activeDataType]

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Application config home">
          <span className="brand-mark">
            <Braces size={20} aria-hidden="true" />
          </span>
          <span>Application config</span>
        </a>
        <code className="api-label">application-config-api / v2</code>
      </header>

      <main className="app-main" id="top">
        <section className="data-type-section" aria-labelledby="app-heading">
          <div>
            <span className="section-kicker">Configuration explorer</span>
            <h1 id="app-heading">Application config</h1>
          </div>
          <div className="data-type-summary" aria-label="Included data types">
            <Database size={18} aria-hidden="true" />
            <span>Data</span>
            <code>{CONFIG_DATA_TYPES.join(' / ')}</code>
          </div>
        </section>

        <section className="source-section" aria-labelledby="sources-heading">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Request builder</span>
              <h2 id="sources-heading">Sources</h2>
            </div>
            <span className="endpoint-path">{CONFIG_DATA_TYPES.length} endpoints per source</span>
          </div>

          <form onSubmit={handleCompare}>
            <div className="source-grid">
              <ConfigPanel
                kind="baseline"
                marker="A"
                title="Baseline"
                request={baselineRequest}
                dataType={activeDataType}
                appVersionHistory={appVersionHistory}
                onChange={updateBaseline}
                onRememberAppVersion={rememberVersion}
                onRemoveAppVersion={forgetVersion}
                loadedSummary={
                  activeResult && baselineIsCurrent
                    ? {
                      entryCount: activeResult.comparison.stats.baseline,
                      entryLabel: resultContent.entryLabel,
                      fields: activeDataType === 'errors' || activeDataType === 'backends'
                        ? undefined
                        : activeResult.comparison.fields,
                      }
                    : undefined
                }
              />
              <ConfigPanel
                kind="candidate"
                marker="B"
                title="Candidate"
                request={candidateRequest}
                dataType={activeDataType}
                appVersionHistory={appVersionHistory}
                onChange={updateCandidate}
                onRememberAppVersion={rememberVersion}
                onRemoveAppVersion={forgetVersion}
                onCopy={() => setCandidateRequest({ ...baselineRequest })}
                loadedSummary={
                  activeResult && candidateIsCurrent
                    ? {
                      entryCount: activeResult.comparison.stats.candidate,
                      entryLabel: resultContent.entryLabel,
                      fields: activeDataType === 'errors' || activeDataType === 'backends'
                        ? undefined
                        : activeResult.comparison.fields,
                      }
                    : undefined
                }
              />
            </div>

            <div className="key-filter-panel">
                <label className="key-filter-field">
                  <span>
                    {useRegex ? 'Ignored key patterns' : 'Ignored key prefixes'}
                    <small>One per line</small>
                  </span>
                  <textarea
                    value={ignoredKeyPatterns}
                    onChange={(event) => setIgnoredKeyPatterns(event.target.value)}
                    placeholder={useRegex ? '^customer\\.\\d' : 'customer.'}
                    rows={2}
                    spellCheck="false"
                  />
                </label>

                <label className="regex-toggle">
                  <input
                    type="checkbox"
                    checked={useRegex}
                    onChange={(event) => setUseRegex(event.target.checked)}
                  />
                  <span className="toggle-track" aria-hidden="true">
                    <span />
                  </span>
                  <Regex size={17} aria-hidden="true" />
                  <span>Regular expressions</span>
                </label>
            </div>

            <div className="compare-action">
              <div className="compare-route" aria-hidden="true">
                <span>A</span>
                <ArrowLeftRight size={17} />
                <span>B</span>
              </div>
              <button className="primary-button" type="submit" disabled={isLoading}>
                {isLoading ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <ArrowLeftRight size={18} aria-hidden="true" />
                )}
                {isLoading ? 'Loading files' : 'Fetch & compare'}
              </button>
            </div>
          </form>

          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </section>

        {loaded && activeResult && comparison && (
          <section className="results-section" aria-labelledby="results-heading">
            <div className="results-heading">
              <div>
                <span className="section-kicker">Loaded comparison</span>
                <h2 id="results-heading">Results</h2>
              </div>
              <div className="results-meta">
                <span className="loaded-data-type">
                  {loadedDataTypeCount} of {CONFIG_DATA_TYPES.length} data types
                </span>
                {activeDataType === 'translations' &&
                  loaded.keyFilter?.patterns.some((pattern) => pattern.trim()) && (
                  <span className="active-filter">
                    Loaded with{' '}
                    {loaded.keyFilter!.patterns.filter((pattern) => pattern.trim())
                      .length}{' '}
                    {loaded.keyFilter!.useRegex ? 'regex' : 'prefix'}{' '}
                    {loaded.keyFilter!.patterns.filter((pattern) => pattern.trim())
                      .length === 1
                      ? 'filter'
                      : 'filters'}
                  </span>
                )}
                <div className="loaded-versions">
                  <code>
                    {loaded.baselineRequest.appVersion || 'appVersion omitted'}
                  </code>
                  <ArrowLeftRight size={15} aria-hidden="true" />
                  <code>
                    {loaded.candidateRequest.appVersion || 'appVersion omitted'}
                  </code>
                  <time dateTime={loaded.loadedAt.toISOString()}>
                    {loaded.loadedAt.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              </div>
            </div>

            {failedDataTypes.length > 0 && (
              <div className="partial-results-banner" role="status">
                <AlertCircle size={18} aria-hidden="true" />
                <span>
                  The available data was compared.{' '}
                  {failedDataTypes.map((dataType) => (
                    <span key={dataType}>
                      <strong>{dataType}</strong>: {loaded.failures[dataType]}{' '}
                    </span>
                  ))}
                </span>
              </div>
            )}

            <div className="data-tabs" role="tablist" aria-label="Config data type">
              {CONFIG_DATA_TYPES.map((resultDataType) => {
                const result = loaded.results[resultDataType]

                return (
                  <button
                    id={`data-tab-${resultDataType}`}
                    type="button"
                    role="tab"
                    aria-selected={activeDataType === resultDataType}
                    aria-controls="results-data-panel"
                    disabled={!result}
                    onClick={() => selectDataType(resultDataType)}
                    key={resultDataType}
                  >
                    <span>{resultDataType}</span>
                    <strong>
                      {result
                        ? countDifferences(result.comparison).toLocaleString()
                        : 'N/A'}
                    </strong>
                  </button>
                )
              })}
            </div>

            <div
              id="results-data-panel"
              role="tabpanel"
              aria-labelledby={`data-tab-${activeDataType}`}
            >
              <div className="summary-strip">
              <div>
                <span>{resultContent.summaryLabel} in A</span>
                <strong>{comparison.stats.baseline.toLocaleString()}</strong>
              </div>
              <div>
                <span>{resultContent.summaryLabel} in B</span>
                <strong>{comparison.stats.candidate.toLocaleString()}</strong>
              </div>
              <div className="summary-strip__changed">
                <span>Changed</span>
                <strong>{comparison.stats.changed.toLocaleString()}</strong>
              </div>
              <div className="summary-strip__removed">
                <span>Only in A</span>
                <strong>{comparison.stats.onlyBaseline.toLocaleString()}</strong>
              </div>
              <div className="summary-strip__added">
                <span>Only in B</span>
                <strong>{comparison.stats.onlyCandidate.toLocaleString()}</strong>
              </div>
              </div>

              <div className="results-controls">
              <div className="view-tabs" role="tablist" aria-label="Result view">
                {activeDataType === 'backends' && (
                  <button type="button" role="tab" aria-selected={viewMode === 'endpoints'}
                    aria-controls="results-panel" onClick={() => selectView('endpoints')}>
                    <Network size={16} aria-hidden="true" />
                    All APIs
                  </button>
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'files'}
                  aria-controls="results-panel"
                  onClick={() => selectView('files')}
                >
                  <Files size={16} aria-hidden="true" />
                  Full files
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'differences'}
                  aria-controls="results-panel"
                  onClick={() => selectView('differences')}
                >
                  <ListFilter size={16} aria-hidden="true" />
                  Differences
                  <span>{differenceCount.toLocaleString()}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'unique'}
                  aria-controls="results-panel"
                  onClick={() => selectView('unique')}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  {resultContent.uniqueLabel}
                  <span>{uniqueCount.toLocaleString()}</span>
                </button>
              </div>

              {viewMode !== 'files' && (
                <div className="result-tools">
                  <label className="search-box">
                    <Search size={16} aria-hidden="true" />
                    <span className="sr-only">{resultContent.searchLabel}</span>
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.target.value)
                        setVisibleLimit(RESULT_PAGE_SIZE)
                      }}
                      placeholder={resultContent.searchPlaceholder}
                    />
                  </label>
                  {activeDataType === 'translations' && (
                    <label className="language-select">
                      <Languages size={16} aria-hidden="true" />
                      <span className="sr-only">Language</span>
                      <select
                        value={language}
                        onChange={(event) => {
                          setLanguage(event.target.value)
                          setVisibleLimit(RESULT_PAGE_SIZE)
                        }}
                      >
                        <option value="all">All languages</option>
                        {comparison.fields.map((languageCode) => (
                          <option value={languageCode} key={languageCode}>
                            {languageCode.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
              </div>

              <div id="results-panel" role="tabpanel">
              {viewMode === 'files' ? (
                <div className="json-grid">
                  <JsonViewer
                    marker="A"
                    title="Baseline"
                    dataType={activeDataType}
                    version={
                      loaded.baselineRequest.appVersion || 'appVersion-omitted'
                    }
                    document={activeResult.baselineDocument}
                  />
                  <JsonViewer
                    marker="B"
                    title="Candidate"
                    dataType={activeDataType}
                    version={
                      loaded.candidateRequest.appVersion || 'appVersion-omitted'
                    }
                    document={activeResult.candidateDocument}
                  />
                </div>
              ) : activeDataType === 'backends' ? (
                <BackendExplorer
                  rows={filteredRows}
                  baselineDocument={activeResult.baselineDocument}
                  candidateDocument={activeResult.candidateDocument}
                  onSearchHost={(host) => {
                    setSearchQuery(host)
                    setViewMode('endpoints')
                  }}
                  key={loaded.loadedAt.getTime()}
                />
              ) : (
                <ResultsTable
                  rows={activeDataType === 'errors' ? visibleRows : filteredRows}
                  fields={visibleFields}
                  dataType={activeDataType}
                  keyColumnLabel={resultContent.keyColumnLabel}
                  emptyMessage={resultContent.emptyMessage}
                  totalRows={filteredRows.length}
                  hasMore={
                    activeDataType === 'errors' &&
                    visibleRows.length < filteredRows.length
                  }
                  onShowMore={() =>
                    setVisibleLimit((current) => current + RESULT_PAGE_SIZE)
                  }
                  key={`${loaded.loadedAt.getTime()}-${activeDataType}-${viewMode}`}
                />
              )}
              </div>
            </div>
          </section>
        )}
      </main>

      {pendingIdenticalComparison && (
        <dialog
          className="warning-dialog"
          ref={warningDialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="same-url-warning-title"
          aria-describedby="same-url-warning-description"
          onCancel={() => setPendingIdenticalComparison(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPendingIdenticalComparison(null)
            }
          }}
        >
          <div className="warning-dialog__header">
            <span className="warning-dialog__icon">
              <AlertCircle size={21} aria-hidden="true" />
            </span>
            <div>
              <span className="section-kicker">Identical sources</span>
              <h2 id="same-url-warning-title">A and B use the same URL</h2>
            </div>
          </div>
          <div className="warning-dialog__body">
            <p id="same-url-warning-description">
              This comparison will load the same configuration twice and is
              expected to produce no differences.
            </p>
            <code>{pendingIdenticalComparison.requestUrl}</code>
          </div>
          <footer className="warning-dialog__actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setPendingIdenticalComparison(null)}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={compareIdenticalSources}
            >
              <ArrowLeftRight size={17} aria-hidden="true" />
              Compare anyway
            </button>
          </footer>
        </dialog>
      )}
    </div>
  )
}
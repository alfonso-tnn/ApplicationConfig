import {
  CheckCircle2,
  Copy,
  ExternalLink,
  MonitorSmartphone,
  Server,
  SlidersHorizontal,
} from 'lucide-react'
import {
  buildApplicationConfigUrl,
  type ApplicationConfigRequest,
  type ConfigDataType,
  type Environment,
} from '../domain/applicationConfig'
import { AppVersionField } from './AppVersionField'

type TextRequestField = Exclude<keyof ApplicationConfigRequest, 'environment'>

interface RequestField {
  name: TextRequestField
  label: string
  wide?: boolean
  optional?: boolean
}

const REQUEST_FIELDS: RequestField[] = [
  { name: 'appVersion', label: 'App version', wide: true },
  { name: 'customer', label: 'Customer' },
  { name: 'device', label: 'Device' },
  { name: 'variant', label: 'Variant', wide: true },
]

const ADVANCED_FIELDS: RequestField[] = [
  { name: 'schemaVersion', label: 'Schema version', optional: true },
  {
    name: 'deploymentPhase',
    label: 'Deployment phase',
    optional: true,
  },
]

const DEVICE_OPTIONS = [
  'androidtv_launcher',
  'androidtv',
  'appletv',
  'chromecast',
  'phone',
  'stb',
  'pc',
] as const

interface LoadedSummary {
  entryCount: number
  entryLabel: string
  fields?: string[]
}

interface ConfigPanelProps {
  kind: 'baseline' | 'candidate'
  marker: 'A' | 'B'
  title: string
  request: ApplicationConfigRequest
  dataType: ConfigDataType
  appVersionHistory: string[]
  loadedSummary?: LoadedSummary
  onChange: <Field extends keyof ApplicationConfigRequest>(
    field: Field,
    value: ApplicationConfigRequest[Field],
  ) => void
  onCopy?: () => void
  onRememberAppVersion: (value: string) => void
  onRemoveAppVersion: (value: string) => void
}

export function ConfigPanel({
  kind,
  marker,
  title,
  request,
  dataType,
  appVersionHistory,
  loadedSummary,
  onChange,
  onCopy,
  onRememberAppVersion,
  onRemoveAppVersion,
}: ConfigPanelProps) {
  const headingId = `${kind}-heading`
  const requestUrl = buildApplicationConfigUrl(request, dataType)

  return (
    <section
      className={`source-panel source-panel--${kind}`}
      aria-labelledby={headingId}
    >
      <header className="source-panel__header">
        <div className="source-identity">
          <span className="source-marker" aria-hidden="true">
            {marker}
          </span>
          <div>
            <span className="source-kicker">Config source</span>
            <h3 id={headingId}>{title}</h3>
          </div>
        </div>

        {onCopy && (
          <button
            className="icon-text-button"
            type="button"
            onClick={onCopy}
            title="Copy baseline settings"
          >
            <Copy size={15} aria-hidden="true" />
            Copy A
          </button>
        )}
      </header>

      <div className="request-grid">
        <label className="request-field request-field--wide">
          <span>Environment</span>
          <div className="select-shell">
            <Server size={16} aria-hidden="true" />
            <select
              value={request.environment}
              onChange={(event) =>
                onChange('environment', event.target.value as Environment)
              }
              required
            >
              <option value="p">p - Production</option>
              <option value="s">s - Staging</option>
              <option value="t">t - Test</option>
            </select>
          </div>
        </label>

        {REQUEST_FIELDS.map((field) =>
          field.name === 'appVersion' ? (
            <AppVersionField
              kind={kind}
              value={request.appVersion}
              history={appVersionHistory}
              onChange={(value) => onChange('appVersion', value)}
              onRemember={onRememberAppVersion}
              onRemove={onRemoveAppVersion}
              key={field.name}
            />
          ) : (
            <label
              className={`request-field${field.wide ? ' request-field--wide' : ''}`}
              key={field.name}
            >
              <span className="request-field-label">
                {field.label}
                {field.optional && <small>Optional</small>}
              </span>
              {field.name === 'device' ? (
                <div className="select-shell">
                  <MonitorSmartphone size={16} aria-hidden="true" />
                  <select
                    name={`${kind}-${field.name}`}
                    value={request.device}
                    onChange={(event) => onChange('device', event.target.value)}
                    required
                  >
                    {DEVICE_OPTIONS.map((device) => (
                      <option value={device} key={device}>
                        {device}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  name={`${kind}-${field.name}`}
                  value={request[field.name]}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                  required={!field.optional}
                />
              )}
            </label>
          ),
        )}
      </div>

      <details className="advanced-options">
        <summary>
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span>Advanced</span>
          <small>Optional parameters</small>
        </summary>
        <div className="advanced-options__fields">
          {ADVANCED_FIELDS.map((field) => (
            <label className="request-field" key={field.name}>
              <span className="request-field-label">
                {field.label}
                <small>Optional</small>
              </span>
              <input
                name={`${kind}-${field.name}`}
                value={request[field.name]}
                onChange={(event) => onChange(field.name, event.target.value)}
                autoComplete="off"
                spellCheck="false"
              />
            </label>
          ))}
        </div>
      </details>

      <footer className="source-panel__footer">
        <a
          className="request-url"
          href={requestUrl}
          target="_blank"
          rel="noreferrer"
          title={`Open ${title} request URL`}
        >
          <ExternalLink size={13} aria-hidden="true" />
          <code>{requestUrl}</code>
        </a>
        {loadedSummary && (
          <span className="loaded-summary">
            <CheckCircle2 size={15} aria-hidden="true" />
            {loadedSummary.entryCount.toLocaleString()} {loadedSummary.entryLabel}
            {loadedSummary.fields?.length
              ? ` | ${loadedSummary.fields.join(', ')}`
              : ''}
          </span>
        )}
      </footer>
    </section>
  )
}
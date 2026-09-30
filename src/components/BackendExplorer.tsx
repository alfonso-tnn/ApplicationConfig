import { useState } from 'react'
import { Globe, Network, SearchX } from 'lucide-react'
import {
  valueToString,
  type ComparisonRow,
  type ConfigDocument,
  type DiffStatus,
} from '../domain/applicationConfig'
import {
  backendRoles,
  inspectEndpoint,
  readBackendEntries,
  type BackendElement,
  type BackendOption,
} from '../domain/backendConfig'

const STATUS_LABELS: Record<DiffStatus, string> = {
  changed: 'Changed', onlyBaseline: 'A only', onlyCandidate: 'B only', unchanged: 'Unchanged',
}

function EndpointValue({ value, other }: { value: string; other?: string }) {
  const endpoint = inspectEndpoint(value)
  const otherEndpoint = inspectEndpoint(other)
  if (!endpoint) {
    return <code className="backend-raw-url">{value || '(empty URL)'}</code>
  }

  return (
    <div className="endpoint-value">
      <div className="endpoint-tags">
        <span className={endpoint.protocol !== otherEndpoint?.protocol ? 'endpoint-part--changed' : ''}>
          {endpoint.protocol.toUpperCase()}
        </span>
        {endpoint.version && <span className={endpoint.version !== otherEndpoint?.version ? 'endpoint-part--changed' : ''}>API {endpoint.version}</span>}
        {endpoint.scalerValue && (
          <span className="scaler-tag" title="Numeric scaler path parameter; the URL alone does not establish a compression ratio.">
            Scaler setting: {endpoint.scalerValue}
          </span>
        )}
      </div>
      <code className={endpoint.host !== otherEndpoint?.host ? 'endpoint-part--changed' : ''}>
        {endpoint.host}
      </code>
      <code className={`endpoint-path-value${endpoint.path !== otherEndpoint?.path ? ' endpoint-part--changed' : ''}`}>
        {endpoint.path}
      </code>
      {endpoint.query.length > 0 && (
        <div className="endpoint-query" aria-label="URL query parameters">
          {endpoint.query.map(([key, parameter], index) => (
            <code
              className={JSON.stringify(endpoint.query.filter(([name]) => name === key)) !==
                JSON.stringify(otherEndpoint?.query.filter(([name]) => name === key))
                ? 'endpoint-part--changed' : ''}
              key={`${key}-${index}`}
            >
              {key} = {parameter || '(empty)'}
            </code>
          ))}
        </div>
      )}
      {endpoint.fragment && <code className={endpoint.fragment !== otherEndpoint?.fragment ? 'endpoint-part--changed' : ''}>Fragment: {endpoint.fragment}</code>}
      <details className="endpoint-original">
        <summary>Exact URL</summary>
        <code className="backend-raw-url">{value}</code>
      </details>
    </div>
  )
}

function OptionValue({
  option, other,
}: {
  option?: BackendOption
  other?: BackendOption
}) {
  const [revealed, setRevealed] = useState(false)
  if (!option) return <span className="not-present">Not present</span>
  const sensitive = /pass|secret|token|credential/i.test(option.name)
  const details = Object.entries(option).filter(([key]) => key !== 'name' && key !== 'value')
  return (
    <div className={valueToString(option) !== valueToString(other) ? 'backend-option--changed' : ''}>
      {sensitive && !revealed ? (
        <span className="not-present">Hidden sensitive value</span>
      ) : inspectEndpoint(option.value) ? (
        <EndpointValue
          value={String(option.value)}
          other={typeof other?.value === 'string' ? other.value : undefined}
        />
      ) : (
        <code className="backend-option-value">{valueToString(option.value) || '(empty string)'}</code>
      )}
      {sensitive && (
        <button className="icon-text-button" type="button" onClick={() => setRevealed(!revealed)}>
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      )}
      {details.map(([key, value]) => (
        <small className="backend-option-detail" key={key}>{key}: {valueToString(value)}</small>
      ))}
    </div>
  )
}

function namedOptions(element?: BackendElement): Map<string, BackendOption> {
  const occurrences = new Map<string, number>()
  const options = [...(element?.options ?? [])].sort((left, right) =>
    left.name.localeCompare(right.name) || valueToString(left).localeCompare(valueToString(right)),
  )
  return new Map(options.map((option) => {
    const occurrence = (occurrences.get(option.name) ?? 0) + 1
    occurrences.set(option.name, occurrence)
    return [JSON.stringify([option.name, occurrence]), option]
  }))
}

function ServiceCard({
  row, baseline, candidate, baselineDocument, candidateDocument,
}: {
  row: ComparisonRow
  baseline?: BackendElement
  candidate?: BackendElement
  baselineDocument: ConfigDocument
  candidateDocument: ConfigDocument
}) {
  const leftOptions = namedOptions(baseline)
  const rightOptions = namedOptions(candidate)
  const optionIds = [...new Set([...leftOptions.keys(), ...rightOptions.keys()])].sort()
  const changedOptions = optionIds.filter((id) =>
    valueToString(leftOptions.get(id)) !== valueToString(rightOptions.get(id)),
  ).length
  const extraFields = [...new Set([...Object.keys(row.baseline), ...Object.keys(row.candidate)])]
    .filter((key) => key !== 'url' && key !== 'options')

  return (
    <article className={`backend-card backend-card--${row.status}`}>
      <header className="backend-card__heading">
        <div><Network size={18} aria-hidden="true" /><h3>{row.key || '(unnamed backend)'}</h3></div>
        <span className={`status-badge status-badge--${row.status}`}>{STATUS_LABELS[row.status]}</span>
      </header>
      <div className="backend-url-grid">
        {([
          ['A', baseline, candidate, baselineDocument],
          ['B', candidate, baseline, candidateDocument],
        ] as const).map(([marker, element, other, document]) => (
          <div className="backend-source" key={marker}>
            <div className="backend-source__label">
              <span className={`source-marker source-marker--${marker}`}>{marker}</span>
              <strong>{marker === 'A' ? 'Baseline' : 'Candidate'}</strong>
              {element && backendRoles(document, element.name).map((role, index) => (
                <span className="backend-role" key={`${role}-${index}`}>Role: {role}</span>
              ))}
            </div>
            {element ? <EndpointValue value={element.url} other={other?.url} /> :
              <span className="not-present">Service not present</span>}
          </div>
        ))}
      </div>
      {optionIds.length > 0 && (
        <details className="backend-options" open>
          <summary>Options &amp; additional APIs <span>{optionIds.length} options / {changedOptions} different</span></summary>
          <div className="backend-table-scroll">
            <table className="backend-options-table">
              <thead><tr><th scope="col">Option / API</th><th scope="col">A · Baseline</th><th scope="col">B · Candidate</th></tr></thead>
              <tbody>{optionIds.map((id) => {
                const left = leftOptions.get(id)
                const right = rightOptions.get(id)
                return (
                  <tr key={id}>
                    <th scope="row"><code>{(left ?? right)?.name}</code></th>
                    <td><OptionValue option={left} other={right} /></td>
                    <td><OptionValue option={right} other={left} /></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </details>
      )}
      {extraFields.length > 0 && (
        <details className="backend-options">
          <summary>Additional backend fields</summary>
          {extraFields.map((field) => (
            <div className="backend-metadata-field" key={field}>
              <strong>{field}</strong>
              <code>A: {row.baseline[field] ?? '(not present)'}</code>
              <code>B: {row.candidate[field] ?? '(not present)'}</code>
            </div>
          ))}
        </details>
      )}
    </article>
  )
}

function documentEndpoints(document: ConfigDocument) {
  const services = readBackendEntries(document)
  const endpoints = services.flatMap(({ element }) => [
    inspectEndpoint(element.url),
    ...element.options.map((option) => inspectEndpoint(option.value)),
  ]).filter((endpoint) => endpoint !== null)
  return {
    services: services.length,
    options: services.reduce((count, { element }) => count + element.options.length, 0),
    endpoints,
  }
}

export function BackendExplorer({
  rows, baselineDocument, candidateDocument, onSearchHost,
}: {
  rows: ComparisonRow[]
  baselineDocument: ConfigDocument
  candidateDocument: ConfigDocument
  onSearchHost: (host: string) => void
}) {
  const baseline = new Map(readBackendEntries(baselineDocument).map(({ id, element }) => [id, element]))
  const candidate = new Map(readBackendEntries(candidateDocument).map(({ id, element }) => [id, element]))
  const left = documentEndpoints(baselineDocument)
  const right = documentEndpoints(candidateDocument)
  const hosts = [...new Set([...left.endpoints, ...right.endpoints].map((endpoint) => endpoint.host))].sort()
  const services = rows.filter((row) => baseline.has(row.id) || candidate.has(row.id))
  const metadata = rows.filter((row) => !baseline.has(row.id) && !candidate.has(row.id))

  return (
    <div className="backend-explorer">
      <section className="backend-overview" aria-label="Backend inventory">
        <div className="backend-overview__title">
          <Globe size={22} aria-hidden="true" />
          <div><h3>API landscape</h3><p>Main endpoints and URL-valued options. No requests are made to these services.</p></div>
        </div>
        <div className="backend-inventory">
          <span><strong>{left.services} / {right.services}</strong> services A / B</span>
          <span><strong>{left.endpoints.length} / {right.endpoints.length}</strong> URL references A / B</span>
          <span><strong>{hosts.length}</strong> distinct hosts across A + B</span>
          <span><strong>{left.options} / {right.options}</strong> options A / B</span>
        </div>
        <div className="backend-hosts" aria-label="Filter by host">
          {hosts.map((host) => (
            <button type="button" onClick={() => onSearchHost(host)} key={host} title={`Search for ${host}`}>
              <code>{host}</code>
              <small>A {left.endpoints.filter((endpoint) => endpoint.host === host).length} · B {right.endpoints.filter((endpoint) => endpoint.host === host).length}</small>
            </button>
          ))}
        </div>
        <p className="backend-help">URLs are split into host, path, API version, and query parameters. Highlighted values differ between A and B. Scaler path settings are shown as encoded; they are not a confirmed compression percentage.</p>
      </section>
      <p className="backend-visible-count">{services.length} services and {metadata.length} metadata entries in this view</p>
      {rows.length === 0 && (
        <div className="empty-results"><SearchX size={24} aria-hidden="true" /><span>No matching backends or metadata. Try All APIs to include unchanged services.</span></div>
      )}
      {services.map((row) => (
        <ServiceCard row={row} baseline={baseline.get(row.id)} candidate={candidate.get(row.id)}
          baselineDocument={baselineDocument} candidateDocument={candidateDocument} key={row.id} />
      ))}
      {metadata.map((row) => (
        <details className="backend-metadata backend-card" key={row.id} open={row.status !== 'unchanged'}>
          <summary>{row.key} <span className={`status-badge status-badge--${row.status}`}>{STATUS_LABELS[row.status]}</span></summary>
          <p className="backend-help">Backend-set mapping connects app roles to the service names above. Metadata is compared too.</p>
          <div className="backend-url-grid">
            {([['A', row.baseline.value, baselineDocument], ['B', row.candidate.value, candidateDocument]] as const).map(([marker, value, document]) => (
              <div className="backend-source" key={marker}><strong>{marker} · {marker === 'A' ? 'Baseline' : 'Candidate'}</strong>
                <pre>{value === undefined ? '(not present)' : JSON.stringify(
                  Array.isArray(document) ? document[Number(row.path[0])] : document[row.path[0]], null, 2,
                )}</pre>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

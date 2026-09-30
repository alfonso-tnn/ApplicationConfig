import { Fragment, useState } from 'react'
import { ChevronRight, SearchX } from 'lucide-react'
import type {
  ComparisonRow,
  ConfigDataType,
  ConfigValues,
  DiffStatus,
} from '../domain/applicationConfig'

const STATUS_LABELS: Record<DiffStatus, string> = {
  changed: 'Changed',
  onlyBaseline: 'A only',
  onlyCandidate: 'B only',
  unchanged: 'Unchanged',
}

const FIELD_LABELS: Record<string, string> = {
  code: 'CODE',
  textId: 'TEXT ID',
  headerId: 'HEADER ID',
  shortcut: 'SHORTCUT',
  type: 'TYPE',
  value: 'VALUE',
}

function formatFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .toUpperCase()
}

function formatConfigValue(
  value: string,
  field: string,
  values: ConfigValues,
  dataType: ConfigDataType,
): string {
  if (dataType !== 'globals' || field !== 'value' || values.type !== 'json') {
    return value
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function ConfigValueText({
  value,
  collapsible,
}: {
  value: string
  collapsible: boolean
}) {
  const lineCount = value.split('\n').length

  if (!collapsible || (value.length <= 360 && lineCount <= 8)) {
    return value
  }

  const preview = value.replace(/\s+/g, ' ').slice(0, 190)

  return (
    <details className="long-value">
      <summary>{preview}&hellip;</summary>
      <pre>{value}</pre>
    </details>
  )
}

interface ConfigCellProps {
  values: ConfigValues
  comparisonValues: ConfigValues
  fields: string[]
  dataType: ConfigDataType
}

function ConfigCell({
  values,
  comparisonValues,
  fields,
  dataType,
}: ConfigCellProps) {
  const hasValue = fields.some((field) => values[field] !== undefined)

  if (!hasValue) {
    return <span className="not-present">Not present</span>
  }

  return (
    <div className="value-stack">
      {fields.map((field) => {
        const value = values[field]
        const isDifferent = value !== comparisonValues[field]
        const fieldLabel = dataType === 'translations'
          ? field.toUpperCase()
          : formatFieldLabel(field)
        const formattedValue = value === undefined
          ? undefined
          : formatConfigValue(value, field, values, dataType)

        return (
          <div className="value-line" key={field}>
            <span className="field-tag">{fieldLabel}</span>
            <div
              className={`config-value${isDifferent ? ' config-value--changed' : ''}`}
            >
              {formattedValue === undefined ? (
                <span className="missing-value">Missing</span>
              ) : formattedValue === '' ? (
                <span className="empty-value">Empty string</span>
              ) : (
                <ConfigValueText
                  value={formattedValue}
                  collapsible={dataType === 'globals'}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface ResultsTableProps {
  rows: ComparisonRow[]
  fields: string[]
  dataType: ConfigDataType
  keyColumnLabel: string
  emptyMessage: string
  totalRows: number
  hasMore: boolean
  onShowMore: () => void
}

interface ResultGroup {
  name: string
  rows: ComparisonRow[]
}

function groupNameFromKey(key: string): string {
  const separatorIndex = key.indexOf('.')
  return separatorIndex > 0 ? key.slice(0, separatorIndex) : key
}

function groupResultRows(rows: ComparisonRow[]): ResultGroup[] {
  const groups = new Map<string, ComparisonRow[]>()

  for (const row of rows) {
    const groupName = groupNameFromKey(row.key)
    const groupRows = groups.get(groupName) ?? []
    groupRows.push(row)
    groups.set(groupName, groupRows)
  }

  return [...groups].map(([name, groupRows]) => ({
    name,
    rows: groupRows,
  }))
}

function ResultRow({
  row,
  fields,
  dataType,
}: {
  row: ComparisonRow
  fields: string[]
  dataType: ConfigDataType
}) {
  return (
    <tr>
      <th scope="row" className="key-cell">
        <span className={`status-badge status-badge--${row.status}`}>
          {STATUS_LABELS[row.status]}
        </span>
        <code>{row.key}</code>
      </th>
      <td>
        <ConfigCell
          values={row.baseline}
          comparisonValues={row.candidate}
          fields={fields}
          dataType={dataType}
        />
      </td>
      <td>
        <ConfigCell
          values={row.candidate}
          comparisonValues={row.baseline}
          fields={fields}
          dataType={dataType}
        />
      </td>
    </tr>
  )
}

export function ResultsTable({
  rows,
  fields,
  dataType,
  keyColumnLabel,
  emptyMessage,
  totalRows,
  hasMore,
  onShowMore,
}: ResultsTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  )
  const shouldGroup = dataType === 'translations' ||
    dataType === 'globals' ||
    dataType === 'branding'
  const groups = shouldGroup ? groupResultRows(rows) : []

  function toggleGroup(groupName: string) {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }

  if (totalRows === 0) {
    return (
      <div className="empty-results">
        <SearchX size={24} aria-hidden="true" />
        <strong>{emptyMessage}</strong>
      </div>
    )
  }

  return (
    <div className="table-frame">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{keyColumnLabel}</th>
              <th scope="col">Baseline A</th>
              <th scope="col">Candidate B</th>
            </tr>
          </thead>
          <tbody>
            {shouldGroup
              ? groups.map((group) => {
                const isExpanded = expandedGroups.has(group.name)
                const differenceLabel = group.rows.length === 1
                  ? 'difference'
                  : 'differences'

                return (
                  <Fragment key={group.name}>
                    <tr className="result-group-row">
                      <th colSpan={3} scope="rowgroup">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleGroup(group.name)}
                        >
                          <ChevronRight size={17} aria-hidden="true" />
                          <code>{group.name}</code>
                          <span>
                            {group.rows.length.toLocaleString()} {differenceLabel}
                          </span>
                        </button>
                      </th>
                    </tr>
                    {isExpanded && group.rows.map((row) => (
                      <ResultRow
                        row={row}
                        fields={fields}
                        dataType={dataType}
                        key={row.id}
                      />
                    ))}
                  </Fragment>
                )
              })
              : rows.map((row) => (
                <ResultRow
                  row={row}
                  fields={fields}
                  dataType={dataType}
                  key={row.id}
                />
              ))}
          </tbody>
        </table>
      </div>

      <footer className="table-footer">
        <span>
          {shouldGroup
            ? `${groups.length.toLocaleString()} groups | ${totalRows.toLocaleString()} differences`
            : `Showing ${rows.length.toLocaleString()} of ${totalRows.toLocaleString()}`}
        </span>
        {hasMore && (
          <button className="secondary-button" type="button" onClick={onShowMore}>
            Show more
          </button>
        )}
      </footer>
    </div>
  )
}
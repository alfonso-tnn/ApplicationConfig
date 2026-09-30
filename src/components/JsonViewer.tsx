import { useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import type {
  ConfigDataType,
  ConfigDocument,
} from '../domain/applicationConfig'

interface JsonViewerProps {
  marker: 'A' | 'B'
  title: string
  version: string
  dataType: ConfigDataType
  document: ConfigDocument
}

export function JsonViewer({
  marker,
  title,
  version,
  dataType,
  document,
}: JsonViewerProps) {
  const [copied, setCopied] = useState(false)
  const formattedJson = JSON.stringify(document, null, 2)

  async function copyJson() {
    await navigator.clipboard.writeText(formattedJson)
    setCopied(true)
  }

  function downloadJson() {
    const blob = new Blob([formattedJson], { type: 'application/json' })
    const objectUrl = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '-')

    link.href = objectUrl
    link.download = `application-config-${dataType}-${safeVersion}.json`
    link.click()
    URL.revokeObjectURL(objectUrl)
  }

  return (
    <article className="json-pane">
      <header className="json-pane__header">
        <div>
          <span className="source-marker" aria-hidden="true">
            {marker}
          </span>
          <div>
            <h3>{title}</h3>
            <code>{version}</code>
          </div>
        </div>
        <div className="icon-actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => void copyJson()}
            title="Copy JSON"
            aria-label={`Copy ${title} JSON`}
          >
            {copied ? (
              <Check size={17} aria-hidden="true" />
            ) : (
              <Copy size={17} aria-hidden="true" />
            )}
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={downloadJson}
            title="Download JSON"
            aria-label={`Download ${title} JSON`}
          >
            <Download size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <pre>
        <code>{formattedJson}</code>
      </pre>
    </article>
  )
}
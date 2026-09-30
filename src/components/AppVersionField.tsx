import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Clock3, Trash2 } from 'lucide-react'
import { APP_VERSION_HISTORY_LIMIT } from '../domain/appVersionHistory'

interface AppVersionFieldProps {
  kind: 'baseline' | 'candidate'
  value: string
  history: string[]
  onChange: (value: string) => void
  onRemember: (value: string) => void
  onRemove: (value: string) => void
}

export function AppVersionField({
  kind,
  value,
  history,
  onChange,
  onRemember,
  onRemove,
}: AppVersionFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const fieldId = `${kind}-appVersion`
  const historyId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const removalFocusIndexRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
        inputRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  useEffect(() => {
    const removalIndex = removalFocusIndexRef.current
    if (removalIndex === null) {
      return
    }

    removalFocusIndexRef.current = null
    const removeButtons = rootRef.current?.querySelectorAll<HTMLButtonElement>(
      '.app-version-history__remove',
    )
    const nextButton = removeButtons?.[
      Math.min(removalIndex, removeButtons.length - 1)
    ]

    if (nextButton) {
      nextButton.focus()
      return
    }

    setIsOpen(false)
    inputRef.current?.focus()
  }, [history])

  function selectVersion(version: string) {
    onChange(version)
    onRemember(version)
    setIsOpen(false)
    inputRef.current?.focus()
  }

  function removeVersion(version: string, index: number) {
    removalFocusIndexRef.current = index
    onRemove(version)
  }

  return (
    <div
      className="request-field request-field--wide app-version-field"
      ref={rootRef}
    >
      <label className="request-field-label" htmlFor={fieldId}>
        <span>App version</span>
        <small>
          Optional{history.length > 0 ? ` | ${history.length} saved` : ''}
        </small>
      </label>
      <div className="app-version-input-shell">
        <input
          id={fieldId}
          ref={inputRef}
          name={`${kind}-appVersion`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !isOpen) {
              event.preventDefault()
              setIsOpen(true)
            }
          }}
          autoComplete="off"
          spellCheck="false"
        />
        <button
          className="app-version-history-toggle"
          type="button"
          aria-label={`${isOpen ? 'Hide' : 'Show'} saved app versions for ${kind}`}
          aria-expanded={isOpen}
          aria-controls={historyId}
          onClick={() => setIsOpen((current) => !current)}
          title="Saved app versions"
        >
          <Clock3 size={15} aria-hidden="true" />
          <ChevronDown
            className={isOpen ? 'app-version-chevron--open' : undefined}
            size={14}
            aria-hidden="true"
          />
        </button>
      </div>

      {isOpen && (
        <div className="app-version-history" id={historyId}>
          <header>
            <span>Saved versions</span>
            <small>
              {history.length} / {APP_VERSION_HISTORY_LIMIT}
            </small>
          </header>
          {history.length === 0 ? (
            <div className="app-version-history__empty">
              <Clock3 size={17} aria-hidden="true" />
              <span>No saved versions yet</span>
            </div>
          ) : (
            <ul>
              {history.map((version, index) => {
                const isCurrent = value.trim() === version

                return (
                  <li className={isCurrent ? 'is-current' : undefined} key={version}>
                    <button
                      className="app-version-history__select"
                      type="button"
                      onClick={() => selectVersion(version)}
                      aria-current={isCurrent ? 'true' : undefined}
                      aria-label={`Use app version ${version}`}
                    >
                      <code>{version}</code>
                      {isCurrent && <Check size={15} aria-hidden="true" />}
                    </button>
                    <button
                      className="app-version-history__remove"
                      type="button"
                      onClick={() => removeVersion(version, index)}
                      aria-label={`Remove app version ${version} from saved versions`}
                      title="Remove saved version"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
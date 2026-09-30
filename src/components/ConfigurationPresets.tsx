import { useState, type FormEvent } from 'react'
import { AlertCircle, Bookmark, FolderOpen, Save, Trash2 } from 'lucide-react'
import {
  CONFIGURATION_PRESETS_STORAGE_KEY,
  copyConfigurationSettings,
  deleteConfigurationPreset,
  findConfigurationPreset,
  loadConfigurationPresets,
  saveConfigurationPreset,
  writeConfigurationPresets,
  type ConfigurationPreset,
  type ConfigurationSettings,
} from '../domain/configurationPresets'

type PresetState =
  | { status: 'ready'; presets: ConfigurationPreset[] }
  | { status: 'error'; message: string }

type PendingAction =
  | { kind: 'save'; id: string; name: string; settings: ConfigurationSettings }
  | { kind: 'delete'; preset: ConfigurationPreset }
  | { kind: 'reset' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Local configuration storage is unavailable.'
}

function initialState(): PresetState {
  try {
    return { status: 'ready', presets: loadConfigurationPresets(localStorage) }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) }
  }
}

export function ConfigurationPresets({
  settings,
  onLoad,
}: {
  settings: ConfigurationSettings
  onLoad: (settings: ConfigurationSettings) => void
}) {
  const [state, setState] = useState<PresetState>(initialState)
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const presets = state.status === 'ready' ? state.presets : []
  const selected = presets.find((preset) => preset.id === selectedId)
  const disabled = state.status !== 'ready' || pending !== null

  function persistSave(presetName: string, snapshot: ConfigurationSettings, replacementId?: string) {
    try {
      const latest = loadConfigurationPresets(localStorage)
      const existing = findConfigurationPreset(latest, presetName)
      if (existing?.id !== replacementId) {
        throw new Error('A configuration with this name changed in another tab. Cancel and save again to confirm replacement.')
      }
      const next = saveConfigurationPreset(latest, presetName, snapshot, crypto.randomUUID())
      writeConfigurationPresets(localStorage, next)
      const saved = findConfigurationPreset(next, presetName)!
      setState({ status: 'ready', presets: next })
      setSelectedId(saved.id)
      setName(saved.name)
      setMessage(`"${saved.name}" saved locally.`)
      setError('')
      setPending(null)
    } catch (saveError) {
      setMessage('')
      setError(`Could not save: ${errorMessage(saveError)}`)
    }
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      if (!name.trim()) throw new Error('Enter a name for this configuration.')
      const latest = loadConfigurationPresets(localStorage)
      const existing = findConfigurationPreset(latest, name)
      if (existing) {
        setPending({ kind: 'save', id: existing.id, name: existing.name, settings: copyConfigurationSettings(settings) })
      } else {
        persistSave(name, settings)
      }
    } catch (saveError) {
      setError(`Could not save: ${errorMessage(saveError)}`)
    }
  }

  function loadSelected() {
    try {
      const latest = loadConfigurationPresets(localStorage)
      const preset = latest.find((item) => item.id === selectedId)
      if (!preset) throw new Error('The selected saved configuration no longer exists.')
      onLoad(copyConfigurationSettings(preset.settings))
      setState({ status: 'ready', presets: latest })
      setName(preset.name)
      setError('')
      setMessage(`"${preset.name}" loaded. Use Fetch & compare to refresh the results.`)
    } catch (loadError) {
      setMessage('')
      setError(`Could not load: ${errorMessage(loadError)}`)
    }
  }

  function confirmAction() {
    if (!pending) return
    if (pending.kind === 'save') {
      persistSave(pending.name, pending.settings, pending.id)
      return
    }
    try {
      if (pending.kind === 'reset') {
        localStorage.removeItem(CONFIGURATION_PRESETS_STORAGE_KEY)
        setState({ status: 'ready', presets: [] })
        setSelectedId('')
        setMessage('Local saved configurations cleared.')
      } else {
        const next = deleteConfigurationPreset(loadConfigurationPresets(localStorage), pending.preset.id)
        writeConfigurationPresets(localStorage, next)
        setState({ status: 'ready', presets: next })
        if (selectedId === pending.preset.id) setSelectedId('')
        setMessage(`"${pending.preset.name}" deleted.`)
      }
      setPending(null)
      setError('')
    } catch (storageError) {
      setMessage('')
      setError(`Could not update local storage: ${errorMessage(storageError)}`)
    }
  }

  return (
    <section className="preset-panel" aria-labelledby="presets-heading">
      <header className="preset-panel__header">
        <Bookmark size={18} aria-hidden="true" />
        <div>
          <h3 id="presets-heading">Saved configurations</h3>
          <p>A + B sources, advanced fields, ignored-key filter and regex setting. Stored only in this browser, for this website.</p>
        </div>
      </header>
      <div className="preset-controls">
        <form onSubmit={handleSave} className="preset-save">
          <label className="request-field">
            <span>Configuration name</span>
            <input value={name} onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Production vs staging" disabled={disabled} autoComplete="off" />
          </label>
          <button className="secondary-button" type="submit" disabled={disabled || !name.trim()}>
            <Save size={15} aria-hidden="true" /> Save
          </button>
        </form>
        <div className="preset-load">
          <label className="request-field">
            <span>Saved configuration</span>
            <select value={selectedId} disabled={disabled || presets.length === 0}
              onChange={(event) => { setSelectedId(event.target.value); setMessage(''); setError('') }}>
              <option value="">{presets.length ? 'Choose a configuration' : 'No saved configurations'}</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
          </label>
          <button className="secondary-button" type="button" disabled={disabled || !selected} onClick={loadSelected}>
            <FolderOpen size={15} aria-hidden="true" /> Load
          </button>
          <button className="icon-text-button preset-delete" type="button" disabled={disabled || !selected}
            aria-label="Delete saved configuration"
            onClick={() => { if (selected) { setMessage(''); setError(''); setPending({ kind: 'delete', preset: selected }) } }}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {state.status === 'error' && (
        <div className="preset-error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>Could not read saved configurations: {state.message} Existing data has not been overwritten.</span>
          <button className="icon-text-button" type="button" disabled={pending !== null}
            onClick={() => setPending({ kind: 'reset' })}>Clear saved configurations</button>
        </div>
      )}
      {pending && (
        <div className="preset-confirmation" role="group" aria-label="Confirm saved configuration change">
          <span>
            {pending.kind === 'save' ? `Replace "${pending.name}" with the current configuration?`
              : pending.kind === 'delete' ? `Delete "${pending.preset.name}"?`
                : 'Clear all saved configurations for this website? This cannot be undone.'}
          </span>
          <button className="secondary-button" type="button" onClick={confirmAction}>
            {pending.kind === 'save' ? 'Replace configuration' : pending.kind === 'delete' ? 'Confirm delete' : 'Confirm clear'}
          </button>
          <button className="icon-text-button" type="button" onClick={() => { setPending(null); setError('') }}>Cancel</button>
        </div>
      )}
      {error && <p className="preset-error" role="alert"><AlertCircle size={16} aria-hidden="true" />{error}</p>}
      <p className="preset-message" role="status">{message}</p>
    </section>
  )
}

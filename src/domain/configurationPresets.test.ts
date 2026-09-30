import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APPLICATION_CONFIG_REQUEST, buildApplicationConfigUrl } from './applicationConfig'
import {
  CONFIGURATION_PRESETS_STORAGE_KEY,
  copyConfigurationSettings,
  deleteConfigurationPreset,
  findConfigurationPreset,
  loadConfigurationPresets,
  parseConfigurationPresets,
  saveConfigurationPreset,
  writeConfigurationPresets,
  type ConfigurationSettings,
} from './configurationPresets'

const settings: ConfigurationSettings = {
  baselineRequest: {
    environment: 'p', appVersion: 'baseline', customer: 'cdk',
    deploymentPhase: 'WebPortal 6.1', device: 'pc', schemaVersion: '5', variant: 'default',
  },
  candidateRequest: {
    environment: 's', appVersion: 'candidate', customer: 'other',
    deploymentPhase: 'WebPortal 6.2', device: 'phone', schemaVersion: '7', variant: 'custom',
  },
  ignoredKeyPatterns: '^customer\\.test\nanother.',
  useRegex: true,
}

function storage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

describe('configuration presets', () => {
  it('defaults new requests to the default variant', () => {
    expect(DEFAULT_APPLICATION_CONFIG_REQUEST.variant).toBe('default')
    expect(new URL(buildApplicationConfigUrl(DEFAULT_APPLICATION_CONFIG_REQUEST, 'backends'))
      .searchParams.get('variant')).toBe('default')
  })

  it('roundtrips every A/B source field and filter in one storage entry', () => {
    const local = storage()
    const presets = saveConfigurationPreset([], '  Production vs staging  ', settings, 'first')
    writeConfigurationPresets(local, presets)
    expect(local.setItem).toHaveBeenCalledTimes(1)
    expect([...local.values.keys()]).toEqual([CONFIGURATION_PRESETS_STORAGE_KEY])
    expect(loadConfigurationPresets(local)).toEqual([{
      id: 'first', name: 'Production vs staging', settings,
    }])
  })

  it('keeps false, empty optional fields, and draft filters without changing values', () => {
    const draft = {
      ...settings,
      baselineRequest: { ...settings.baselineRequest, appVersion: '', deploymentPhase: '', schemaVersion: '' },
      ignoredKeyPatterns: '',
      useRegex: false,
    }
    const local = storage()
    writeConfigurationPresets(local, saveConfigurationPreset([], 'Draft', draft, 'draft'))
    expect(loadConfigurationPresets(local)[0].settings).toEqual(draft)
  })

  it('supports multiple named configurations and updates only the matching name', () => {
    const first = saveConfigurationPreset([], 'One', settings, 'one')
    const both = saveConfigurationPreset(first, 'Two', { ...settings, useRegex: false }, 'two')
    const changed = saveConfigurationPreset(both, ' one ', { ...settings, ignoredKeyPatterns: 'new' }, 'unused')
    expect(changed).toHaveLength(2)
    expect(findConfigurationPreset(changed, 'ONE')?.id).toBe('one')
    expect(changed[0].settings.ignoredKeyPatterns).toBe('new')
    expect(changed[1]).toEqual(both[1])
    expect(both[0].settings.ignoredKeyPatterns).toBe(settings.ignoredKeyPatterns)
  })

  it('copies nested requests so loading/editing cannot mutate the saved snapshot', () => {
    const presets = saveConfigurationPreset([], 'Original', settings, 'original')
    const loaded = copyConfigurationSettings(presets[0].settings)
    loaded.baselineRequest.variant = 'edited'
    loaded.candidateRequest.appVersion = 'changed'
    expect(presets[0].settings).toEqual(settings)
  })

  it('deletes only the selected preset and reports unknown IDs', () => {
    const first = saveConfigurationPreset([], 'One', settings, 'one')
    const both = saveConfigurationPreset(first, 'Two', settings, 'two')
    expect(deleteConfigurationPreset(both, 'one')).toEqual([both[1]])
    expect(() => deleteConfigurationPreset(both, 'missing')).toThrow('no longer exists')
    expect(both).toHaveLength(2)
  })

  it('starts empty only when no storage entry exists', () => {
    expect(loadConfigurationPresets(storage())).toEqual([])
    const local = storage()
    local.setItem(CONFIGURATION_PRESETS_STORAGE_KEY, '')
    expect(() => loadConfigurationPresets(local)).toThrow('invalid JSON')
  })

  it('does not overwrite corrupt JSON or unsupported storage formats', () => {
    const local = storage()
    local.setItem(CONFIGURATION_PRESETS_STORAGE_KEY, '{broken')
    expect(() => loadConfigurationPresets(local)).toThrow('not been overwritten')
    expect(local.getItem(CONFIGURATION_PRESETS_STORAGE_KEY)).toBe('{broken')
    for (const value of [null, [], {}, { version: 2, presets: [] }, { version: 1, presets: {} }]) {
      expect(() => parseConfigurationPresets(value)).toThrow('unsupported format')
    }
  })

  it('rejects missing/wrong source fields and non-boolean checkbox values', () => {
    const preset = saveConfigurationPreset([], 'One', settings, 'one')[0]
    for (const invalid of [
      { ...settings, useRegex: 'true' },
      { ...settings, ignoredKeyPatterns: null },
      { ...settings, baselineRequest: { ...settings.baselineRequest, environment: 'invalid' } },
      { ...settings, candidateRequest: { ...settings.candidateRequest, variant: 75 } },
      { ...settings, baselineRequest: {} },
    ]) {
      expect(() => parseConfigurationPresets({ version: 1, presets: [{ ...preset, settings: invalid }] })).toThrow()
    }
  })

  it('rejects empty names and duplicate stored IDs/names', () => {
    expect(() => saveConfigurationPreset([], '  ', settings, 'one')).toThrow('Enter a name')
    const preset = saveConfigurationPreset([], 'One', settings, 'one')[0]
    for (const duplicate of [
      { ...preset, name: 'Different' },
      { ...preset, id: 'other', name: ' one ' },
    ]) {
      expect(() => parseConfigurationPresets({ version: 1, presets: [preset, duplicate] })).toThrow('duplicate')
    }
  })

  it('reports blocked reads and writes, including quota failures', () => {
    const unavailable = {
      getItem: () => { throw new Error('Access denied') },
      setItem: () => { throw new Error('Quota exceeded') },
    }
    expect(() => loadConfigurationPresets(unavailable)).toThrow('Access denied')
    expect(() => writeConfigurationPresets(unavailable, saveConfigurationPreset([], 'One', settings, 'one')))
      .toThrow('Quota exceeded')
  })

  it('does not persist unknown fields or API results', () => {
    const preset = saveConfigurationPreset([], 'One', settings, 'one')[0]
    const [parsed] = parseConfigurationPresets({
      version: 1,
      presets: [{
        ...preset, results: { private: 'not a setting' },
        settings: {
          ...settings, results: [],
          baselineRequest: { ...settings.baselineRequest, extra: 'not a request field' },
        },
      }],
    })
    expect(parsed).toEqual(preset)
  })
})

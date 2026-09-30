import {
  APPLICATION_CONFIG_REQUEST_FIELDS,
  type ApplicationConfigRequest,
} from './applicationConfig'

export const CONFIGURATION_PRESETS_STORAGE_KEY = 'application-config.presets.v1'

export interface ConfigurationSettings {
  baselineRequest: ApplicationConfigRequest
  candidateRequest: ApplicationConfigRequest
  ignoredKeyPatterns: string
  useRegex: boolean
}

export interface ConfigurationPreset {
  id: string
  name: string
  settings: ConfigurationSettings
}

type PresetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequest(value: unknown): value is ApplicationConfigRequest {
  return isRecord(value) &&
    APPLICATION_CONFIG_REQUEST_FIELDS.every((field) => typeof value[field] === 'string') &&
    (value.environment === 'p' || value.environment === 's' || value.environment === 't')
}

function readRequest(value: unknown): ApplicationConfigRequest {
  if (!isRequest(value)) {
    throw new Error('A saved configuration contains invalid source fields.')
  }

  return {
    environment: value.environment,
    appVersion: value.appVersion,
    customer: value.customer,
    deploymentPhase: value.deploymentPhase,
    device: value.device,
    schemaVersion: value.schemaVersion,
    variant: value.variant,
  }
}

export function copyConfigurationSettings(settings: ConfigurationSettings): ConfigurationSettings {
  return {
    baselineRequest: { ...settings.baselineRequest },
    candidateRequest: { ...settings.candidateRequest },
    ignoredKeyPatterns: settings.ignoredKeyPatterns,
    useRegex: settings.useRegex,
  }
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

export function findConfigurationPreset(
  presets: ConfigurationPreset[],
  name: string,
): ConfigurationPreset | undefined {
  return presets.find((preset) => normalizedName(preset.name) === normalizedName(name))
}

export function parseConfigurationPresets(value: unknown): ConfigurationPreset[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.presets)) {
    throw new Error('Saved configurations have an invalid or unsupported format.')
  }

  const ids = new Set<string>()
  const names = new Set<string>()
  return value.presets.map((preset: unknown) => {
    if (
      !isRecord(preset) ||
      typeof preset.id !== 'string' || !preset.id.trim() ||
      typeof preset.name !== 'string' || !preset.name.trim() ||
      !isRecord(preset.settings) ||
      typeof preset.settings.ignoredKeyPatterns !== 'string' ||
      typeof preset.settings.useRegex !== 'boolean'
    ) {
      throw new Error('A saved configuration is incomplete or invalid.')
    }
    if (ids.has(preset.id) || names.has(normalizedName(preset.name))) {
      throw new Error('Saved configurations contain duplicate names or identifiers.')
    }
    ids.add(preset.id)
    names.add(normalizedName(preset.name))
    return {
      id: preset.id,
      name: preset.name.trim(),
      settings: {
        baselineRequest: readRequest(preset.settings.baselineRequest),
        candidateRequest: readRequest(preset.settings.candidateRequest),
        ignoredKeyPatterns: preset.settings.ignoredKeyPatterns,
        useRegex: preset.settings.useRegex,
      },
    }
  })
}

export function loadConfigurationPresets(storage: Pick<PresetStorage, 'getItem'>): ConfigurationPreset[] {
  const stored = storage.getItem(CONFIGURATION_PRESETS_STORAGE_KEY)
  if (stored === null) return []
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    throw new Error('Saved configurations contain invalid JSON. They have not been overwritten.')
  }
  return parseConfigurationPresets(value)
}

export function writeConfigurationPresets(
  storage: Pick<PresetStorage, 'setItem'>,
  presets: ConfigurationPreset[],
): void {
  const validated = parseConfigurationPresets({ version: 1, presets })
  storage.setItem(CONFIGURATION_PRESETS_STORAGE_KEY, JSON.stringify({ version: 1, presets: validated }))
}

export function saveConfigurationPreset(
  presets: ConfigurationPreset[],
  name: string,
  settings: ConfigurationSettings,
  newId: string,
): ConfigurationPreset[] {
  if (!name.trim()) throw new Error('Enter a name for this configuration.')
  const existing = findConfigurationPreset(presets, name)
  const preset = {
    id: existing?.id ?? newId,
    name: name.trim(),
    settings: copyConfigurationSettings(settings),
  }
  const next = existing
    ? presets.map((item) => item.id === existing.id ? preset : item)
    : [...presets, preset]
  return parseConfigurationPresets({ version: 1, presets: next })
}

export function deleteConfigurationPreset(
  presets: ConfigurationPreset[],
  id: string,
): ConfigurationPreset[] {
  if (!presets.some((preset) => preset.id === id)) {
    throw new Error('The selected saved configuration no longer exists.')
  }
  return presets.filter((preset) => preset.id !== id)
}

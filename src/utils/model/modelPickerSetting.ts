import { getSecuritySensitiveSetting } from '../settings/settings.js'

/**
 * densable 2.1.243 `pP` / `gP` / curated `/model` rows.
 * Honored from managed / --settings / user only (not project checkout);
 * first defined source wins outright — no merge across sources.
 */

export type ModelPickerRow = {
  model: string
  label?: string
  description?: string
}

export type ModelPickerSetting = {
  options: ModelPickerRow[]
  replaceBuiltInOptions?: boolean
}

export function getModelPickerSetting(): ModelPickerSetting | undefined {
  return getSecuritySensitiveSetting('modelPicker')[0]
}

/** densable `gP(e)` — curated label for an exact model id spelling. */
export function getModelPickerLabel(model: string): string | undefined {
  const trimmed = model.trim()
  const label = getModelPickerSetting()
    ?.options.find(row => row.model.trim() === trimmed)
    ?.label?.trim()
  return label === '' ? undefined : label
}

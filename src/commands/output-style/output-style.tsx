import type { LocalCommandCall } from '../../types/command.js'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  getAllOutputStyles,
} from '../../constants/outputStyles.js'
import { getCwd } from '../../utils/cwd.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import { escapeOutputStyleName } from '../../utils/xml.js'

const SAVE_FAILURE_OFF_BOX =
  "Couldn't save the output style (detail withheld on this connection)."
const CUSTOM_CURRENT_STYLE_PLACEHOLDER = 'a custom style'
const LOCAL_SETTINGS_DISABLED =
  'Cannot change output style because local settings are disabled.'

function currentOutputStyleName(): string {
  return getInitialSettings().outputStyle || DEFAULT_OUTPUT_STYLE_NAME
}

export const call: LocalCommandCall = async (args, context) => {
  const styles = await getAllOutputStyles(getCwd())
  const offBox = getIsNonInteractiveSession()
  const names = Object.keys(styles)
  const visible = offBox
    ? names.filter(name => styles[name]?.source !== 'plugin')
    : names
  const current = currentOutputStyleName()
  const trimmed = args.trim()
  const wanted = trimmed.toLowerCase()
  const match = trimmed
    ? visible.find(name => name.toLowerCase() === wanted)
    : undefined

  if (match === undefined) {
    if (
      trimmed &&
      !visible.some(name => name.toLowerCase() === wanted)
    ) {
      return {
        type: 'text',
        value: `Unknown output style "${escapeOutputStyleName(trimmed)}". Available styles: ${visible.map(escapeOutputStyleName).join(', ')}`,
      }
    }
    const lines = visible.map(name => {
      const description = styles[name]?.description
      const label = escapeOutputStyleName(name)
      const currentMark = name === current ? ' (current)' : ''
      return description
        ? `- ${label}${currentMark}: ${escapeOutputStyleName(description)}`
        : `- ${label}${currentMark}`
    })
    const shownCurrent =
      offBox && styles[current]?.source === 'plugin'
        ? CUSTOM_CURRENT_STYLE_PLACEHOLDER
        : escapeOutputStyleName(current)
    return {
      type: 'text',
      value: `Output style: ${shownCurrent}\n\nAvailable styles:\n${lines.join('\n')}\n\nUsage: /output-style <style>`,
    }
  }

  if (match === current) {
    return {
      type: 'text',
      value: `Output style is already ${escapeOutputStyleName(match)}`,
    }
  }

  if (!isSettingSourceEnabled('localSettings')) {
    return { type: 'text', value: LOCAL_SETTINGS_DISABLED }
  }

  const saved = updateSettingsForSource(
    'localSettings',
    { outputStyle: match },
    context.storageV5,
  )
  if (saved.error) {
    return {
      type: 'text',
      value: getIsNonInteractiveSession()
        ? SAVE_FAILURE_OFF_BOX
        : `Could not save output style: ${saved.error.message}`,
    }
  }

  logEvent('tengu_output_style_changed', {
    style: match as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source:
      'slash_command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    settings_source:
      'localSettings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return {
    type: 'text',
    value: `Output style set to ${escapeOutputStyleName(match)}`,
  }
}

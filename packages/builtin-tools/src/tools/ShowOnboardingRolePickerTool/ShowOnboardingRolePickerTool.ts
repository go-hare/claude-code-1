/**
 * Official 2.1.331 ShowOnboardingRolePickerTool (chunk #648).
 *
 * Renders a clickable role-picker chip row during Cowork guided onboarding.
 * Call with no arguments `{}`; the host UI populates `role` or `dismissed`
 * via `updatedInput`.
 */

import { z } from 'zod/v4'
import {
  buildTool,
  type ToolDef,
  type ToolDeps,
  type ToolResultBlockParam,
} from 'src/Tool.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getBootstrapSessionHost, HostSlot } from 'src/utils/sessionHost.js'

export const SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME = 'ShowOnboardingRolePicker'

const SHOW_ONBOARDING_ROLE_PICKER_DESCRIPTION =
  'Render a clickable role-picker chip row for the user to select their work role during onboarding.'

const SHOW_ONBOARDING_ROLE_PICKER_PROMPT = [
  'Call with no arguments (`{}`) to render a clickable role-picker chip row in the host UI. Do not list the roles in prose yourself.',
  'Three resolution paths all land in the tool result: chip click or free-form typed answer -> {"role": "Legal"}; X button -> {"dismissed": true}. An empty object {} means the user approved without picking a role.',
].join('\n\n')

const onboardingRolePickerEnabledByHost = new HostSlot<{ enabled: boolean }>(
  () => ({ enabled: false }),
)

export function isOnboardingRolePickerEnabled(
  host: object = getBootstrapSessionHost(),
): boolean {
  return (
    (onboardingRolePickerEnabledByHost.peek(host)?.enabled ?? false) ||
    isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_ONBOARDING_ROLE_PICKER)
  )
}

export function setOnboardingRolePickerEnabled(
  enabled: boolean,
  host: object = getBootstrapSessionHost(),
): void {
  onboardingRolePickerEnabledByHost.of(host).enabled = enabled
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    role: z
      .string()
      .optional()
      .describe('Populated by the host role-picker UI via updatedInput'),
    dismissed: z
      .boolean()
      .optional()
      .describe(
        'Set to true by the host UI when the user dismisses the role picker',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type ShowOnboardingRolePickerInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    role: z.string().optional(),
    dismissed: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ShowOnboardingRolePickerOutput = z.infer<OutputSchema>

export const ShowOnboardingRolePickerTool = buildTool({
  name: SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME,
  maxResultSizeChars: 10_000,
  shouldDefer: false,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  async description(
    _input?: ShowOnboardingRolePickerInput,
    _options?: unknown,
  ) {
    return SHOW_ONBOARDING_ROLE_PICKER_DESCRIPTION
  },
  async prompt(_options?: unknown) {
    return SHOW_ONBOARDING_ROLE_PICKER_PROMPT
  },

  userFacingName() {
    return SHOW_ONBOARDING_ROLE_PICKER_TOOL_NAME
  },

  isEnabled() {
    return isOnboardingRolePickerEnabled()
  },

  isReadOnly(_input?: ShowOnboardingRolePickerInput) {
    return true
  },
  isConcurrencySafe(_input?: ShowOnboardingRolePickerInput) {
    return false
  },
  requiresUserInteraction() {
    return true
  },

  toAutoClassifierInput() {
    return ''
  },

  renderToolUseMessage() {
    return null
  },

  mapToolResultToToolResultBlockParam(
    output: ShowOnboardingRolePickerOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: JSON.stringify(output),
    }
  },

  create(_deps: ToolDeps) {
    return {
      async validateInput(input: ShowOnboardingRolePickerInput) {
        if (input.role !== undefined || input.dismissed !== undefined) {
          return {
            result: false as const,
            message:
              'ShowOnboardingRolePicker must be called with no arguments (`{}`); `role` and `dismissed` are populated only by the host UI.',
            errorCode: 1,
          }
        }
        return { result: true as const }
      },

      async checkPermissions(_input: ShowOnboardingRolePickerInput) {
        return {
          behavior: 'ask' as const,
          message:
            'Render the clickable onboarding role-picker chip row for the user.',
          updatedInput: {},
        }
      },

      async call(input: ShowOnboardingRolePickerInput) {
        const trimmedRole = input.role?.trim()
        if (trimmedRole) {
          return { data: { role: trimmedRole } }
        }
        if (input.dismissed === true) {
          return { data: { dismissed: true } }
        }
        return { data: {} }
      },
    }
  },
} satisfies ToolDef<InputSchema, ShowOnboardingRolePickerOutput>)

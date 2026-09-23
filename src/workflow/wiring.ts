import {
  createWorkflowTool,
  workflowInputSchema,
  WORKFLOW_TOOL_NAME,
  type WorkflowToolDescriptor,
} from '@claude-code/workflow-engine'
import { buildTool, type Tool } from '../Tool.js'
import { isWorkflowsDisabled } from '../utils/workflowDisableGate.js'
import { formatWorkflowSizeGuidelineToolSuffix } from '../utils/workflowSizeGuideline.js'
import { getGlobalConfig } from '../utils/config.js'
import { getWorkflowService } from './service.js'
import { workflowReadableRoots } from './readableRoots.js'

/**
 * densable dLs(xt().workflowSizeGuideline) — session /config value with
 * settings-file precedence inside resolveSessionWorkflowSizeGuideline.
 */
function getWorkflowSizeGuidelineToolSuffix(): string {
  try {
    return formatWorkflowSizeGuidelineToolSuffix(
      getGlobalConfig().workflowSizeGuideline,
    )
  } catch {
    return formatWorkflowSizeGuidelineToolSuffix(undefined)
  }
}

/**
 * Adapts the engine's self-contained descriptor into a buildTool-compatible Tool.
 * The descriptor routes through the service singleton (sharing ports/registry/store).
 *
 * ports resolution is deferred to the first real method call (lazy): tools.ts calls
 * createWorkflowToolCore() during module-load (feature-gated), and resolving ports
 * immediately would trigger service instantiation, which in turn calls module-level
 * side effects like getProjectRoot — yielding wrong paths before bootstrap completes.
 * The Tool object itself is a singleton via createWorkflowToolCore's cached (PermissionRequest
 * matches by reference), and the ports singleton is guaranteed by getWorkflowService.
 */
function buildWorkflowTool(): Tool {
  let cachedDescriptor: WorkflowToolDescriptor | null = null
  const descriptor = (): WorkflowToolDescriptor => {
    if (!cachedDescriptor) {
      const { ports } = getWorkflowService()
      cachedDescriptor = createWorkflowTool(ports)
    }
    return cachedDescriptor
  }
  return buildTool({
    name: WORKFLOW_TOOL_NAME,
    // densable 2.1.248 #1 Unt — official enablesCodeExecution:!0 @196825547
    enablesCodeExecution: true,
    maxResultSizeChars: 50_000,
    inputSchema: workflowInputSchema,
    isEnabled: () => {
      // Official o5t/peh densable — env/settings disable; enableWorkflows opt-out.
      try {
        const { getInitialSettings } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../utils/settings/settings.js') as typeof import('../utils/settings/settings.js')
        const { resolveEnableWorkflowsSetting } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
        const settings = getInitialSettings()
        if (
          isWorkflowsDisabled(process.env, {
            settingsDisableWorkflows: settings.disableWorkflows,
          })
        ) {
          return false
        }
        // peh: explicit enableWorkflows=false forces off when feature available.
        const enable = resolveEnableWorkflowsSetting(settings.enableWorkflows)
        if (enable === false) return false
        return descriptor().isEnabled()
      } catch {
        return !isWorkflowsDisabled() && descriptor().isEnabled()
      }
    },
    isReadOnly: input => descriptor().isReadOnly(input),
    isConcurrencySafe: () => true,
    async description() {
      // densable 2.1.219 #21: lLs + dLs(workflowSizeGuideline)
      const base = await descriptor().description()
      return base + getWorkflowSizeGuidelineToolSuffix()
    },
    async prompt() {
      // densable 2.1.219 #21: lLs + dLs(workflowSizeGuideline)
      const base = await descriptor().prompt()
      return base + getWorkflowSizeGuidelineToolSuffix()
    },
    async call(input, context, canUseTool, parentMessage, onProgress) {
      const result = await descriptor().call(
        input,
        context,
        canUseTool,
        parentMessage,
        onProgress,
      )
      return { data: result.data }
    },
    renderToolUseMessage: input => descriptor().renderToolUseMessage(input),
    async validateInput(input) {
      const scriptPath = input.scriptPath
      if (typeof scriptPath !== 'string' || scriptPath.length === 0) {
        return { result: true }
      }
      const { getProjectRoot } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      const {
        workflowScriptPathIsReadable,
        workflowScriptReadRefusal,
        isForbiddenWorkflowScriptPath,
      } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@claude-code/workflow-engine') as typeof import('@claude-code/workflow-engine')
      const { resolve } = await import('node:path')
      const cwd = getProjectRoot()
      let resolved = scriptPath
      try {
        resolved = resolve(cwd, scriptPath)
      } catch {
        return {
          result: false,
          message: workflowScriptReadRefusal(scriptPath),
          errorCode: 1,
        }
      }
      if (
        isForbiddenWorkflowScriptPath(scriptPath) ||
        isForbiddenWorkflowScriptPath(resolved)
      ) {
        return {
          result: false,
          message: `Network (UNC, NT-namespace, or automount) paths are not allowed for workflow scriptPath: ${scriptPath}`,
          errorCode: 1,
        }
      }
      if (
        !workflowScriptPathIsReadable(scriptPath, cwd, workflowReadableRoots())
      ) {
        return {
          result: false,
          message: workflowScriptReadRefusal(scriptPath),
          errorCode: 1,
        }
      }
      return { result: true }
    },
    async checkPermissions(input) {
      const scriptPath = input.scriptPath
      if (typeof scriptPath !== 'string' || scriptPath.length === 0) {
        return { behavior: 'allow', updatedInput: input }
      }
      const { getProjectRoot } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      const {
        workflowScriptPathIsReadable,
        WORKFLOW_SCRIPT_OUTSIDE_READABLE_SET,
      } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@claude-code/workflow-engine') as typeof import('@claude-code/workflow-engine')
      if (
        !workflowScriptPathIsReadable(
          scriptPath,
          getProjectRoot(),
          workflowReadableRoots(),
        )
      ) {
        return {
          behavior: 'deny',
          message: WORKFLOW_SCRIPT_OUTSIDE_READABLE_SET,
          decisionReason: {
            type: 'other',
            reason: WORKFLOW_SCRIPT_OUTSIDE_READABLE_SET,
          },
        }
      }
      return { behavior: 'allow', updatedInput: input }
    },
    mapToolResultToToolResultBlockParam: (data, toolUseId) =>
      descriptor().mapToolResultToToolResultBlockParam(data, toolUseId),
  })
}

// Singleton: tools.ts registration and PermissionRequest must reference the same instance (switch matches by reference).
let cached: Tool | null = null

export function createWorkflowToolCore(): Tool {
  if (!cached) cached = buildWorkflowTool()
  return cached
}

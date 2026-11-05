/**
 * Built-in Plugin Initialization
 *
 * densable wCe: sec-default / agents-md / telemetry always; plugin-authoring /
 * mods-guide / you-should-know skip local-agent; tips / mermaid / responsive /
 * diff / claude-test skip local-agent and Sno() (remote*).
 */

import {
  isBuiltinPluginsInitialized,
  markBuiltinPluginsInitialized,
  registerBuiltinPluginModule,
} from '../builtinPlugins.js'
import {
  AGENTS_MD_PLUGIN_NAME,
  registerAgentsMdBuiltinPlugin,
} from './agentsMd.js'
import {
  CLAUDE_TEST_PLUGIN_NAME,
  registerClaudeTestBuiltinPlugin,
} from './claudeTest.js'
import { DIFF_PLUGIN_NAME, registerDiffBuiltinPlugin } from './diff.js'
import { MERMAID_PLUGIN_NAME, registerMermaidBuiltinPlugin } from './mermaid.js'
import {
  MODS_GUIDE_PLUGIN_NAME,
  registerModsGuideBuiltinPlugin,
} from './modsGuide.js'
import {
  PLUGIN_AUTHORING_PLUGIN_NAME,
  registerPluginAuthoringBuiltinPlugin,
} from './pluginAuthoring.js'
import {
  RESPONSIVE_MODE_PLUGIN_NAME,
  registerResponsiveModeBuiltinPlugin,
} from './responsiveMode.js'
import {
  SEC_DEFAULT_PLUGIN_NAME,
  registerSecDefaultBuiltinPlugin,
} from './secDefault.js'
import {
  TELEMETRY_PLUGIN_NAME,
  registerTelemetryBuiltinPlugin,
} from './telemetry.js'
import { TIPS_PLUGIN_NAME, registerTipsBuiltinPlugin } from './tips.js'
import { registerWeixinBuiltinPlugin } from './weixin.js'
import {
  YOU_SHOULD_KNOW_PLUGIN_NAME,
  registerYouShouldKnowBuiltinPlugin,
} from './youShouldKnow.js'

/** densable Sno — ENTRYPOINT starts with remote. Never export minify `Sno`. */
function leftoverSno(): boolean {
  return process.env.CLAUDE_CODE_ENTRYPOINT?.startsWith('remote') === true
}

/**
 * Initialize built-in plugins (`wCe` + `yfe`). Called during CLI startup.
 */
export function initBuiltinPlugins(): void {
  if (isBuiltinPluginsInitialized()) return
  markBuiltinPluginsInitialized()
  registerBuiltinPluginModule(SEC_DEFAULT_PLUGIN_NAME, () => ({
    registerPlugin: registerSecDefaultBuiltinPlugin,
  }))
  registerBuiltinPluginModule(AGENTS_MD_PLUGIN_NAME, () => ({
    registerPlugin: registerAgentsMdBuiltinPlugin,
  }))
  registerBuiltinPluginModule(TELEMETRY_PLUGIN_NAME, () => ({
    registerPlugin: registerTelemetryBuiltinPlugin,
  }))
  registerWeixinBuiltinPlugin()
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') return
  registerBuiltinPluginModule(PLUGIN_AUTHORING_PLUGIN_NAME, () => ({
    registerPlugin: registerPluginAuthoringBuiltinPlugin,
  }))
  registerBuiltinPluginModule(MODS_GUIDE_PLUGIN_NAME, () => ({
    registerPlugin: registerModsGuideBuiltinPlugin,
  }))
  const offerRemoteOff = !leftoverSno()
  if (offerRemoteOff) {
    registerBuiltinPluginModule(TIPS_PLUGIN_NAME, () => ({
      registerPlugin: registerTipsBuiltinPlugin,
    }))
    registerBuiltinPluginModule(MERMAID_PLUGIN_NAME, () => ({
      registerPlugin: registerMermaidBuiltinPlugin,
    }))
  }
  if (offerRemoteOff) {
    registerBuiltinPluginModule(RESPONSIVE_MODE_PLUGIN_NAME, () => ({
      registerPlugin: registerResponsiveModeBuiltinPlugin,
    }))
    registerBuiltinPluginModule(DIFF_PLUGIN_NAME, () => ({
      registerPlugin: registerDiffBuiltinPlugin,
    }))
  }
  registerBuiltinPluginModule(YOU_SHOULD_KNOW_PLUGIN_NAME, () => ({
    registerPlugin: registerYouShouldKnowBuiltinPlugin,
  }))
  if (offerRemoteOff) {
    registerBuiltinPluginModule(CLAUDE_TEST_PLUGIN_NAME, () => ({
      registerPlugin: registerClaudeTestBuiltinPlugin,
    }))
  }
}

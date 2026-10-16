/**
 * Gold 2.1.289 SKILL.md peeled from bunfs zstd — inlined as strings.
 * Loaded into memory on invoke (parseFrontmatter + optional files extract).
 * Not written at CLI boot.
 */
import pluginAuthoringMd from './plugin-authoring/SKILL.md' with {
  type: 'text',
}
import pluginAuthoringLongForm from './plugin-authoring/function-hooks-long-form.md' with {
  type: 'text',
}
import pluginAuthoringPane from './plugin-authoring/examples/pane.tsx.txt' with {
  type: 'text',
}
import pluginAuthoringPaneState from './plugin-authoring/examples/pane-state.d.ts.txt' with {
  type: 'text',
}
import pluginAuthoringBand from './plugin-authoring/examples/band.tsx.txt' with {
  type: 'text',
}
import pluginAuthoringBandState from './plugin-authoring/examples/band-state.d.ts.txt' with {
  type: 'text',
}
import pluginAuthoringToolCall from './plugin-authoring/examples/tool-call.ts.txt' with {
  type: 'text',
}
import pluginAuthoringReference from './plugin-authoring/reference.md' with {
  type: 'text',
}
import pluginAuthoringTypes from './plugin-authoring/types/claude-code.d.ts.txt' with {
  type: 'text',
}
import artifactDesignMd from './artifact-design/SKILL.md' with { type: 'text' }
import artifactDiagrammingMd from './artifact-diagramming/SKILL.md' with {
  type: 'text',
}
import artifactComponentsMd from './artifact-components/SKILL.md' with {
  type: 'text',
}
import artifactPrReviewMd from './artifact-pr-review/SKILL.md' with {
  type: 'text',
}
import artifactPrReviewComposedMd from './artifact-pr-review/SKILL-composed.md' with {
  type: 'text',
}
import workshopMd from './workshop/SKILL.md' with { type: 'text' }
import whiteboardMd from './whiteboard/SKILL.md' with { type: 'text' }
import whiteboardLiveMd from './whiteboard/SKILL-live.md' with { type: 'text' }
import prototypeMd from './prototype/SKILL.md' with { type: 'text' }
import designSyncMd from './design-sync/SKILL.md' with { type: 'text' }
import designSyncPackage from './design-sync/package-source.md' with {
  type: 'text',
}
import designSyncStorybook from './design-sync/storybook-source.md' with {
  type: 'text',
}
import runMd from './run/SKILL.md' with { type: 'text' }
import runElectronMd from './run/examples/electron.md' with { type: 'text' }
import runSkillGeneratorMd from './run-skill-generator/SKILL.md' with {
  type: 'text',
}
import coworkPluginMd from './cowork-plugin/SKILL.md' with { type: 'text' }
import setupCoworkMd from './setup-claude/SETUP_COWORK_PROMPT.md' with {
  type: 'text',
}

export const PLUGIN_AUTHORING_MD = pluginAuthoringMd
export const PLUGIN_AUTHORING_FILES: Record<string, string> = {
  'function-hooks-long-form.md': pluginAuthoringLongForm,
  'examples/pane.tsx': pluginAuthoringPane,
  'examples/pane-state.d.ts': pluginAuthoringPaneState,
  'examples/band.tsx': pluginAuthoringBand,
  'examples/band-state.d.ts': pluginAuthoringBandState,
  'examples/tool-call.ts': pluginAuthoringToolCall,
  'reference.md': pluginAuthoringReference,
  'types/claude-code.d.ts': pluginAuthoringTypes,
}

export const ARTIFACT_DESIGN_MD = artifactDesignMd
export const ARTIFACT_DIAGRAMMING_MD = artifactDiagrammingMd
export const ARTIFACT_COMPONENTS_MD = artifactComponentsMd
export const ARTIFACT_PR_REVIEW_MD = artifactPrReviewMd
export const ARTIFACT_PR_REVIEW_COMPOSED_MD = artifactPrReviewComposedMd
export const WORKSHOP_MD = workshopMd
export const WHITEBOARD_MD = whiteboardMd
export const WHITEBOARD_LIVE_MD = whiteboardLiveMd
export const PROTOTYPE_MD = prototypeMd
export const DESIGN_SYNC_MD = designSyncMd
export const DESIGN_SYNC_FILES: Record<string, string> = {
  'package-source.md': designSyncPackage,
  'storybook-source.md': designSyncStorybook,
}
export const RUN_MD = runMd
export const RUN_FILES: Record<string, string> = {
  'examples/electron.md': runElectronMd,
}
export const RUN_SKILL_GENERATOR_MD = runSkillGeneratorMd
export const SETUP_COWORK_PROMPT_MD = setupCoworkMd
export const COWORK_PLUGIN_MD = coworkPluginMd

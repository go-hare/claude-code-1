/**
 * Official 2.1.208 dataviz skill content (ported from binary).
 * Each asset is inlined as a string via Bun's text loader.
 */

import skillMd from './datavizContent/SKILL.md' with { type: 'text' }
import antiPatterns from './datavizContent/references/anti-patterns.md' with {
  type: 'text',
}
import choosingAForm from './datavizContent/references/choosing-a-form.md' with {
  type: 'text',
}
import colorFormula from './datavizContent/references/color-formula.md' with {
  type: 'text',
}
import components from './datavizContent/references/components.md' with {
  type: 'text',
}
import interaction from './datavizContent/references/interaction.md' with {
  type: 'text',
}
import marksAndAnatomy from './datavizContent/references/marks-and-anatomy.md' with {
  type: 'text',
}
import palette from './datavizContent/references/palette.md' with {
  type: 'text',
}
// Stored as .txt so Bun/tsc load them as strings; extracted as .js/.py.
import validatePaletteJs from './datavizContent/scripts/validate_palette.js.txt'
import validatePalettePy from './datavizContent/scripts/validate_palette.py.txt'

export const DATAVIZ_SKILL_NAME = 'dataviz'

/** Official menuDescription string (not a separate field in fork registry). */
export const DATAVIZ_MENU_DESCRIPTION = 'Chart and dashboard design guidance'

/**
 * Official pIb — long description used for skill discovery / Skill tool.
 */
export const DATAVIZ_SKILL_DESCRIPTION =
  'Use this skill whenever you are about to create ANY chart, graph, plot, dashboard, or data visualization, in ANY output medium — an HTML or React artifact, inline SVG, plotting code in any library (matplotlib, plotly, d3, Recharts, …), an image/PNG you will render and upload, or a chart shared into Slack. Read it BEFORE writing the first line of chart code, choosing chart colors, building a stat tile / meter / KPI row, or laying out a dashboard. Produces visualizations that read as one system — elegant, accessible, consistent in light and dark — using a brand-neutral placeholder palette you swap for your own. Teaches a design-system-agnostic method: a form heuristic, a color formula with a runnable validator, mark specs, and interaction rules. A validated default palette is documented in `references/palette.md` — swap that file\'s values for your brand\'s. Triggers on: "chart", "graph", "plot", "data viz", "visualization", "dashboard", "analytics", "visualize data", "categorical colors", "sequential / diverging palette", "stat tile", "sparkline", "heatmap", "legend", "axis", "tooltip", "chart colors", "color by series".'

export const SKILL_MD: string = skillMd

export const SKILL_FILES: Record<string, string> = {
  'references/anti-patterns.md': antiPatterns,
  'references/choosing-a-form.md': choosingAForm,
  'references/color-formula.md': colorFormula,
  'references/components.md': components,
  'references/interaction.md': interaction,
  'references/marks-and-anatomy.md': marksAndAnatomy,
  'references/palette.md': palette,
  'scripts/validate_palette.js': validatePaletteJs,
  'scripts/validate_palette.py': validatePalettePy,
}

import { describe, expect, test } from 'bun:test'
import { inputSchema } from '../artifactInputSchemas.js'

describe('ArtifactTool intent schema description (#1280)', () => {
  test('distinguishes document (keep editing / pass around) from other (explainers / visual / interactive)', () => {
    const schema = inputSchema()
    const intentDesc = schema.shape.intent.description
    expect(intentDesc).toContain(
      "'document' (writing people will keep editing or pass around as text, such as a memo, plan, spec, proposal or notes)",
    )
    expect(intentDesc).toContain(
      "'other' (a page to look at or use: an explainer, a diagram, anything interactive, a dashboard that shows data, a spreadsheet, anything else, or unsure)",
    )
  })
})

import { describe, expect, test } from 'bun:test'
import {
  HEARTH_RC_CHILD_TAG,
  parseSessionOriginRoles,
  RC_CHILD_TAG,
  REMOTE_CONTROL_APP_TAG,
  REMOTE_CONTROL_CLI_TAG,
  WORKFLOW_REMOTE_AGENT_TAG,
} from '../sessionOriginTags.js'

describe('densable 2.1.289 t3e parseSessionOriginRoles', () => {
  test('null → unread', () => {
    expect(parseSessionOriginRoles(null)).toEqual({
      tagsRead: false,
      rcChild: false,
      projectThreadChild: false,
      attended: false,
    })
  })

  test('rc-child wins over attended', () => {
    expect(
      parseSessionOriginRoles([RC_CHILD_TAG, REMOTE_CONTROL_CLI_TAG]),
    ).toEqual({
      tagsRead: true,
      rcChild: true,
      projectThreadChild: false,
      attended: false,
    })
  })

  test('hearth-rc-child → projectThreadChild (attended stays false in t3e)', () => {
    // gold t3e: attended only from Ahn/G2o; RQt later ORs projectThreadChild.
    expect(parseSessionOriginRoles([HEARTH_RC_CHILD_TAG])).toEqual({
      tagsRead: true,
      rcChild: false,
      projectThreadChild: true,
      attended: false,
    })
  })

  test('app/cli attended unless workflow-remote-agent', () => {
    expect(parseSessionOriginRoles([REMOTE_CONTROL_APP_TAG])).toMatchObject({
      attended: true,
      rcChild: false,
    })
    expect(
      parseSessionOriginRoles([
        REMOTE_CONTROL_CLI_TAG,
        WORKFLOW_REMOTE_AGENT_TAG,
      ]),
    ).toMatchObject({ attended: false })
  })
})

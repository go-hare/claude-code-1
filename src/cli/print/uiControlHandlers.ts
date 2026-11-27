/**
 * Headless streaming remote UI surface control request handlers (ui_attach, ui_render, ui_press, etc.).
 */
import type {
  ControlRequestDispatchContext,
  HeadlessStreamingContext,
} from './streamingTypes.js'
import { errorMessage } from '../../utils/errors.js'
import {
  parseUiAttachControlRequest,
  attachRemoteUiSurface,
  listDrawingSurfaces,
  parseUiDetachControlRequest,
  listSurfaceViewportClients,
  detachRemoteUiSurface,
  parseUiRenderControlRequest,
  defaultClientIdForSurface,
  parseUiPressControlRequest,
  UI_PRESS_PARSE_ERROR,
  parseUiInputControlRequest,
  UI_INPUT_PARSE_ERROR,
  parseUiPromptEditControlRequest,
  UI_PROMPT_EDIT_PARSE_ERROR,
  parseUiSelectControlRequest,
  UI_SELECT_PARSE_ERROR,
  parseUiPanesControlRequest,
  UI_PANES_PARSE_ERROR,
  parseUiPaneShowControlRequest,
  UI_PANE_SHOW_PARSE_ERROR,
  parseUiPaneFocusControlRequest,
  UI_PANE_FOCUS_PARSE_ERROR,
  parseUiCloseControlRequest,
  UI_CLOSE_PARSE_ERROR,
  parseUiScrollControlRequest,
  UI_SCROLL_PARSE_ERROR,
  parseUiFocusControlRequest,
  UI_FOCUS_PARSE_ERROR,
  parseUiClientModuleControlRequest,
  UI_CLIENT_MODULE_PARSE_ERROR,
  uiClientModuleMissingError,
  parseUiClientPressControlRequest,
  UI_CLIENT_PRESS_PARSE_ERROR,
  parseUiMessageControlRequest,
  UI_MESSAGE_PARSE_ERROR,
  parseUiClientFaultControlRequest,
} from 'src/utils/plugins/surfaceViewportClients.js'
import { logForDebugging } from 'src/utils/debug.js'

const isMissingPressHandler = (err: unknown): boolean =>
  errorMessage(err).includes('no handler is held under handle')

const pressControlResponse = (
  ue: unknown,
  withValue: boolean,
): Record<string, unknown> => {
  if (ue === undefined) return { handled: false }
  const rec = ue as { element?: unknown; value?: unknown }
  return withValue
    ? { handled: true, element: rec.element, value: rec.value }
    : { handled: true, element: rec.element }
}

export async function handleUiControlRequest(
  streamCtx: HeadlessStreamingContext,
  ctrlDispatch: ControlRequestDispatchContext,
): Promise<boolean> {
  const { msg, req, deferControlLifecycleUntilDone } = ctrlDispatch
  if (req.subtype === 'ui_attach') {
    // densable `jAn` + `Fco` @205787852 / handler @206547763.
    // Overlay footer is Desktop-only — this is the CLI control host.
    const parsed = parseUiAttachControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, parsed.error)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const pending = attachRemoteUiSurface(
            {
              surface: parsed.surface,
              clientId: parsed.clientId,
              ...(parsed.viewport !== undefined && {
                viewport: parsed.viewport,
              }),
            },
            parsed.answers,
          )
          streamCtx.sendControlResponseSuccess(msg, {
            surfaces: [...listDrawingSurfaces()],
          })
          await pending
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_detach') {
    // densable `WAn` + `U9t` @205788154 / handler @206548411.
    const parsed = parseUiDetachControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, parsed.error)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const wasAttached = listSurfaceViewportClients().some(
            client => client.clientId === parsed.clientId,
          )
          const pending = detachRemoteUiSurface(parsed.clientId, 'detach')
          streamCtx.sendControlResponseSuccess(msg, {
            detached: wasAttached,
            surfaces: [...listDrawingSurfaces()],
          })
          await pending
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_render') {
    // densable `GAn` + `E1e.run` @206548504. Overlay footer is
    // Desktop-only — this is the CLI control host.
    const parsed = parseUiRenderControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, parsed.error)
    } else {
      const benchKey = `${parsed.instanceId}#${parsed.bench?.seq ?? 0}`
      logForDebugging(
        `BENCH ui_render key=${benchKey} rid=${msg.request_id} C0=${Date.now()}`,
      )
      deferControlLifecycleUntilDone(async () => {
        try {
          const clientId =
            parsed.clientId ?? defaultClientIdForSurface(parsed.surface)
          void attachRemoteUiSurface({
            surface: parsed.surface,
            clientId,
            ...(parsed.viewport !== undefined && {
              viewport: parsed.viewport,
            }),
          })
          const { evaluateUiRender } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const tree = await evaluateUiRender({
            component: parsed.component,
            requestId: parsed.instanceId,
            surface: parsed.surface,
            props: parsed.props,
            ...(parsed.viewport !== undefined && {
              viewport: parsed.viewport,
            }),
          })
          streamCtx.sendControlResponseSuccess(msg, { tree })
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_press') {
    // densable `zAn` + `E1e.press` @206550686. Overlay footer is
    // Desktop-only — this is the CLI control host. Missing press
    // site answers `{handled: false}` (gold `ue===void 0`).
    const parsed = parseUiPressControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_PRESS_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { invokePress } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const ue = await invokePress(parsed.plugin, parsed.handle, {
            surface: parsed.surface,
            ...(parsed.key !== undefined && {
              key: parsed.key,
              element: parsed.key,
            }),
            ...(parsed.href !== undefined && {
              href: parsed.href,
              link: { href: parsed.href },
            }),
          })
          streamCtx.sendControlResponseSuccess(
            msg,
            pressControlResponse(ue, false),
          )
        } catch (err) {
          if (isMissingPressHandler(err)) {
            streamCtx.sendControlResponseSuccess(msg, { handled: false })
          } else {
            streamCtx.sendControlResponseError(msg, errorMessage(err))
          }
        }
      })
    }
  } else if (req.subtype === 'ui_input') {
    // densable `XAn` + `E1e.input` @206551269.
    const parsed = parseUiInputControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_INPUT_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { invokePress } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const ue = await invokePress(parsed.plugin, parsed.handle, {
            surface: parsed.surface,
            kind: parsed.kind,
            value: parsed.value,
            ...(parsed.key !== undefined && {
              key: parsed.key,
              element: parsed.key,
            }),
            ...(parsed.component !== undefined && {
              component: parsed.component,
            }),
            ...(parsed.instanceId !== undefined && {
              requestId: parsed.instanceId,
            }),
          })
          streamCtx.sendControlResponseSuccess(
            msg,
            pressControlResponse(ue, true),
          )
        } catch (err) {
          if (isMissingPressHandler(err)) {
            streamCtx.sendControlResponseSuccess(msg, { handled: false })
          } else {
            streamCtx.sendControlResponseError(msg, errorMessage(err))
          }
        }
      })
    }
  } else if (req.subtype === 'ui_prompt_edit') {
    // densable `okn` + `rp.edit`/`rp.adopt` @206552047. Print has no
    // composer box; still parse and dispatch `prompt.edit`.
    const parsed = parseUiPromptEditControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_PROMPT_EDIT_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const clientId =
            parsed.clientId ?? defaultClientIdForSurface(parsed.surface)
          const box = { text: parsed.text, cursor: parsed.cursor }
          const { runFunctionHookChain } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const ve = await runFunctionHookChain(
            'prompt.edit',
            {
              origin: parsed.by === 'app' ? 'app' : 'typed',
              text: box.text,
              cursor: box.cursor,
              clientKey: clientId,
              ...(parsed.key !== undefined && { key: parsed.key }),
            },
            async () => box,
          )
          streamCtx.sendControlResponseSuccess(
            msg,
            ve !== null && typeof ve === 'object' && !Array.isArray(ve)
              ? { ...(ve as Record<string, unknown>) }
              : { ...box },
          )
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_select') {
    // densable `JAn` + `E1e.select` @206552765.
    const parsed = parseUiSelectControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_SELECT_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { invokePress } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const ue = await invokePress(parsed.plugin, parsed.handle, {
            surface: parsed.surface,
            value: parsed.value,
            ...(parsed.key !== undefined && {
              key: parsed.key,
              element: parsed.key,
            }),
            ...(parsed.component !== undefined && {
              component: parsed.component,
            }),
            ...(parsed.instanceId !== undefined && {
              requestId: parsed.instanceId,
            }),
          })
          streamCtx.sendControlResponseSuccess(
            msg,
            pressControlResponse(ue, true),
          )
        } catch (err) {
          if (isMissingPressHandler(err)) {
            streamCtx.sendControlResponseSuccess(msg, { handled: false })
          } else {
            streamCtx.sendControlResponseError(msg, errorMessage(err))
          }
        }
      })
    }
  } else if (req.subtype === 'ui_panes') {
    // densable `QAn` + `ck(wd(Si()))` @206553490.
    const parsed = parseUiPanesControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_PANES_PARSE_ERROR)
    } else {
      try {
        const { wirePanesState } = await import(
          'src/utils/plugins/functionHooksModules.js'
        )
        streamCtx.sendControlResponseSuccess(msg, wirePanesState())
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    }
  } else if (req.subtype === 'ui_pane_show') {
    // densable `ZAn` + `l4n` @206553804.
    const parsed = parseUiPaneShowControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_PANE_SHOW_PARSE_ERROR)
    } else {
      try {
        const { getPanesState, showPane, syncRemotePaneKeyboard } =
          await import('src/utils/plugins/functionHooksModules.js')
        const before = getPanesState().focusedId
        showPane(parsed.id)
        if (getPanesState().focusedId !== before) {
          syncRemotePaneKeyboard(
            parsed.clientId ?? defaultClientIdForSurface(parsed.surface),
          )
        }
        streamCtx.sendControlResponseSuccess(msg, {
          shown_id: getPanesState().shownId,
        })
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    }
  } else if (req.subtype === 'ui_pane_focus') {
    // densable `ekn` + `u3` + `XS` @206554175.
    const parsed = parseUiPaneFocusControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_PANE_FOCUS_PARSE_ERROR)
    } else {
      try {
        const { focusPane, getPanesState, syncRemotePaneKeyboard } =
          await import('src/utils/plugins/functionHooksModules.js')
        focusPane(parsed.id)
        syncRemotePaneKeyboard(
          parsed.clientId ?? defaultClientIdForSurface(parsed.surface),
        )
        streamCtx.sendControlResponseSuccess(msg, {
          focused_id: getPanesState().focusedId,
        })
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    }
  } else if (req.subtype === 'ui_close') {
    // densable `tkn` + `l8e` @206554541. Missing id → {closed:true}.
    const parsed = parseUiCloseControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_CLOSE_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { closePluginPane, panesIncludingUnplaced } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const stillOpen = (): boolean =>
            panesIncludingUnplaced().some(pane => pane.id === parsed.id)
          if (!stillOpen()) {
            streamCtx.sendControlResponseSuccess(msg, { closed: true })
            return
          }
          await closePluginPane(parsed.id, { kind: 'person' })
          streamCtx.sendControlResponseSuccess(msg, { closed: !stillOpen() })
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_scroll') {
    // densable `nkn` + `JC`/`ok` @206554911.
    const parsed = parseUiScrollControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_SCROLL_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { runRemoteUiScroll } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const ue = await runRemoteUiScroll({
            clientId:
              parsed.clientId ?? defaultClientIdForSurface(parsed.surface),
            component: parsed.component,
            requestId: parsed.instanceId,
            offset: parsed.offset,
            by: parsed.by,
            bodyRows: parsed.bodyRows,
            contentRows: parsed.contentRows,
            ...(parsed.pointer !== undefined && {
              pointer: parsed.pointer,
            }),
            ...(parsed.keyed !== undefined && { keyed: parsed.keyed }),
          })
          streamCtx.sendControlResponseSuccess(msg, {
            moved: ue.result.deny === undefined,
            offset: ue.offset,
            ...(ue.result.deny !== undefined && {
              deny: ue.result.deny,
            }),
            ...(ue.isFollowingEnd && { follow_end: true }),
          })
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_focus') {
    // densable `rkn` + `vC` @206555819.
    const parsed = parseUiFocusControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_FOCUS_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { runRemoteUiFocus } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const ue = await runRemoteUiFocus({
            clientId:
              parsed.clientId ?? defaultClientIdForSurface(parsed.surface),
            component: parsed.component,
            requestId: parsed.instanceId,
            isHeld: parsed.isHeld,
            by: parsed.by,
            ...(parsed.element !== undefined && {
              element: parsed.element,
            }),
          })
          streamCtx.sendControlResponseSuccess(msg, {
            moved: ue.result.deny === undefined,
            element: ue.element,
            ...(ue.result.deny !== undefined && {
              deny: ue.result.deny,
            }),
          })
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_client_module') {
    // densable `VAn` + `E1e.clientModule`/`FS.moduleFor` @206556627.
    const parsed = parseUiClientModuleControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_CLIENT_MODULE_PARSE_ERROR)
    } else {
      try {
        const { clientModuleFor } = await import(
          'src/utils/plugins/functionHooksModules.js'
        )
        const ce = clientModuleFor(parsed.plugin)
        if (ce === undefined) {
          streamCtx.sendControlResponseError(
            msg,
            uiClientModuleMissingError(parsed.plugin),
          )
        } else {
          streamCtx.sendControlResponseSuccess(msg, ce)
        }
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    }
  } else if (req.subtype === 'ui_client_press') {
    // densable `qAn` + `E1e.clientPress`/`I3` @206556940.
    const parsed = parseUiClientPressControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_CLIENT_PRESS_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { runRemoteClientPress } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const ue = await runRemoteClientPress({
            plugin: parsed.plugin,
            component: parsed.component,
            requestId: parsed.instanceId,
            key: parsed.client,
            module: parsed.module,
            element: parsed.element,
            event: parsed.event,
          })
          streamCtx.sendControlResponseSuccess(
            msg,
            ue === undefined
              ? { handled: false }
              : {
                  handled: true,
                  ...(ue.reached !== undefined && {
                    reached: ue.reached,
                  }),
                },
          )
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_message') {
    // densable `KAn` + `E1e.clientMessage`/`O3` @206557563.
    const parsed = parseUiMessageControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, UI_MESSAGE_PARSE_ERROR)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { runRemoteClientMessage } = await import(
            'src/utils/plugins/functionHooksModules.js'
          )
          const ue = await runRemoteClientMessage({
            plugin: parsed.plugin,
            component: parsed.component,
            requestId: parsed.instanceId,
            key: parsed.client,
            module: parsed.module,
            data: parsed.data,
          })
          streamCtx.sendControlResponseSuccess(
            msg,
            ue === undefined
              ? { handled: false }
              : {
                  handled: true,
                  ...(ue.props !== undefined && { props: ue.props }),
                },
          )
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else if (req.subtype === 'ui_client_fault') {
    // densable `YAn` + `_v`/`WX`/`dO` @206558071.
    const parsed = parseUiClientFaultControlRequest(req)
    if (!parsed.ok) {
      streamCtx.sendControlResponseError(msg, parsed.error)
    } else {
      deferControlLifecycleUntilDone(async () => {
        try {
          const { dispatchClientFault, getLoadedFunctionHooksModules } =
            await import('src/utils/plugins/functionHooksModules.js')
          const loaded = getLoadedFunctionHooksModules().some(
            item => item.name === parsed.plugin && item.status !== 'unloaded',
          )
          if (!loaded) {
            streamCtx.sendControlResponseSuccess(msg, { handled: false })
            return
          }
          await dispatchClientFault({
            plugin: parsed.plugin,
            surface: 'desktop',
            component: parsed.component,
            requestId: parsed.instanceId,
            element: parsed.client,
            module: parsed.module,
            phase: parsed.phase,
            reason: parsed.reason,
          })
          streamCtx.sendControlResponseSuccess(msg, { handled: true })
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      })
    }
  } else {
    return false
  }
  return true
}

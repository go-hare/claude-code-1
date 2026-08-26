# densable 2.1.212 — #35 WebSearch/WebFetch 529 + rate-limit bounded backoff

Also covers the #34 surface that densable implements in the same call path:
API overload/`isApiErrorMessage` must not become tool-result body text.

## Changelog

> Improved web search and web fetch reliability by retrying 529 errors and
> rate-limited requests with bounded backoff
>
> Fixed web search/fetch returning "API Error" as content when overloaded

## densable FOREGROUND set (`swh`) + `O6t`

```js
function O6t(e) {
  if (e === void 0) return !0
  if (e.startsWith('agent:')) return !0
  return swh.has(e)
}

swh = new Set([
  'repl_main_thread',
  'repl_main_thread:outputStyle:custom',
  'repl_main_thread:outputStyle:Proactive',
  'repl_main_thread:outputStyle:Explanatory',
  'repl_main_thread:outputStyle:Learning',
  'sdk',
  'agent:custom',
  'agent:default',
  'agent:builtin',
  'compact',
  'hook_agent',
  'hook_prompt',
  'side_question',
  'web_search_tool', // #35
  'web_fetch_apply', // #35
  'repl_sampling',
  'auto_mode',
  'compact_fab_check',
  'auto_mode_critique',
  'auto_mode_setup_propose',
  'chrome_mcp',
])
```

Usage in densable withRetry:

```js
if (pNe(E) && !O6t(r.querySource) && !mNe())
  throw /* tengu_api_529_background_dropped */
```

Side-query maxRetries also gated by `O6t(e.querySource)?l:0`.

Bounded backoff itself is the existing withRetry path (`getRetryDelay` /
`Retry-After` / maxRetries) — web tools inherit it once their `querySource` is
foreground.

## densable WebSearch (`call` / side query)

```js
querySource: 'web_search_tool'
// stream:
if (I.isApiErrorMessage) {
  S = $c(I.message.content)
  continue
}
// after stream:
if (S !== null && x.results.length === 0)
  throw new tn(S, 'web-search-side-query-api-error')
```

(`tn` = `TelemetrySafeError`, second arg = telemetryMessage.)

## densable WebFetch apply (`u8r` / applyPromptToMarkdown)

```js
c = await V3({
  /* queryHaiku */
  options: { querySource: 'web_fetch_apply', ... },
})
if (n.aborted) throw new El
if (c.isApiErrorMessage)
  throw new tn($c(c.message.content), 'web-fetch-apply-api-error')
```

## Local alignment

| densable | local |
|----------|--------|
| `swh` + `O6t` | `FOREGROUND_529_RETRY_SOURCES` + `shouldRetry529` in `withRetry.ts` |
| `web_search_tool` / `web_fetch_apply` in set | added |
| `startsWith("agent:")` | added |
| WebSearch skip + throw api error | `apiAdapter.ts` |
| WebFetch throw api error | `WebFetchTool/utils.ts` `applyPromptToMarkdown` |
| `tn` tag | `TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` |

## Not changed

- Adapter/Bing/Brave/Exa HTTP paths (not Anthropic 529) — out of densable
  #35 server-tool path.
- Main-loop withRetry delay math (`BASE_DELAY_MS`, `MAX_529_RETRIES`) already
  present.
- densable always `thinking:disabled` + forced `tool_choice:web_search` on
  side query — local keeps haiku/plum_vx3 branching (orthogonal).

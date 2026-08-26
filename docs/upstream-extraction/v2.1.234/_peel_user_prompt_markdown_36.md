# densable 2.1.234 #36 — user prompt markdown

## Gold
- `V3i` UserPromptMessage: truncate >AQm=10000 to `{head:G3i=2500, hiddenLines, tail:TQm=2500}` object (not string ellipsis).
- `j3i` HighlightedThinkingText:
  - `Bto = !isObj && !queued && text.length<=hQm=4000 && !(H9e()&&d0n(text))`
  - Bto → `jh` Markdown with `promptMode:true` (+ `color`)
  - isObj → head + `Gto` Divider `(N line(s) hidden)` titleAlign=start + tail
  - else plain / rainbow `Gfr`
- `jh`/`w0l` Markdown adds: `promptMode`, `color`, `stripPromptTags` (default true; skipped when promptMode).
- promptMode lexer `z6m`: disable table/blockquote/hr/lheading/link/autolink/url/escape/br; emStrong disables non-underscore? (1:1 port).
- `$6m`: promptMode → skip linkify (`return e`).
- Empty-token fallback: if promptMode && no flushed elements && trim → render raw.
- `Gto` uses Divider `titleAlign:"start"` (left dashes min(4, remaining)).

## Local map
- UserPromptMessage / HighlightedThinkingText / Markdown / utils/markdown formatToken / ink Divider

# densable 2.1.216 #28 — Plugin skill frontmatter `name` keeps plugin prefix

## Changelog

> Fixed plugin skills with a `name` frontmatter field losing their plugin prefix in slash-command autocomplete

## Gold (SEA 2.1.216) — `uzr` / plugin factory (~225074)

```js
// e = commandName (plugin:… path-derived)
// a = frontmatter
x = a.name != null ? String(a.name) : void 0
I = e.slice(0, e.lastIndexOf(":") + 1)
D = x ? `${I}${x}` : e
k = x && !x.includes(":") ? [x] : void 0
// ...
name: e,
userFacingName(){ return D },
aliases: k,
```

`Xen` (non-plugin skills) still uses `userFacingName(){ return t||e }` — **plugin path is special**.

## Bug (pre-fix local)

```ts
userFacingName(): string {
  return displayName || commandName  // bare frontmatter name dropped plugin:
}
```

## Local land

`src/utils/plugins/loadPluginCommands.ts` — densable `I`/`D`/`k` formula.

## Tests

`src/utils/plugins/__tests__/pluginSkillPrefix.216.test.ts`

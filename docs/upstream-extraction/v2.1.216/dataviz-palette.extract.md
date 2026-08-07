# densable 2.1.216 #38 — dataviz default palette reorder + four-series guidance

## Official

> Updated the bundled dataviz skill: reordered the default chart palette and fixed guidance that suggested direct labels for four-series charts

## densable gold

### Categorical order (same 8 hex, re-ordered)

| Slot | Hue | Light | Dark |
|------|-----|-------|------|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | **orange** | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#4a3aa7` | `#9085e9` |
| 8 | red | `#e34948` | `#e66767` |

Predecessor (local pre-216): blue, aqua, yellow, green, violet, red, magenta, **orange last**.

CSV for validators:

```
#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948
```

### Series-count ladder row 4

```
| 4 | adjacent forms (stacks, bars, lines) stay gate-safe, but direct labels become mandatory — yellow and orange now share the screen; all-pairs forms (scatter, bubble, choropleth, small multiples) cap at **three** — fold to "Other" or facet rather than seat a 4th |
```

Not: “direct labels become mandatory, not a courtesy” alone — 216 ties the rule to **yellow+orange adjacency** and **all-pairs cap at three**.

### Sequential second hue

Next categorical after blue is **orange** (was aqua).

## Local land

| File | Change |
|------|--------|
| `datavizContent/references/palette.md` | slot table + prose + sequential second hue |
| `datavizContent/references/choosing-a-form.md` | series ladder row 4 |
| `color-formula.md` + validate scripts | example CSV order |
| tests | `dataviz.216.test.ts` |

## Tests

`src/skills/bundled/__tests__/dataviz.216.test.ts`

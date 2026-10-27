import { describe, expect, test } from 'bun:test'
import Yoga, {
  type Config,
  FlexDirection,
  MeasureMode,
  type Node,
  Overflow,
} from '../yoga-layout/index.js'

// densable 2.1.289 yoga `_mGen`: a measure pass writes layout.width/height in
// place for the whole subtree. A layout pass on a node measured in the same
// generation must not take a cache hit (it would skip child positioning and
// leave descendants at their intrinsic sizes — the spinner row inside the
// fullscreen overflow:hidden wrappers got clipped for a frame). Multi-entry
// cache is measure-only; flex-basis cache is keyed by main axis.

type Spec = {
  id: number
  row: boolean
  grow: number
  shrink: number
  overflow: Overflow
  height?: number
  text?: number
  kids: Spec[]
}

function makeRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function unroundedConfig(): Config {
  const config = Yoga.Config.create()
  config.setPointScaleFactor(0)
  return config
}

function run(seed: number, runs: number): string[] {
  const rnd = makeRng(seed)
  let nextId = 1
  const gen = (depth: number): Spec => {
    const leaf = depth > 4 || (depth > 1 && rnd() < 0.35)
    const s: Spec = {
      id: nextId++,
      row: rnd() >= 0.7,
      grow: rnd() < 0.5 ? 1 : 0,
      shrink: rnd() < 0.5 ? 1 : 0,
      overflow: [
        Overflow.Visible,
        Overflow.Visible,
        Overflow.Hidden,
        Overflow.Scroll,
      ][Math.floor(rnd() * 4)]!,
      kids: [],
    }
    if (rnd() < 0.1) s.height = Math.floor(rnd() * 4)
    if (leaf) {
      s.text = Math.floor(rnd() * 120)
      return s
    }
    const n = 1 + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) s.kids.push(gen(depth + 1))
    return s
  }
  const build = (s: Spec, config: Config, map?: Map<number, Node>): Node => {
    const n = Yoga.Node.create(config)
    n.setFlexDirection(s.row ? FlexDirection.Row : FlexDirection.Column)
    n.setFlexGrow(s.grow)
    n.setFlexShrink(s.shrink)
    n.setOverflow(s.overflow)
    if (s.height !== undefined) n.setHeight(s.height)
    else n.setHeightAuto()
    map?.set(s.id, n)
    if (s.text !== undefined) {
      n.setMeasureFunc((w: number, wm: MeasureMode) => {
        const len = s.text ?? 0
        const avail =
          wm === MeasureMode.Undefined || !Number.isFinite(w)
            ? Infinity
            : Math.max(1, Math.floor(w))
        return {
          width: Math.min(len, avail),
          height:
            len === 0 ? 0 : avail === Infinity ? 1 : Math.ceil(len / avail),
        }
      })
    }
    s.kids.forEach((k, i) => n.insertChild(build(k, config, map), i))
    return n
  }
  const all = (s: Spec, out: Spec[] = []): Spec[] => {
    out.push(s)
    for (const k of s.kids) all(k, out)
    return out
  }
  const parentOf = (root: Spec, target: Spec): Spec | undefined => {
    for (const k of root.kids) {
      if (k === target) return root
      const p = parentOf(k, target)
      if (p) return p
    }
    return undefined
  }
  const snapshot = (root: Node): string[] => {
    const out: string[] = []
    const walk = (n: Node, path: string): void => {
      out.push(
        `${path}:${n.getComputedLeft()},${n.getComputedTop()},${n.getComputedWidth()},${n.getComputedHeight()}`,
      )
      n.children.forEach((c, i) => walk(c, `${path}.${i}`))
    }
    walk(root, 'r')
    return out
  }

  const config = unroundedConfig()
  const failures: string[] = []
  for (let r = 0; r < runs && failures.length === 0; r++) {
    nextId = 1
    const spec: Spec = {
      id: 0,
      row: false,
      grow: 0,
      shrink: 0,
      overflow: Overflow.Visible,
      height: 20,
      kids: [gen(1), gen(1)],
    }
    const map = new Map<number, Node>()
    const live = build(spec, config, map)
    live.calculateLayout(40, undefined)
    for (let step = 0; step < 40; step++) {
      const specs = all(spec)
      const roll = rnd()
      if (roll < 0.5) {
        const leaves = specs.filter(s => s.text !== undefined)
        if (!leaves.length) continue
        const l = leaves[Math.floor(rnd() * leaves.length)]!
        l.text = Math.floor(rnd() * 120)
        map.get(l.id)!.markDirty()
      } else if (roll < 0.75) {
        const parents = specs.filter(s => s.text === undefined)
        const p = parents[Math.floor(rnd() * parents.length)]!
        const k = gen(5)
        k.text = Math.floor(rnd() * 4)
        const idx = Math.floor(rnd() * (p.kids.length + 1))
        p.kids.splice(idx, 0, k)
        map.get(p.id)!.insertChild(build(k, config, map), idx)
      } else {
        const removable = specs.filter(
          s => s.id !== 0 && (parentOf(spec, s)?.kids.length ?? 0) > 1,
        )
        if (!removable.length) continue
        const s = removable[Math.floor(rnd() * removable.length)]!
        const p = parentOf(spec, s)!
        p.kids.splice(p.kids.indexOf(s), 1)
        map.get(p.id)!.removeChild(map.get(s.id)!)
      }
      live.calculateLayout(40, undefined)
      const fresh = build(spec, config)
      fresh.calculateLayout(40, undefined)
      const a = snapshot(live)
      const b = snapshot(fresh)
      a.forEach((x, i) => {
        if (x !== b[i])
          failures.push(`seed ${seed} run ${r} step ${step}: ${x} vs ${b[i]}`)
      })
      if (failures.length) break
    }
  }
  return failures
}

describe('densable 2.1.289 yoga _mGen / measure-only multi-entry cache', () => {
  test.each([
    1, 2, 3, 4,
  ])('incremental relayout matches a fresh build (seed %i)', seed => {
    expect(run(seed, 40)).toEqual([])
  })
})

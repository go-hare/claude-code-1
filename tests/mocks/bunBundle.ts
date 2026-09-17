/**
 * Shared `bun:bundle` mock. Bun `mock.module` is process-global last-write-wins,
 * so every test file must register this same factory. Per-suite `feature()`
 * values go through `pushFeatureOverride` (beforeAll / afterAll).
 *
 * Default with an empty stack: `feature()` is false (runtime / bun test).
 */
export type FeatureOverride = (name: string) => boolean

const featureStack: FeatureOverride[] = []

export function pushFeatureOverride(fn: FeatureOverride): () => void {
  featureStack.push(fn)
  return () => {
    const i = featureStack.lastIndexOf(fn)
    if (i >= 0) featureStack.splice(i, 1)
  }
}

export function bunBundleMock() {
  return {
    feature: (name: string): boolean => {
      if (featureStack.length === 0) return false
      return featureStack[featureStack.length - 1]!(name)
    },
  }
}

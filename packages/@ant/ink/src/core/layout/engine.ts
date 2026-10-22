import type { LayoutNode, YogaNodeConfig } from './node.js'
import { createYogaLayoutNode } from './yoga.js'

export function createLayoutNode(config?: YogaNodeConfig): LayoutNode {
  return createYogaLayoutNode(config)
}

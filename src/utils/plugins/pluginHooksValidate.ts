/**
 * Official 2.1.323 #1966, #1967, #2184:
 * - #1966: TypeScript type checking of a plugin's TS hooks module in `claude plugin validate`
 *   (findings are warnings; `--strict` fails on them).
 * - #1967: Static analysis of `engine.create` hook `$` nouns (adds, adds unless there,
 *   withholds, replaces).
 * - #2184: Strict accepted-form validation for `engine.create` hooks in `claude plugin validate`.
 */
import * as fs from 'fs'
import * as path from 'path'
import type * as TS from 'typescript'
import type { ValidationError } from './validatePlugin.js'

const CORE_ENGINE_NOUNS_DEFAULT: readonly string[] = [
  'plugin',
  'state',
  'tool',
  'ui',
  'fs',
  'http',
  'log',
  'session',
  'settings',
  'command',
  'event',
  'decision',
  'flag',
]

const FORBIDDEN_VALUE_IDENTIFIERS = new Set(['undefined', 'NaN', 'Infinity'])
const ENGINE_PLUGIN_NOUN = 'plugin'
const ALLOWED_PLUGIN_PROPS = new Set(['root', 'name'])
const NEXT_ALLOWED_PROPS = new Set(['signal', 'is', 'event', 'origin'])
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

class EngineFormRefusal extends Error {
  readonly file: string
  readonly line: number
  readonly construct: string

  constructor(file: string, line: number, construct: string) {
    super(
      `engine.create hook is not written in the accepted form (${file}:${line}): ${construct}`,
    )
    this.name = 'EngineFormRefusal'
    this.file = file
    this.line = line
    this.construct = construct
  }
}

export type EngineCreateAnalysisResult =
  | {
      isInForm: true
      added: string[]
      addedUnlessThere: string[]
      withheld: string[] | 'everything'
    }
  | {
      isInForm: false
      file: string
      line: number
      part: string
      message: string
    }

function loadTypeScript(): typeof TS | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('typescript') as typeof TS
  } catch {
    return undefined
  }
}

function lineOf(sf: TS.SourceFile, node: TS.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

function unwrapParens(ts: typeof TS, expr: TS.Expression): TS.Expression {
  let cur = expr
  while (ts.isParenthesizedExpression(cur)) {
    cur = cur.expression
  }
  return cur
}

function isFunctionLike(
  ts: typeof TS,
  node: TS.Node | undefined,
): node is TS.ArrowFunction | TS.FunctionExpression | TS.FunctionDeclaration {
  return (
    node !== undefined &&
    (ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node))
  )
}

function isNestedFunctionScope(ts: typeof TS, node: TS.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )
}

function walkWithinFn(
  ts: typeof TS,
  root: TS.Node,
  visit: (node: TS.Node) => void,
): void {
  const step = (node: TS.Node): void => {
    visit(node)
    ts.forEachChild(node, child => {
      if (isNestedFunctionScope(ts, child)) return
      step(child)
    })
  }
  ts.forEachChild(root, child => {
    if (isNestedFunctionScope(ts, child)) return
    step(child)
  })
}

function walkAll(
  ts: typeof TS,
  root: TS.Node,
  visit: (node: TS.Node) => void,
): void {
  const step = (node: TS.Node): void => {
    visit(node)
    ts.forEachChild(node, step)
  }
  ts.forEachChild(root, step)
}

function isIdentifierReference(ts: typeof TS, id: TS.Identifier): boolean {
  const parent = id.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false
  if (ts.isMethodDeclaration(parent) && parent.name === id) return false
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false
  if (ts.isBindingElement(parent) && parent.name === id) return false
  if (ts.isVariableDeclaration(parent) && parent.name === id) return false
  if (ts.isParameter(parent) && parent.name === id) return false
  if (ts.isFunctionDeclaration(parent) && parent.name === id) return false
  if (ts.isFunctionExpression(parent) && parent.name === id) return false
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) return false
  if (ts.isTypeReferenceNode(parent) || ts.isTypeAliasDeclaration(parent))
    return false
  return true
}

function collectIdentifierRefs(
  ts: typeof TS,
  fnBody: TS.Node,
  name: string,
): TS.Identifier[] {
  const refs: TS.Identifier[] = []
  walkAll(ts, fnBody, node => {
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      isIdentifierReference(ts, node)
    ) {
      refs.push(node)
    }
  })
  return refs
}

function collectDeclarationsOf(
  ts: typeof TS,
  fnNode: TS.Node,
  name: string,
): TS.Identifier[] {
  const decls: TS.Identifier[] = []
  walkAll(ts, fnNode, node => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      decls.push(node.name)
    }
  })
  return decls
}

function isWriteToIdentifier(ts: typeof TS, id: TS.Identifier): boolean {
  let cur: TS.Node = id
  while (
    cur.parent &&
    ((ts.isPropertyAccessExpression(cur.parent) &&
      cur.parent.expression === cur) ||
      (ts.isElementAccessExpression(cur.parent) &&
        cur.parent.expression === cur))
  ) {
    cur = cur.parent
  }
  const parent = cur.parent
  if (!parent) return false
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === cur &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return true
  }
  if (
    ts.isPrefixUnaryExpression(parent) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return true
  }
  if (ts.isPostfixUnaryExpression(parent)) return true
  if (ts.isDeleteExpression(parent)) return true
  return false
}

function getPropertyKeyName(
  ts: typeof TS,
  prop: TS.ObjectLiteralElementLike,
  refuse: (node: TS.Node, msg: string) => never,
): string {
  if (ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
    refuse(prop, 'an accessor')
  }
  if (ts.isMethodDeclaration(prop)) {
    refuse(prop, 'a method')
  }
  if (ts.isShorthandPropertyAssignment(prop)) {
    const key = prop.name.text
    if (key === '__proto__') refuse(prop, 'a __proto__ key')
    if (key === 'then') refuse(prop, 'a then key')
    return key
  }
  if (!ts.isPropertyAssignment(prop)) {
    refuse(prop, 'a key that is not a plain name')
  }
  const name = prop.name
  if (ts.isComputedPropertyName(name)) {
    refuse(prop, 'a computed key')
  }
  let key: string | undefined
  if (ts.isIdentifier(name)) key = name.text
  else if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
    key = name.text
  if (key === undefined) {
    refuse(prop, 'a key that is not a plain name')
  }
  if (key === '__proto__') refuse(prop, 'a __proto__ key')
  if (key === 'then') refuse(prop, 'a then key')
  return key
}

function isAllowedNounValue(
  ts: typeof TS,
  expr: TS.Expression,
  disallowedNames: ReadonlySet<string>,
): boolean {
  const e = unwrapParens(ts, expr)
  if (ts.isAwaitExpression(e)) {
    return isAllowedNounValue(ts, e.expression, disallowedNames)
  }
  if (
    ts.isObjectLiteralExpression(e) ||
    ts.isCallExpression(e) ||
    ts.isNewExpression(e)
  ) {
    return true
  }
  if (ts.isPropertyAccessExpression(e)) {
    let root: TS.Expression = e
    while (ts.isPropertyAccessExpression(root)) root = root.expression
    return !ts.isIdentifier(root) || !disallowedNames.has(root.text)
  }
  if (ts.isIdentifier(e)) {
    return (
      !FORBIDDEN_VALUE_IDENTIFIERS.has(e.text) && !disallowedNames.has(e.text)
    )
  }
  return false
}

function analyzeReturnedObjectLiteral(
  ts: typeof TS,
  obj: TS.ObjectLiteralExpression,
  isAllowedSpreadExpr: (expr: TS.Expression) => boolean,
  disallowedNames: ReadonlySet<string>,
  refuse: (node: TS.Node, msg: string) => never,
): { added: string[]; addedUnlessThere: string[] } {
  const added: string[] = []
  const addedUnlessThere: string[] = []
  const seen = new Set<string>()
  const spreadIdx = obj.properties.findIndex(p => ts.isSpreadAssignment(p))

  obj.properties.forEach((prop, idx) => {
    if (ts.isSpreadAssignment(prop)) {
      if (!isAllowedSpreadExpr(unwrapParens(ts, prop.expression))) {
        refuse(prop, 'a spread of anything but the value of next(e)')
      }
      if (idx !== spreadIdx) {
        refuse(prop, 'a spread of the value of next(e) more than once')
      }
      return
    }
    const key = getPropertyKeyName(ts, prop, refuse)
    if (seen.has(key)) {
      refuse(prop, `the key ${JSON.stringify(key)} written twice`)
    }
    seen.add(key)
    const valueExpr = ts.isShorthandPropertyAssignment(prop)
      ? prop.name
      : (prop as TS.PropertyAssignment).initializer
    if (!isAllowedNounValue(ts, valueExpr, disallowedNames)) {
      refuse(
        valueExpr,
        `the value of ${JSON.stringify(key)}, which is not an object, a name or a call`,
      )
    }
    if (spreadIdx !== -1 && idx < spreadIdx) {
      addedUnlessThere.push(key)
    } else {
      added.push(key)
    }
  })

  return { added, addedUnlessThere }
}

function isValidBaseUsage(
  ts: typeof TS,
  id: TS.Identifier,
  returnExpr: TS.Expression,
): boolean {
  const unwrappedReturn = unwrapParens(ts, returnExpr)
  if (id === unwrappedReturn) return true
  if (
    ts.isSpreadAssignment(id.parent) &&
    unwrapParens(ts, id.parent.expression) === id &&
    id.parent.parent === unwrappedReturn
  ) {
    return true
  }
  // Allow base.noun.method(...) or base.plugin.root / base.plugin.name
  const p1 = id.parent
  if (
    ts.isPropertyAccessExpression(p1) &&
    p1.expression === id &&
    !p1.questionDotToken
  ) {
    const p2 = p1.parent
    if (
      ts.isPropertyAccessExpression(p2) &&
      p2.expression === p1 &&
      !p2.questionDotToken
    ) {
      const noun = p1.name.text
      const prop = p2.name.text
      if (noun === ENGINE_PLUGIN_NOUN) {
        return ALLOWED_PLUGIN_PROPS.has(prop) && !isWriteToIdentifier(ts, id)
      }
      if (noun !== '__proto__' && prop !== '__proto__') {
        return (
          ts.isCallExpression(p2.parent) &&
          p2.parent.expression === p2 &&
          !p2.parent.questionDotToken
        )
      }
    }
  }
  return false
}

function extractReturnExpression(
  ts: typeof TS,
  fn: TS.ArrowFunction | TS.FunctionExpression | TS.FunctionDeclaration,
  refuse: (node: TS.Node, msg: string) => never,
): TS.Expression {
  const body = fn.body
  if (!body) {
    refuse(fn, 'a hook with no body')
  }
  if (!ts.isBlock(body)) {
    return unwrapParens(ts, body)
  }
  const returns: TS.ReturnStatement[] = []
  walkWithinFn(ts, body, node => {
    if (ts.isReturnStatement(node)) returns.push(node)
  })
  const lastStmt = body.statements.at(-1)
  const earlierReturn = returns.find(r => r !== lastStmt)
  if (earlierReturn !== undefined) {
    refuse(
      earlierReturn,
      "a return that is not the one last statement of the hook's body",
    )
  }
  if (!lastStmt || !ts.isReturnStatement(lastStmt)) {
    refuse(lastStmt ?? body, 'a hook whose last statement is not its return')
  }
  if (!lastStmt.expression) {
    refuse(lastStmt, 'a return with no value')
  }
  return unwrapParens(ts, lastStmt.expression)
}

function analyzeEngineCreateFunction(
  ts: typeof TS,
  sf: TS.SourceFile,
  moduleName: string,
  fn: TS.ArrowFunction | TS.FunctionExpression | TS.FunctionDeclaration,
): Extract<EngineCreateAnalysisResult, { isInForm: true }> {
  const refuse = (node: TS.Node, construct: string): never => {
    throw new EngineFormRefusal(moduleName, lineOf(sf, node), construct)
  }

  const [firstParam, eventParam, nextParam] = fn.parameters
  if (firstParam && ts.isIdentifier(firstParam.name)) {
    const firstRefs = collectIdentifierRefs(
      ts,
      fn.body ?? fn,
      firstParam.name.text,
    )
    if (firstRefs[0] !== undefined) {
      return refuse(firstRefs[0], `a use of ${firstParam.name.text}`)
    }
  }

  const paramNames = new Set<string>()
  for (const p of fn.parameters) {
    if (ts.isIdentifier(p.name)) paramNames.add(p.name.text)
  }

  // Validate event param: no redeclaration, no writes
  const eventName =
    eventParam && ts.isIdentifier(eventParam.name)
      ? eventParam.name.text
      : undefined
  if (eventParam && eventName !== undefined) {
    const dupDecls = collectDeclarationsOf(ts, fn, eventName).filter(
      d => d !== eventParam.name,
    )
    if (dupDecls[0] !== undefined) {
      refuse(dupDecls[0], `"${eventName}" declared a second time in the hook`)
    }
    for (const ref of collectIdentifierRefs(ts, fn.body ?? fn, eventName)) {
      if (isWriteToIdentifier(ts, ref)) {
        refuse(ref, `a write to ${eventName}`)
      }
    }
  }

  const returnExpr = extractReturnExpression(ts, fn, refuse)

  // Case 1: no `next` parameter → must return an object literal, withholds everything
  if (
    eventName === undefined ||
    nextParam === undefined ||
    !ts.isIdentifier(nextParam.name)
  ) {
    if (!ts.isObjectLiteralExpression(returnExpr)) {
      return refuse(
        returnExpr,
        'a hook with no next that returns anything but an object literal',
      )
    }
    const objResult = analyzeReturnedObjectLiteral(
      ts,
      returnExpr,
      () => false,
      paramNames,
      refuse,
    )
    return {
      isInForm: true,
      ...objResult,
      withheld: 'everything',
    }
  }

  // Case 2: `next` parameter is present
  const nextName = nextParam.name.text
  const dupNextDecls = collectDeclarationsOf(ts, fn, nextName).filter(
    d => d !== nextParam.name,
  )
  if (dupNextDecls[0] !== undefined) {
    refuse(dupNextDecls[0], `"${nextName}" declared a second time in the hook`)
  }

  const isNextCall = (node: TS.Node | undefined): boolean => {
    if (!node || !ts.isCallExpression(node) || node.questionDotToken) {
      return false
    }
    return (
      ts.isIdentifier(node.expression) &&
      node.expression.text === nextName &&
      node.arguments.length === 1 &&
      ts.isIdentifier(node.arguments[0]!) &&
      node.arguments[0]!.text === eventName
    )
  }

  const isAwaitNextCall = (node: TS.Node | undefined): boolean => {
    if (!node) return false
    const u = ts.isExpression(node) ? unwrapParens(ts, node) : node
    return ts.isAwaitExpression(u) && isNextCall(unwrapParens(ts, u.expression))
  }

  const isAllowedNextPropAccess = (id: TS.Identifier): boolean =>
    ts.isPropertyAccessExpression(id.parent) &&
    id.parent.expression === id &&
    NEXT_ALLOWED_PROPS.has(id.parent.name.text)

  const nextRefs = collectIdentifierRefs(ts, fn.body ?? fn, nextName).filter(
    ref => !isAllowedNextPropAccess(ref),
  )
  const [firstNextRef, secondNextRef] = nextRefs
  if (firstNextRef === undefined) {
    refuse(nextParam, 'a next parameter the hook never calls')
  }
  if (secondNextRef !== undefined) {
    refuse(secondNextRef, `${nextName} called or used more than once`)
  }

  const nextCallNode = firstNextRef.parent
  if (!isNextCall(nextCallNode)) {
    refuse(
      firstNextRef,
      `${nextName} used as anything but ${nextName}(${eventName})`,
    )
  }

  // Check if `await next(e)` is bound in a top-level `const` declaration in fn body
  let boundBase: { name: string; withheld: string[] } | undefined
  if (fn.body && ts.isBlock(fn.body)) {
    for (const stmt of fn.body.statements) {
      if (
        ts.isVariableStatement(stmt) &&
        (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
        stmt.declarationList.declarations.length === 1
      ) {
        const decl = stmt.declarationList.declarations[0]!
        if (decl.initializer && isAwaitNextCall(decl.initializer)) {
          if (ts.isIdentifier(decl.name)) {
            const dup = collectDeclarationsOf(ts, fn, decl.name.text).filter(
              d => d !== decl.name,
            )
            if (dup[0] !== undefined) {
              refuse(
                dup[0],
                `"${decl.name.text}" declared a second time in the hook`,
              )
            }
            boundBase = { name: decl.name.text, withheld: [] }
          } else if (ts.isObjectBindingPattern(decl.name)) {
            const lastEl = decl.name.elements.at(-1)
            if (
              !lastEl ||
              !lastEl.dotDotDotToken ||
              !ts.isIdentifier(lastEl.name)
            ) {
              return refuse(
                decl.name,
                'a destructure of next(e) with no plain rest',
              )
            }
            const restIdent = lastEl.name
            const dupRest = collectDeclarationsOf(
              ts,
              fn,
              restIdent.text,
            ).filter(d => d !== restIdent)
            if (dupRest[0] !== undefined) {
              return refuse(
                dupRest[0],
                `"${restIdent.text}" declared a second time in the hook`,
              )
            }
            const withheld: string[] = []
            for (const el of decl.name.elements.slice(0, -1)) {
              if (
                el.dotDotDotToken ||
                el.propertyName !== undefined ||
                el.initializer !== undefined ||
                !ts.isIdentifier(el.name) ||
                el.name.text === '__proto__'
              ) {
                return refuse(
                  el,
                  'a key in the destructure of next(e) that is not a plain name',
                )
              }
              const keyIdent = el.name
              const dupKey = collectDeclarationsOf(
                ts,
                fn,
                keyIdent.text,
              ).filter(d => d !== keyIdent)
              if (dupKey[0] !== undefined) {
                return refuse(
                  dupKey[0],
                  `"${keyIdent.text}" declared a second time in the hook`,
                )
              }
              const withheldRefs = collectIdentifierRefs(
                ts,
                fn.body,
                keyIdent.text,
              )
              if (withheldRefs[0] !== undefined) {
                return refuse(
                  withheldRefs[0],
                  `a read of ${keyIdent.text}, which the hook withholds`,
                )
              }
              withheld.push(keyIdent.text)
            }
            boundBase = { name: restIdent.text, withheld }
          } else {
            refuse(
              decl.name,
              'a binding of next(e) that is not a name or a destructure',
            )
          }
          break
        }
      }
    }
  }

  // Verify `next(e)` is either bound via the single const or directly returned / spread in return
  if (boundBase === undefined) {
    const directReturn =
      nextCallNode === returnExpr ||
      (ts.isAwaitExpression(nextCallNode.parent) &&
        (nextCallNode.parent === returnExpr ||
          (ts.isSpreadAssignment(nextCallNode.parent.parent) &&
            nextCallNode.parent.parent.parent === returnExpr)))
    if (!directReturn) {
      refuse(
        firstNextRef,
        `${nextName}(${eventName}) anywhere but as await ${nextName}(${eventName}) in the hook's one const or its return`,
      )
    }
  } else {
    // Check all references to boundBase.name
    for (const ref of collectIdentifierRefs(
      ts,
      fn.body ?? fn,
      boundBase.name,
    )) {
      if (!isValidBaseUsage(ts, ref, returnExpr)) {
        refuse(
          ref,
          `a use of ${boundBase.name} other than the return, ${boundBase.name}.noun.event(...), ${boundBase.name}.plugin.root and ${boundBase.name}.plugin.name`,
        )
      }
    }
  }

  const withheld = boundBase?.withheld ?? []
  const isSpreadTarget = boundBase
    ? (expr: TS.Expression): boolean =>
        ts.isIdentifier(expr) && expr.text === boundBase.name
    : (expr: TS.Expression): boolean => isAwaitNextCall(expr)

  if (
    isSpreadTarget(returnExpr) ||
    (boundBase === undefined && isNextCall(returnExpr))
  ) {
    return {
      isInForm: true,
      added: [],
      addedUnlessThere: [],
      withheld,
    }
  }

  if (!ts.isObjectLiteralExpression(returnExpr)) {
    return refuse(returnExpr, 'a return of anything but the forms above')
  }

  const disallowed = new Set(paramNames)
  if (boundBase !== undefined) disallowed.add(boundBase.name)

  const objResult = analyzeReturnedObjectLiteral(
    ts,
    returnExpr,
    isSpreadTarget,
    disallowed,
    refuse,
  )

  if (!returnExpr.properties.some(p => ts.isSpreadAssignment(p))) {
    return refuse(
      returnExpr,
      'a return with no spread of the value of next(e); to withhold everything, leave next out of the parameters',
    )
  }

  const overlap = [...objResult.added, ...objResult.addedUnlessThere].find(k =>
    withheld.includes(k),
  )
  if (overlap !== undefined) {
    refuse(returnExpr, `${JSON.stringify(overlap)} both withheld and written`)
  }

  return {
    isInForm: true,
    ...objResult,
    withheld,
  }
}

/**
 * Official 2.1.323 #1967 & #2184 (`PQt`): analyze `on("engine.create", ...)`
 * in a plugin hooks module source file. Returns `undefined` when the module
 * registers no `engine.create` hook.
 */
export function analyzeEngineCreateHookInSource(
  moduleName: string,
  source: string,
): EngineCreateAnalysisResult | undefined {
  const ts = loadTypeScript()
  if (!ts) return undefined

  const sf = ts.createSourceFile(
    moduleName,
    source,
    ts.ScriptTarget.Latest,
    true,
  )

  // Collect top-level named function bindings for `on("engine.create", myHook)`
  const topLevelFns = new Map<
    string,
    TS.ArrowFunction | TS.FunctionExpression | TS.FunctionDeclaration
  >()
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      topLevelFns.set(stmt.name.text, stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          isFunctionLike(ts, unwrapParens(ts, decl.initializer))
        ) {
          topLevelFns.set(
            decl.name.text,
            unwrapParens(ts, decl.initializer) as
              | TS.ArrowFunction
              | TS.FunctionExpression,
          )
        }
      }
    }
  }

  // Find all `on("engine.create", ...)` calls
  const calls: TS.CallExpression[] = []
  walkAll(ts, sf, node => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'on' &&
      node.arguments.length >= 2
    ) {
      const first = node.arguments[0]!
      if (
        (ts.isStringLiteral(first) ||
          ts.isNoSubstitutionTemplateLiteral(first)) &&
        first.text === 'engine.create'
      ) {
        calls.push(node)
      }
    }
  })

  if (calls.length === 0) return undefined

  try {
    if (calls.length > 1) {
      throw new EngineFormRefusal(
        moduleName,
        lineOf(sf, calls[1]!),
        'a second engine.create hook',
      )
    }
    const call = calls[0]!
    if (call.arguments.length >= 3) {
      throw new EngineFormRefusal(
        moduleName,
        lineOf(sf, call.arguments[1]!),
        'a matcher on the hook',
      )
    }
    const hookArg = unwrapParens(ts, call.arguments.at(-1)!)
    let fn:
      | TS.ArrowFunction
      | TS.FunctionExpression
      | TS.FunctionDeclaration
      | undefined
    if (ts.isIdentifier(hookArg)) {
      fn = topLevelFns.get(hookArg.text)
      if (!fn) {
        throw new EngineFormRefusal(
          moduleName,
          lineOf(sf, hookArg),
          'a hook that is not a function, inline or by name',
        )
      }
    } else if (isFunctionLike(ts, hookArg)) {
      fn = hookArg
    } else {
      throw new EngineFormRefusal(
        moduleName,
        lineOf(sf, call),
        'a hook that is not a function, inline or by name',
      )
    }
    return analyzeEngineCreateFunction(ts, sf, moduleName, fn)
  } catch (err) {
    if (err instanceof EngineFormRefusal) {
      return {
        isInForm: false,
        file: err.file,
        line: err.line,
        part: err.construct,
        message: err.message,
      }
    }
    throw err
  }
}

function wrapNounLines(prefix: string, items: string[], suffix = ''): string[] {
  if (items.length === 0) return []
  const maxWidth = 700 - prefix.length - suffix.length
  const lines: string[] = []
  for (const item of items) {
    const last = lines.at(-1)
    if (last === undefined || last.length + item.length + 2 > maxWidth) {
      lines.push(item)
    } else {
      lines[lines.length - 1] = `${last}, ${item}`
    }
  }
  return lines.map(line => `${prefix}: ${line}${suffix}`)
}

const USER_TIER_WITHHOLD_SUFFIX =
  ' (in the user tier, the fold refuses this and unloads the module)'
const REPLACE_REFUSE_SUFFIX = ' (the fold refuses this and unloads the module)'

/**
 * Official 2.1.323 #1967 (`Xja`): format human-readable notes describing the
 * `$` nouns an `engine.create` hook adds, adds-unless-there, withholds, or replaces.
 */
export function formatEngineCreateNounNotes(
  analysis: Extract<EngineCreateAnalysisResult, { isInForm: true }>,
  coreNouns: readonly string[] = CORE_ENGINE_NOUNS_DEFAULT,
): string[] {
  const isCoreOrPlugin = (noun: string): boolean =>
    noun === ENGINE_PLUGIN_NOUN || coreNouns.includes(noun)
  const added = analysis.added.filter(n => !isCoreOrPlugin(n))
  const replaced = analysis.added.filter(isCoreOrPlugin)
  const addedUnlessThere = analysis.addedUnlessThere
  const withheld =
    analysis.withheld === 'everything'
      ? ['everything beneath it']
      : analysis.withheld.filter(n => n !== ENGINE_PLUGIN_NOUN)

  return [
    ...(added.length > 0 || addedUnlessThere.length > 0
      ? wrapNounLines('adds to $', added)
      : ['adds to $: nothing']),
    ...wrapNounLines("adds to $ unless it's there", addedUnlessThere),
    ...(withheld.length > 0
      ? wrapNounLines('withholds from $', withheld, USER_TIER_WITHHOLD_SUFFIX)
      : ['withholds from $: nothing']),
    ...wrapNounLines('replaces on $', replaced, REPLACE_REFUSE_SUFFIX),
  ]
}

export type HooksModuleTypeCheckResult = {
  files: Array<{
    filePath: string
    warnings: ValidationError[]
  }>
  warnings: ValidationError[]
  notes: string[]
}

/**
 * Official 2.1.323 #1966: TypeScript type-checking of a plugin's `.ts`/`.tsx`
 * hooks module for `claude plugin validate`. Findings are emitted as warnings
 * so plain validate warns while `--strict` fails on them.
 */
export function typeCheckPluginHooksModule(options: {
  pluginRoot: string
  moduleSpec: string
  entryPath: string
  dependencies?: unknown
}): HooksModuleTypeCheckResult {
  const { pluginRoot, moduleSpec, entryPath, dependencies } = options
  const ext = path.extname(entryPath).toLowerCase()
  if (!TS_EXTENSIONS.has(ext)) {
    return { files: [], warnings: [], notes: [] }
  }

  if (dependencies !== undefined) {
    if (!Array.isArray(dependencies)) {
      return {
        files: [],
        warnings: [],
        notes: [
          `[${moduleSpec}] types: not checked (the manifest's dependencies are not a list of plugins, so the contracts the mod is typed against are not known)`,
        ],
      }
    }
    if (dependencies.length > 0) {
      return {
        files: [],
        warnings: [],
        notes: [
          `[${moduleSpec}] types: not checked (the mod names dependencies, whose contracts are laid as links out of the mod's folder; validate reads nothing outside it)`,
        ],
      }
    }
  }

  const ts = loadTypeScript()
  if (!ts) {
    return {
      files: [],
      warnings: [
        {
          path: `modules.${moduleSpec}`,
          message: 'not type-checked: this runtime cannot run the check',
        },
      ],
      notes: [],
    }
  }

  const resolvedRoot = path.resolve(pluginRoot)
  const resolvedEntry = path.resolve(entryPath)
  const rootPrefix = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`

  const isInsidePluginRoot = (filePath: string): boolean => {
    const resolved = path.resolve(filePath)
    return resolved === resolvedRoot || resolved.startsWith(rootPrefix)
  }

  // Collect ambient `.claude-plugin/types/*.d.ts` if present inside the plugin folder
  const rootFiles = [resolvedEntry]
  const typesDir = path.join(resolvedRoot, '.claude-plugin', 'types')
  try {
    for (const name of fs.readdirSync(typesDir)) {
      if (name.endsWith('.d.ts')) {
        rootFiles.push(path.join(typesDir, name))
      }
    }
  } catch {
    // No generated types directory — check the module standalone
  }

  const compilerOptions: TS.CompilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    allowJs: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    types: [],
  }

  const host = ts.createCompilerHost(compilerOptions)
  const origFileExists = host.fileExists.bind(host)
  const origReadFile = host.readFile.bind(host)
  const tsLibDir = path.dirname(ts.getDefaultLibFilePath(compilerOptions))

  const isAllowedRead = (fileName: string): boolean => {
    const resolved = path.resolve(fileName)
    return (
      isInsidePluginRoot(resolved) ||
      resolved.startsWith(tsLibDir + path.sep) ||
      resolved === ts.getDefaultLibFilePath(compilerOptions)
    )
  }

  host.fileExists = fileName =>
    isAllowedRead(fileName) && origFileExists(fileName)
  host.readFile = fileName =>
    isAllowedRead(fileName) ? origReadFile(fileName) : undefined

  try {
    const program = ts.createProgram(rootFiles, compilerOptions, host)
    const diagnostics = [
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ]

    const byFile = new Map<string, ValidationError[]>()
    const unlocated: ValidationError[] = []

    for (const diag of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n')
      if (diag.file && diag.start !== undefined) {
        if (!isInsidePluginRoot(diag.file.fileName)) continue
        const pos = diag.file.getLineAndCharacterOfPosition(diag.start)
        const filePath = path.resolve(diag.file.fileName)
        const list = byFile.get(filePath) ?? []
        list.push({
          path: `line ${pos.line + 1}, column ${pos.character + 1}`,
          message,
        })
        byFile.set(filePath, list)
      } else {
        unlocated.push({
          path: `modules.${moduleSpec}`,
          message,
        })
      }
    }

    return {
      files: [...byFile.entries()].map(([filePath, warnings]) => ({
        filePath,
        warnings,
      })),
      warnings: unlocated,
      notes: [],
    }
  } catch (err) {
    return {
      files: [],
      warnings: [
        {
          path: `modules.${moduleSpec}`,
          message: `not type-checked: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      notes: [],
    }
  }
}

/**
 * Code Mode script transformation & step-budget instrumentation (E3-P1-1 / E3-P2-6).
 *
 * Transforms scripts so top-level declarations persist across turns, marks
 * script-authored `{ raw: ... }` literals, rejects static imports and reserved
 * internal identifiers, instruments all loops/functions/arrows/methods with
 * step-budget checks, and wraps the transformed output in a randomized closure
 * so helpers are never exposed on `sandbox`/`self` or shadowable by user code.
 */
import {
  canPrecedeRegexLiteral,
  collectDestructuringBindings,
  findMatchingDelimiter,
  findSingleStatementEnd,
  findTopLevelSemicolons,
  isPrecededByMemberDot,
  scanRegexLiteralEnd,
  scanStringLiteralEnd,
  skipWsAndComments,
  splitTopLevelCommas,
  stripJsCommentsAndStrings,
} from './jsSourceAnalysis.js'

let cachedReplTranspiler:
  | { transformSync: (code: string) => string }
  | null
  | undefined

function getReplTranspiler(): {
  transformSync: (code: string) => string
} | null {
  if (cachedReplTranspiler !== undefined) return cachedReplTranspiler
  const bunGlobal = (
    globalThis as unknown as {
      Bun?: {
        Transpiler?: new (opts: {
          loader: string
          replMode: boolean
          macro: boolean
        }) => { transformSync: (code: string) => string }
      }
    }
  ).Bun
  if (typeof bunGlobal?.Transpiler === 'function') {
    cachedReplTranspiler = new bunGlobal.Transpiler({
      loader: 'js',
      replMode: true,
      macro: false,
    })
  } else {
    cachedReplTranspiler = null
  }
  return cachedReplTranspiler
}

const CONTINUATION_PREV_KEYWORD_RE =
  /(?:^|[^A-Za-z0-9_$])(?:await|yield|typeof|void|delete|new|in|instanceof|of|return|throw|async)$/

const OBJECT_LITERAL_PREV_KEYWORD_RE =
  /(?:^|[^A-Za-z0-9_$])(?:return|yield|await|throw|of|in|typeof|void|delete|new|case)$/

function findArrowExpressionBodyEnd(code: string, start: number): number {
  let depthParen = 0
  let depthBracket = 0
  let depthCurly = 0
  let ternaryDepth = 0
  let i = start
  const len = code.length
  let emitted = ''
  const templateBraceDepths: number[] = []
  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)

  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]

    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      emitted += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      i = scanStringLiteralEnd(code, i)
      emitted += '""'
      continue
    }
    if (ch === '`') {
      i++
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          break
        }
        if (code[i] === '`') {
          i++
          break
        }
        i++
      }
      emitted += '""'
      continue
    }
    if (templateBraceDepths.length > 0) {
      if (ch === '{') {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
        emitted += ch
        i++
        continue
      }
      if (ch === '}') {
        const td = templateBraceDepths[templateBraceDepths.length - 1]!
        if (td === 0) {
          templateBraceDepths.pop()
          i++
          while (i < len) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            if (code[i] === '$' && code[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              break
            }
            if (code[i] === '`') {
              i++
              break
            }
            i++
          }
          emitted += '""'
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = td - 1
        emitted += ch
        i++
        continue
      }
    }
    if (ch === '/' && canPrecedeRegexLiteral(emitted)) {
      i = scanRegexLiteralEnd(code, i)
      emitted += '""'
      continue
    }

    const atTopLevel =
      depthParen === 0 &&
      depthBracket === 0 &&
      depthCurly === 0 &&
      templateBraceDepths.length === 0

    if (atTopLevel) {
      if (ch === ',' || ch === ';' || ch === ')' || ch === ']' || ch === '}') {
        return i
      }
      if (ch === '?') {
        if (next === '?') {
          emitted += '??'
          i += 2
          continue
        }
        if (next === '.' && !/[0-9]/.test(code[i + 2] ?? '')) {
          emitted += '?.'
          i += 2
          continue
        }
        ternaryDepth++
        emitted += ch
        i++
        continue
      }
      if (ch === ':') {
        if (ternaryDepth > 0) {
          ternaryDepth--
          emitted += ch
          i++
          continue
        }
        return i
      }
      if (ch === '\n' || ch === '\r') {
        const prevTrim = emitted.trimEnd()
        const lastChar = prevTrim[prevTrim.length - 1] ?? ''
        const prevTwo = prevTrim.slice(-2)
        const prevExpectsRhs =
          prevTwo === '=>' ||
          prevTwo === '&&' ||
          prevTwo === '||' ||
          prevTwo === '??' ||
          prevTwo === '?.' ||
          (lastChar === '+' && prevTwo !== '++') ||
          (lastChar === '-' && prevTwo !== '--') ||
          '=:?.*/%<>&|^!~'.includes(lastChar) ||
          CONTINUATION_PREV_KEYWORD_RE.test(prevTrim)
        if (!prevExpectsRhs) {
          const nextTok = skipWsAndComments(code, i)
          if (nextTok >= len) return i
          const nc = code[nextTok]!
          const nc2 = code[nextTok + 1] ?? ''
          const nextContinues =
            (nc === '.' && code.slice(nextTok, nextTok + 3) !== '...') ||
            nc === '?' ||
            (nc === ':' && ternaryDepth > 0) ||
            (nc === '&' && nc2 === '&') ||
            (nc === '|' && nc2 === '|') ||
            (nc === '=' && nc2 === '=') ||
            (nc === '!' && nc2 === '=') ||
            (nc === '+' && nc2 !== '+') ||
            (nc === '-' && nc2 !== '-') ||
            '*%/<>^&|'.includes(nc) ||
            (code.slice(nextTok, nextTok + 10) === 'instanceof' &&
              !isIdentPart(code[nextTok + 10] ?? '')) ||
            (code.slice(nextTok, nextTok + 2) === 'in' &&
              !isIdentPart(code[nextTok + 2] ?? ''))
          if (!nextContinues) {
            return i
          }
        }
        emitted += ' '
        i++
        continue
      }
    }

    if (ch === '(') depthParen++
    else if (ch === ')') depthParen--
    else if (ch === '[') depthBracket++
    else if (ch === ']') depthBracket--
    else if (ch === '{') depthCurly++
    else if (ch === '}') depthCurly--

    emitted += ch
    i++
  }
  return len
}

type BraceContainerEntry = {
  kind: 'class' | 'object' | 'block' | 'template'
  parenDepth: number
  bracketDepth: number
  ternaryDepth: number
}

function isObjectLiteralOpenBrace(
  out: string,
  braceKindStack: readonly BraceContainerEntry[],
  lastColonWasTernary: boolean,
): boolean {
  let prevIdx = out.length - 1
  while (prevIdx >= 0 && /\s/.test(out[prevIdx]!)) prevIdx--
  if (prevIdx < 0) return false
  const prevChar = out[prevIdx]!
  const top = braceKindStack[braceKindStack.length - 1]
  if (prevChar === ':') {
    return lastColonWasTernary || top?.kind === 'object'
  }
  if (prevChar === '{') {
    // Inside template interpolation `${ ... }`, an opening `{` right after `${`
    // starts an object literal expression (e.g. `${ { m() {} } }`).
    return top?.kind === 'template' && out[prevIdx - 1] === '$'
  }
  if (prevChar === '>' && out[prevIdx - 1] === '=') {
    return false
  }
  if ('([,=?+-*/%&|^~!<>'.includes(prevChar)) {
    return true
  }
  if (/[A-Za-z0-9_$]/.test(prevChar)) {
    let start = prevIdx
    while (start > 0 && /[A-Za-z0-9_$]/.test(out[start - 1]!)) start--
    if (isPrecededByMemberDot(out, start)) return false
    const slice = out.slice(Math.max(0, start - 1), prevIdx + 1)
    return OBJECT_LITERAL_PREV_KEYWORD_RE.test(slice)
  }
  return false
}

/**
 * Official 2.1.328 (`ua`) + E3-P1-1: instrument `for`, `for await`, `while`,
 * `do` loops, `function` declarations/expressions, block-body and
 * expression-body arrow functions, object/class shorthand methods, and
 * getters/setters with `checkBudgetName()` so synchronous and microtask spin
 * loops AFTER an `await` terminate cleanly within the script's step/time budget.
 * Safely skips strings, template literal text, comments, and regex literals.
 */
export function instrumentCodeModeLoops(
  source: string,
  checkBudgetName = '__checkBudget',
): string {
  let out = ''
  let i = 0
  const len = source.length
  let braceDepth = 0
  let parenDepth = 0
  let bracketDepth = 0
  let ternaryDepth = 0
  let lastColonWasTernary = false
  const braceKindStack: BraceContainerEntry[] = []
  const classHeritageStack: Array<{
    braceDepth: number
    parenDepth: number
    bracketDepth: number
  }> = []
  const doBlockBraceDepths: number[] = []
  const doSingleStmtDepths: number[] = []
  let expectDoWhileTail = false

  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)
  const hasMatchingClassHeritage = (): boolean => {
    const top = classHeritageStack[classHeritageStack.length - 1]
    return (
      top !== undefined &&
      top.braceDepth === braceDepth &&
      top.parenDepth === parenDepth &&
      top.bracketDepth === bracketDepth
    )
  }

  while (i < len) {
    const ch = source[i]!
    const next = source[i + 1]

    // Line comment
    if (ch === '/' && next === '/') {
      const start = i
      i += 2
      while (i < len && source[i] !== '\n') i++
      out += source.slice(start, i)
      continue
    }
    // Block comment
    if (ch === '/' && next === '*') {
      const start = i
      i += 2
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      out += source.slice(start, i)
      continue
    }
    // Quoted string
    if (ch === "'" || ch === '"') {
      const end = scanStringLiteralEnd(source, i)
      out += source.slice(i, end)
      i = end
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }
    // Template literal
    if (ch === '`') {
      const start = i
      i++
      while (i < len) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2
          braceKindStack.push({
            kind: 'template',
            parenDepth,
            bracketDepth,
            ternaryDepth,
          })
          braceDepth++
          break
        }
        if (source[i] === '`') {
          i++
          break
        }
        i++
      }
      out += source.slice(start, i)
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }
    // Regex literal
    if (ch === '/' && canPrecedeRegexLiteral(out)) {
      const end = scanRegexLiteralEnd(source, i)
      out += source.slice(i, end)
      i = end
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }

    if (/\s/.test(ch)) {
      out += ch
      i++
      continue
    }

    if (ch === '?') {
      if (next === '?') {
        out += '??'
        i += 2
        expectDoWhileTail = false
        lastColonWasTernary = false
        continue
      }
      if (next === '.' && !/[0-9]/.test(source[i + 2] ?? '')) {
        out += '?.'
        i += 2
        expectDoWhileTail = false
        lastColonWasTernary = false
        continue
      }
      ternaryDepth++
      out += ch
      i++
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }
    if (ch === ':') {
      const top = braceKindStack[braceKindStack.length - 1]
      const isObjPropColon =
        top?.kind === 'object' &&
        parenDepth === top.parenDepth &&
        bracketDepth === top.bracketDepth &&
        ternaryDepth === top.ternaryDepth
      if (!isObjPropColon && ternaryDepth > (top?.ternaryDepth ?? 0)) {
        ternaryDepth--
        lastColonWasTernary = true
      } else {
        lastColonWasTernary = false
      }
      out += ch
      i++
      expectDoWhileTail = false
      continue
    }

    // Object/class shorthand methods, getters, setters, constructors, #private, [computed](), "str"()
    if (ch === '(') {
      const topContainer = braceKindStack[braceKindStack.length - 1]
      if (
        topContainer !== undefined &&
        (topContainer.kind === 'class' || topContainer.kind === 'object') &&
        parenDepth === topContainer.parenDepth &&
        bracketDepth === topContainer.bracketDepth &&
        !hasMatchingClassHeritage()
      ) {
        const closeParen = findMatchingDelimiter(source, i, '(', ')')
        if (closeParen !== -1) {
          const bodyIdx = skipWsAndComments(source, closeParen + 1)
          if (source[bodyIdx] === '{') {
            const paramInner = source.slice(i + 1, closeParen)
            braceKindStack.push({
              kind: 'block',
              parenDepth,
              bracketDepth,
              ternaryDepth,
            })
            braceDepth++
            out += `(${instrumentCodeModeLoops(paramInner, checkBudgetName)})${source.slice(closeParen + 1, bodyIdx)}{ ${checkBudgetName}(); `
            i = bodyIdx + 1
            expectDoWhileTail = false
            lastColonWasTernary = false
            continue
          }
        }
      }
      parenDepth++
      out += ch
      i++
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1)
      out += ch
      i++
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }
    if (ch === '[') {
      bracketDepth++
      out += ch
      i++
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }
    if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
      out += ch
      i++
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }

    if (ch === '{') {
      let kind: BraceContainerEntry['kind']
      if (hasMatchingClassHeritage()) {
        classHeritageStack.pop()
        kind = 'class'
      } else if (
        isObjectLiteralOpenBrace(out, braceKindStack, lastColonWasTernary)
      ) {
        kind = 'object'
      } else {
        kind = 'block'
      }
      braceKindStack.push({ kind, parenDepth, bracketDepth, ternaryDepth })
      braceDepth++
      out += ch
      i++
      expectDoWhileTail = false
      lastColonWasTernary = false
      continue
    }
    if (ch === '}') {
      const closed = braceKindStack.pop()
      braceDepth = Math.max(0, braceDepth - 1)
      lastColonWasTernary = false
      if (closed?.kind === 'template') {
        const resumeStart = i
        i++
        while (i < len) {
          if (source[i] === '\\') {
            i += 2
            continue
          }
          if (source[i] === '$' && source[i + 1] === '{') {
            i += 2
            braceKindStack.push({
              kind: 'template',
              parenDepth,
              bracketDepth,
              ternaryDepth,
            })
            braceDepth++
            break
          }
          if (source[i] === '`') {
            i++
            break
          }
          i++
        }
        out += source.slice(resumeStart, i)
        expectDoWhileTail = false
        continue
      }
      out += ch
      i++
      if (
        doBlockBraceDepths.length > 0 &&
        doBlockBraceDepths[doBlockBraceDepths.length - 1] === braceDepth
      ) {
        doBlockBraceDepths.pop()
        expectDoWhileTail = true
      } else {
        expectDoWhileTail = false
      }
      continue
    }

    if (isIdentStart(ch)) {
      const idStart = i
      i++
      while (i < len && isIdentPart(source[i]!)) i++
      const word = source.slice(idStart, i)
      const precededByDot = isPrecededByMemberDot(out, out.length)
      const afterWs = skipWsAndComments(source, i)
      const isObjectKey = source[afterWs] === ':'
      lastColonWasTernary = false

      if (
        !precededByDot &&
        !isObjectKey &&
        word === 'class' &&
        source[afterWs] !== '('
      ) {
        classHeritageStack.push({ braceDepth, parenDepth, bracketDepth })
        expectDoWhileTail = false
        out += word
        continue
      }

      if (!precededByDot && !isObjectKey && word === 'do') {
        expectDoWhileTail = false
        if (source[afterWs] === '{') {
          doBlockBraceDepths.push(braceDepth)
          braceKindStack.push({
            kind: 'block',
            parenDepth,
            bracketDepth,
            ternaryDepth,
          })
          braceDepth++
          out += `${word}${source.slice(i, afterWs)}{ ${checkBudgetName}(); `
          i = afterWs + 1
          continue
        }
        // Single-statement `do stmt; while (cond)` — guard on the matching `while`
        doSingleStmtDepths.push(braceDepth)
        out += word
        continue
      }

      if (!precededByDot && !isObjectKey && word === 'while') {
        const isDoBlockTail = expectDoWhileTail
        expectDoWhileTail = false
        const isDoSingleTail =
          !isDoBlockTail &&
          doSingleStmtDepths.length > 0 &&
          doSingleStmtDepths[doSingleStmtDepths.length - 1] === braceDepth

        if (source[afterWs] === '(') {
          const closeParen = findMatchingDelimiter(source, afterWs, '(', ')')
          if (closeParen !== -1) {
            const condInner = source.slice(afterWs + 1, closeParen)
            const instrCond = instrumentCodeModeLoops(
              condInner,
              checkBudgetName,
            )
            if (isDoBlockTail) {
              out += `${word}${source.slice(i, afterWs)}(${instrCond})`
              i = closeParen + 1
              continue
            }
            if (isDoSingleTail) {
              doSingleStmtDepths.pop()
              out += `${word}${source.slice(i, afterWs)}((${checkBudgetName}(), (${instrCond})))`
              i = closeParen + 1
              continue
            }
            const bodyIdx = skipWsAndComments(source, closeParen + 1)
            const between = source.slice(closeParen + 1, bodyIdx)
            if (source[bodyIdx] === '{') {
              braceKindStack.push({
                kind: 'block',
                parenDepth,
                bracketDepth,
                ternaryDepth,
              })
              braceDepth++
              out += `${word}${source.slice(i, afterWs)}(${instrCond})${between}{ ${checkBudgetName}(); `
              i = bodyIdx + 1
              continue
            }
            if (source[bodyIdx] === ';') {
              out += `${word}${source.slice(i, afterWs)}(${instrCond})${between}{ ${checkBudgetName}(); }`
              i = bodyIdx + 1
              continue
            }
            // Single-statement `while (cond) stmt`
            out += `${word}${source.slice(i, afterWs)}((${checkBudgetName}(), (${instrCond})))`
            i = closeParen + 1
            continue
          }
        }
        out += word
        continue
      }

      if (!precededByDot && !isObjectKey && word === 'for') {
        expectDoWhileTail = false
        let headerStart = afterWs
        if (
          source.slice(headerStart, headerStart + 5) === 'await' &&
          !isIdentPart(source[headerStart + 5] ?? '')
        ) {
          headerStart = skipWsAndComments(source, headerStart + 5)
        }
        if (source[headerStart] === '(') {
          const closeParen = findMatchingDelimiter(
            source,
            headerStart,
            '(',
            ')',
          )
          if (closeParen !== -1) {
            const prefixBeforeParen = source.slice(i, headerStart)
            const headerInner = source.slice(headerStart + 1, closeParen)
            const bodyIdx = skipWsAndComments(source, closeParen + 1)
            const between = source.slice(closeParen + 1, bodyIdx)
            if (source[bodyIdx] === '{') {
              braceKindStack.push({
                kind: 'block',
                parenDepth,
                bracketDepth,
                ternaryDepth,
              })
              braceDepth++
              out += `${word}${prefixBeforeParen}(${instrumentCodeModeLoops(headerInner, checkBudgetName)})${between}{ ${checkBudgetName}(); `
              i = bodyIdx + 1
              continue
            }
            if (source[bodyIdx] === ';') {
              out += `${word}${prefixBeforeParen}(${instrumentCodeModeLoops(headerInner, checkBudgetName)})${between}{ ${checkBudgetName}(); }`
              i = bodyIdx + 1
              continue
            }
            const semis = findTopLevelSemicolons(headerInner)
            if (semis.length === 2) {
              const initPart = instrumentCodeModeLoops(
                headerInner.slice(0, semis[0]!),
                checkBudgetName,
              )
              const rawTest = headerInner.slice(semis[0]! + 1, semis[1]!).trim()
              const updatePart = instrumentCodeModeLoops(
                headerInner.slice(semis[1]! + 1),
                checkBudgetName,
              )
              const guardedTest =
                rawTest.length > 0
                  ? `(${checkBudgetName}(), (${instrumentCodeModeLoops(rawTest, checkBudgetName)}))`
                  : `(${checkBudgetName}(), true)`
              out += `${word}${prefixBeforeParen}(${initPart}; ${guardedTest}; ${updatePart})`
              i = closeParen + 1
              continue
            }
            // Single-statement `for (x of y) stmt` / `for (k in obj) stmt`
            const stmtEnd = findSingleStatementEnd(source, bodyIdx)
            const stmtText = source.slice(bodyIdx, stmtEnd)
            out += `${word}${prefixBeforeParen}(${instrumentCodeModeLoops(headerInner, checkBudgetName)})${between}{ ${checkBudgetName}(); ${instrumentCodeModeLoops(stmtText, checkBudgetName)} }`
            i = stmtEnd
            continue
          }
        }
        out += word
        continue
      }

      if (!precededByDot && !isObjectKey && word === 'function') {
        expectDoWhileTail = false
        let scan = afterWs
        if (source[scan] === '*') {
          scan = skipWsAndComments(source, scan + 1)
        }
        if (scan < len && isIdentStart(source[scan]!)) {
          scan++
          while (scan < len && isIdentPart(source[scan]!)) scan++
          scan = skipWsAndComments(source, scan)
        }
        if (source[scan] === '(') {
          const closeParen = findMatchingDelimiter(source, scan, '(', ')')
          if (closeParen !== -1) {
            const bodyIdx = skipWsAndComments(source, closeParen + 1)
            if (source[bodyIdx] === '{') {
              braceKindStack.push({
                kind: 'block',
                parenDepth,
                bracketDepth,
                ternaryDepth,
              })
              braceDepth++
              const paramInner = source.slice(scan + 1, closeParen)
              out += `${word}${source.slice(i, scan)}(${instrumentCodeModeLoops(paramInner, checkBudgetName)})${source.slice(closeParen + 1, bodyIdx)}{ ${checkBudgetName}(); `
              i = bodyIdx + 1
              continue
            }
          }
        }
        out += word
        continue
      }

      expectDoWhileTail = false
      out += word
      continue
    }

    // Arrow function block body (`=> {`) and expression body (`=> expr`)
    if (ch === '=' && next === '>') {
      expectDoWhileTail = false
      lastColonWasTernary = false
      const afterArrow = skipWsAndComments(source, i + 2)
      if (source[afterArrow] === '{') {
        braceKindStack.push({
          kind: 'block',
          parenDepth,
          bracketDepth,
          ternaryDepth,
        })
        braceDepth++
        out += `${source.slice(i, afterArrow)}{ ${checkBudgetName}(); `
        i = afterArrow + 1
        continue
      }
      const exprEnd = findArrowExpressionBodyEnd(source, afterArrow)
      const exprText = source.slice(afterArrow, exprEnd)
      if (exprText.trim().length > 0) {
        const instrExpr = instrumentCodeModeLoops(exprText, checkBudgetName)
        out += `${source.slice(i, afterArrow)}(${checkBudgetName}(), (${instrExpr}))`
        i = exprEnd
        continue
      }
      out += '=>'
      i += 2
      continue
    }

    expectDoWhileTail = false
    lastColonWasTernary = false
    out += ch
    i++
  }

  return out
}

/**
 * Official 2.1.328 (`zc`/`fr`): wrap single-key `{ raw: expr }` object literals
 * written directly in script source with `__markRawLiteral({ raw: expr })` so
 * `$` can distinguish script-authored `{ raw }` literals from external/parsed
 * objects or mutated literals.
 */
export function markCodeModeRawLiterals(
  source: string,
  markerName = '__markRawLiteral',
): string {
  let out = ''
  let i = 0
  const len = source.length
  const templateBraceDepths: number[] = []

  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)

  while (i < len) {
    const ch = source[i]!
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      const start = i
      i += 2
      while (i < len && source[i] !== '\n') i++
      out += source.slice(start, i)
      continue
    }
    if (ch === '/' && next === '*') {
      const start = i
      i += 2
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      out += source.slice(start, i)
      continue
    }
    if (ch === "'" || ch === '"') {
      const end = scanStringLiteralEnd(source, i)
      out += source.slice(i, end)
      i = end
      continue
    }
    if (ch === '`') {
      const start = i
      i++
      while (i < len) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          break
        }
        if (source[i] === '`') {
          i++
          break
        }
        i++
      }
      out += source.slice(start, i)
      continue
    }
    if (templateBraceDepths.length > 0 && ch === '}') {
      const td = templateBraceDepths[templateBraceDepths.length - 1]!
      if (td === 0) {
        templateBraceDepths.pop()
        const resumeStart = i
        i++
        while (i < len) {
          if (source[i] === '\\') {
            i += 2
            continue
          }
          if (source[i] === '$' && source[i + 1] === '{') {
            i += 2
            templateBraceDepths.push(0)
            break
          }
          if (source[i] === '`') {
            i++
            break
          }
          i++
        }
        out += source.slice(resumeStart, i)
        continue
      }
      templateBraceDepths[templateBraceDepths.length - 1] = td - 1
      out += ch
      i++
      continue
    }
    if (ch === '/' && canPrecedeRegexLiteral(out)) {
      const end = scanRegexLiteralEnd(source, i)
      out += source.slice(i, end)
      i = end
      continue
    }

    if (ch === '{') {
      const closeIdx = findMatchingDelimiter(source, i, '{', '}')
      if (closeIdx !== -1) {
        const inner = source.slice(i + 1, closeIdx)
        const keyStart = skipWsAndComments(inner, 0)
        // Check if object literal has a single `raw` key: `{ raw: expr }` (with optional trailing comma)
        if (
          inner.slice(keyStart, keyStart + 3) === 'raw' &&
          !isIdentPart(inner[keyStart + 3] ?? '')
        ) {
          const afterKey = skipWsAndComments(inner, keyStart + 3)
          if (inner[afterKey] === ':') {
            const parts = splitTopLevelCommas(inner).filter(
              p => p.trim().length > 0,
            )
            if (parts.length === 1) {
              // Ensure `{` is in an expression position (e.g. after `(`, `,`, `=`, `:`, `[`, `?`, `return`, `${`, etc.)
              let prevIdx = out.length - 1
              while (prevIdx >= 0 && /\s/.test(out[prevIdx]!)) prevIdx--
              const prevChar = prevIdx >= 0 ? out[prevIdx]! : ''
              const isExprPos =
                prevChar === '' ||
                '([,=?:!+-*/%&|^~{'.includes(prevChar) ||
                (prevChar === '>' && out[prevIdx - 1] === '=') ||
                /\b(?:return|yield|await|throw|of|in)$/.test(
                  out.slice(Math.max(0, prevIdx - 10), prevIdx + 1),
                )
              if (isExprPos) {
                const valueExpr = inner.slice(afterKey + 1)
                out += `${markerName}({ raw:${markCodeModeRawLiterals(valueExpr, markerName)}})`
                i = closeIdx + 1
                continue
              }
            }
          }
        }
      }
      if (templateBraceDepths.length > 0) {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
      }
      out += ch
      i++
      continue
    }

    out += ch
    i++
  }

  return out
}

const STATIC_IMPORT_RE =
  /(?:^|[;\n])\s*import\s+(?:[\s\S]*?\s+from\s+['"]|['"])/
const DYNAMIC_IMPORT_RE = /(?<![A-Za-z0-9_$.])import\s*(?:\(|\.\s*meta\b)/

function rejectStaticImports(code: string): void {
  const stripped = stripJsCommentsAndStrings(code)
  if (STATIC_IMPORT_RE.test(stripped)) {
    throw new SyntaxError(
      'Code Mode scripts cannot use `import` statements; use the provided global tools and helpers instead.',
    )
  }
  if (DYNAMIC_IMPORT_RE.test(stripped)) {
    throw new SyntaxError(
      'Dynamic import() is not allowed in Code Mode scripts',
    )
  }
}

type AsyncFunctionCtor = new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>

const AsyncFunctionCtorRef = Object.getPrototypeOf(async () => {})
  .constructor as AsyncFunctionCtor

/**
 * Security (P0-4): Validate `body` against the JS engine's strict
 * `AsyncFunctionBody` grammar goal (ECMA-262 §20.2.1.1.1). Because the engine
 * parses `body` directly as an `AsyncFunctionBody` (never concatenating it into
 * a wrapper string), closing-brace breakout payloads like
 * `})(); globalThis.pwned = 1; (async () => {` ALWAYS throw a `SyntaxError`.
 * The constructed function is immediately discarded and never invoked.
 */
function assertValidAsyncFunctionBody(body: string): void {
  void new AsyncFunctionCtorRef(body)
}

function isValidAsyncFunctionBody(body: string): boolean {
  try {
    assertValidAsyncFunctionBody(body)
    return true
  } catch {
    return false
  }
}

/**
 * Verify that `expr` parses as a single expression under three distinct
 * delimiter contexts `( )`, `[ ]`, and `{ __k: ... }` so no unmatched closing
 * delimiter can break out of any single wrapper.
 */
function isValidSingleExpression(expr: string): boolean {
  try {
    void new AsyncFunctionCtorRef(`return (\n${expr}\n)`)
    void new AsyncFunctionCtorRef(`return [\n${expr}\n]`)
    void new AsyncFunctionCtorRef(`return {\n__k:\n${expr}\n}`)
    return true
  } catch {
    return false
  }
}

/**
 * Fallback transform when a script combines top-level `return` with `await`
 * (which `Bun.Transpiler({ replMode: true })` rejects as ESM top-level return)
 * or when running under a non-Bun runtime. Hoists top-level declarations to
 * `var` outside `(async () => { ... })()` so bindings persist across turns.
 */
function transformWithTopLevelHoistAndAsyncIife(code: string): string {
  // Security (P0-4): Validate syntax with the real JS parser BEFORE wrapping so
  // closing-brace breakouts are structurally impossible.
  if (!isValidAsyncFunctionBody(code)) {
    if (code.trimStart().startsWith('{') && isValidSingleExpression(code)) {
      return `(async () => {\nreturn (\n${code}\n);\n})()`
    }
    assertValidAsyncFunctionBody(code)
  }

  const hoisted = new Set<string>()
  const parts: string[] = []
  let i = 0
  const len = code.length
  let braceDepth = 0
  let parenDepth = 0
  let bracketDepth = 0
  let emitted = ''
  const templateBraceDepths: number[] = []
  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)
  const isAtTopLevel = () =>
    braceDepth === 0 &&
    parenDepth === 0 &&
    bracketDepth === 0 &&
    templateBraceDepths.length === 0

  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      const start = i
      i += 2
      while (i < len && code[i] !== '\n') i++
      parts.push(code.slice(start, i))
      emitted += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      const start = i
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      parts.push(code.slice(start, i))
      emitted += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      const end = scanStringLiteralEnd(code, i)
      parts.push(code.slice(i, end))
      emitted += '""'
      i = end
      continue
    }
    if (ch === '`') {
      const start = i
      i++
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          break
        }
        if (code[i] === '`') {
          i++
          break
        }
        i++
      }
      parts.push(code.slice(start, i))
      emitted += ' '
      continue
    }
    if (templateBraceDepths.length > 0) {
      if (ch === '{') {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
        parts.push(ch)
        emitted += ch
        i++
        continue
      }
      if (ch === '}') {
        const td = templateBraceDepths[templateBraceDepths.length - 1]!
        if (td === 0) {
          templateBraceDepths.pop()
          const resumeStart = i
          i++
          while (i < len) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            if (code[i] === '$' && code[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              break
            }
            if (code[i] === '`') {
              i++
              break
            }
            i++
          }
          parts.push(code.slice(resumeStart, i))
          emitted += ')'
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = td - 1
        parts.push(ch)
        emitted += ch
        i++
        continue
      }
    }
    if (ch === '/' && canPrecedeRegexLiteral(emitted)) {
      const end = scanRegexLiteralEnd(code, i)
      parts.push(code.slice(i, end))
      emitted += '""'
      i = end
      continue
    }

    if (isAtTopLevel() && isIdentStart(ch)) {
      const idStart = i
      i++
      while (i < len && isIdentPart(code[i]!)) i++
      const word = code.slice(idStart, i)
      const afterWs = skipWsAndComments(code, i)

      if (
        (word === 'const' || word === 'let' || word === 'var') &&
        !isPrecededByMemberDot(emitted, emitted.length)
      ) {
        const targetChar = code[afterWs]
        if (targetChar && isIdentStart(targetChar)) {
          let nameEnd = afterWs + 1
          while (nameEnd < len && isIdentPart(code[nameEnd]!)) nameEnd++
          const varName = code.slice(afterWs, nameEnd)
          const eqIdx = skipWsAndComments(code, nameEnd)
          if (code[eqIdx] === '=' && code[eqIdx + 1] !== '=') {
            hoisted.add(varName)
            parts.push(varName)
            emitted += varName
            i = nameEnd
            continue
          }
          if (code[eqIdx] === ';' || code[eqIdx] === '\n' || eqIdx >= len) {
            hoisted.add(varName)
            i = nameEnd
            continue
          }
        } else if (targetChar === '{' || targetChar === '[') {
          const closeChar = targetChar === '{' ? '}' : ']'
          const closeIdx = findMatchingDelimiter(
            code,
            afterWs,
            targetChar,
            closeChar,
          )
          if (closeIdx !== -1) {
            const pattern = code.slice(afterWs, closeIdx + 1)
            const eqIdx = skipWsAndComments(code, closeIdx + 1)
            if (code[eqIdx] === '=' && code[eqIdx + 1] !== '=') {
              collectDestructuringBindings(
                stripJsCommentsAndStrings(pattern),
                targetChar === '{',
                hoisted,
              )
              const stmtEnd = findSingleStatementEnd(code, eqIdx + 1)
              const rhs = code.slice(eqIdx + 1, stmtEnd).replace(/;\s*$/, '')
              const wrapped = `(${pattern} = ${rhs});`
              parts.push(wrapped)
              emitted += wrapped
              i = stmtEnd
              continue
            }
          }
        }
      } else if (
        word === 'function' &&
        !isPrecededByMemberDot(emitted, emitted.length)
      ) {
        let fnNameStart = afterWs
        if (code[fnNameStart] === '*') {
          fnNameStart = skipWsAndComments(code, fnNameStart + 1)
        }
        if (fnNameStart < len && isIdentStart(code[fnNameStart]!)) {
          let fnNameEnd = fnNameStart + 1
          while (fnNameEnd < len && isIdentPart(code[fnNameEnd]!)) fnNameEnd++
          const fnName = code.slice(fnNameStart, fnNameEnd)
          hoisted.add(fnName)
          parts.push(`globalThis.${fnName} = ${fnName}; ${word}`)
          emitted += word
          continue
        }
      } else if (
        word === 'async' &&
        !isPrecededByMemberDot(emitted, emitted.length) &&
        code.slice(afterWs, afterWs + 8) === 'function' &&
        !isIdentPart(code[afterWs + 8] ?? '')
      ) {
        let fnNameStart = skipWsAndComments(code, afterWs + 8)
        if (code[fnNameStart] === '*') {
          fnNameStart = skipWsAndComments(code, fnNameStart + 1)
        }
        if (fnNameStart < len && isIdentStart(code[fnNameStart]!)) {
          let fnNameEnd = fnNameStart + 1
          while (fnNameEnd < len && isIdentPart(code[fnNameEnd]!)) fnNameEnd++
          const fnName = code.slice(fnNameStart, fnNameEnd)
          hoisted.add(fnName)
          parts.push(`globalThis.${fnName} = ${fnName}; ${word}`)
          emitted += word
          continue
        }
      } else if (
        word === 'class' &&
        !isPrecededByMemberDot(emitted, emitted.length) &&
        afterWs < len &&
        isIdentStart(code[afterWs]!)
      ) {
        let clsEnd = afterWs + 1
        while (clsEnd < len && isIdentPart(code[clsEnd]!)) clsEnd++
        const clsName = code.slice(afterWs, clsEnd)
        hoisted.add(clsName)
        parts.push(`${clsName} = class`)
        emitted += 'class'
        continue
      }

      parts.push(word)
      emitted += word
      continue
    }

    if (ch === '{') braceDepth++
    else if (ch === '}') {
      braceDepth--
      if (braceDepth < 0) {
        throw new SyntaxError('Unexpected token `}` in Code Mode script')
      }
    } else if (ch === '(') parenDepth++
    else if (ch === ')') {
      parenDepth--
      if (parenDepth < 0) {
        throw new SyntaxError('Unexpected token `)` in Code Mode script')
      }
    } else if (ch === '[') bracketDepth++
    else if (ch === ']') {
      bracketDepth--
      if (bracketDepth < 0) {
        throw new SyntaxError('Unexpected token `]` in Code Mode script')
      }
    }

    parts.push(ch)
    emitted += ch
    i++
  }

  if (
    braceDepth !== 0 ||
    parenDepth !== 0 ||
    bracketDepth !== 0 ||
    templateBraceDepths.length !== 0
  ) {
    throw new SyntaxError('Unbalanced delimiters in Code Mode script')
  }

  const body = parts.join('')
  assertValidAsyncFunctionBody(body)

  const varDecls = [...hoisted].map(name => `var ${name};`).join('\n')
  const prefix = varDecls ? `${varDecls}\n` : ''
  return `${prefix}(async () => {\n${body}\n})()`
}

export function rejectReservedInternalIdentifiers(
  code: string,
  reservedNames: readonly string[],
): void {
  const active = reservedNames.filter(n => n.length > 0)
  if (active.length === 0) return
  const stripped = stripJsCommentsAndStrings(code)
  for (const name of active) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![A-Za-z0-9_$.])${escaped}(?![A-Za-z0-9_$])`)
    if (re.test(stripped)) {
      throw new SyntaxError(
        `Code Mode scripts cannot declare or reference reserved internal identifier \`${name}\`.`,
      )
    }
  }
}

/**
 * Security (P0-4): Wrap a transformed script as a VM-realm factory arrow
 * function `((checkBudget, rawMarker) => (iifeExpr))` with zero `sandbox` /
 * `globalThis` init accessors. Validates `iifeExpr` as a single expression so
 * closing-paren/brace breakout is structurally impossible.
 */
export function wrapScriptWithClosureParams(
  transformed: string,
  checkBudgetName: string,
  rawLiteralMarkerName: string,
): string {
  const trimmed = transformed.trim()
  if (trimmed.length === 0) return ''
  const lines = trimmed.split('\n')
  let iifeStartLine = 0
  while (
    iifeStartLine < lines.length &&
    /^var\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)*;\s*$/.test(
      lines[iifeStartLine]!,
    )
  ) {
    iifeStartLine++
  }
  const varPrefix =
    iifeStartLine > 0 ? `${lines.slice(0, iifeStartLine).join('\n')}\n` : ''
  const iifeExpr = lines
    .slice(iifeStartLine)
    .join('\n')
    .trim()
    .replace(/;+\s*$/, '')
  if (iifeExpr.length === 0) return varPrefix
  if (!isValidSingleExpression(iifeExpr)) {
    throw new SyntaxError('Invalid Code Mode script expression')
  }
  return `${varPrefix}((${checkBudgetName}, ${rawLiteralMarkerName}) => (${iifeExpr}))`
}

/**
 * Official 2.1.328 (`jl`/`ep` + `ua`): transform a Code Mode script so
 * top-level `const`/`let`/`var`/`function`/`class` bindings persist onto the
 * VM context across turns and all loops/functions call `checkBudgetName()`.
 */
export function transformCodeModeScript(
  code: string,
  rawLiteralMarkerName = '__markRawLiteral',
  checkBudgetName = '__checkBudget',
): string {
  rejectStaticImports(code)
  rejectReservedInternalIdentifiers(code, [
    checkBudgetName,
    rawLiteralMarkerName,
  ])
  const rawMarked = markCodeModeRawLiterals(code, rawLiteralMarkerName)
  // Security (P0-4): Validate syntax with the real JS engine parser BEFORE
  // invoking any transpiler or fallback wrapper so unbalanced breakout payloads
  // (including `{ a: 1 }); evil(); ({ b: 2 }` which Bun.Transpiler replMode
  // would otherwise wrap in `(...)`) are always rejected upfront.
  if (
    !isValidAsyncFunctionBody(rawMarked) &&
    !(
      rawMarked.trimStart().startsWith('{') &&
      isValidSingleExpression(rawMarked)
    )
  ) {
    assertValidAsyncFunctionBody(rawMarked)
  }
  const transpiler = getReplTranspiler()
  let transformed: string
  if (transpiler) {
    try {
      transformed = transpiler.transformSync(rawMarked)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/top-level return/i.test(msg)) {
        transformed = transformWithTopLevelHoistAndAsyncIife(rawMarked)
      } else if (rawMarked.trimStart().startsWith('{')) {
        if (isValidSingleExpression(rawMarked)) {
          transformed = transpiler.transformSync(`(${rawMarked}\n)`)
        } else {
          assertValidAsyncFunctionBody(rawMarked)
          try {
            transformed = transpiler.transformSync(`;${rawMarked}`)
          } catch {
            transformed = transformWithTopLevelHoistAndAsyncIife(rawMarked)
          }
        }
      } else {
        throw err
      }
    }
  } else {
    transformed = transformWithTopLevelHoistAndAsyncIife(rawMarked)
  }
  return instrumentCodeModeLoops(transformed, checkBudgetName)
}

export function unwrapReplTransformValue(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    Object.getPrototypeOf(raw) === null &&
    Object.hasOwn(raw, 'value') &&
    Object.keys(raw).length === 1
  ) {
    return (raw as { value: unknown }).value
  }
  return raw
}

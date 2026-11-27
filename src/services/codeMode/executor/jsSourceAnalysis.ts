/**
 * JavaScript lexical scanning primitives and unset-variable analysis
 * (2.1.328 #576), shared by both unset-variable guard injection and the loop /
 * raw-literal script instrumentation pass.
 */
import { VALID_IDENTIFIER_RE } from './types.js'

/**
 * Official 2.1.328 (#576): Extract top-level declared variable names from a
 * script and inject guards in subsequent scripts so referencing a variable
 * that an earlier failed script never set throws instead of silently yielding
 * `undefined`.
 */
// True column-0 top-level declarations only (no leading whitespace, so indented
// block/function-local declarations are never mistaken for top-level bindings).
const TOP_LEVEL_DECL_RE =
  /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)(?![A-Za-z0-9_$])/gm

const PLAIN_ASSIGN_RE = /(?:^|;)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/gm

export function extractTopLevelDeclaredVars(code: string): string[] {
  const stripped = stripJsCommentsAndStrings(code)
  const vars = new Set<string>()
  for (const match of stripped.matchAll(TOP_LEVEL_DECL_RE)) {
    const name = match[1]
    if (name) vars.add(name)
  }
  return [...vars]
}

export function extractAssignedVars(code: string): string[] {
  const stripped = stripJsCommentsAndStrings(code)
  const vars = new Set<string>()
  for (const match of stripped.matchAll(PLAIN_ASSIGN_RE)) {
    const name = match[1]
    if (name) vars.add(name)
  }
  return [...vars]
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'case',
  'throw',
  'in',
  'instanceof',
  'typeof',
  'void',
  'delete',
  'new',
  'do',
  'else',
  'yield',
  'await',
  'of',
])

const PAREN_STATEMENT_KEYWORDS = new Set(['if', 'while', 'for', 'with'])

export function isPrecededByMemberDot(out: string, start: number): boolean {
  let k = start - 1
  while (k >= 0 && /\s/.test(out[k]!)) k--
  return k >= 0 && out[k] === '.'
}

export function canPrecedeRegexLiteral(out: string): boolean {
  let j = out.length - 1
  while (j >= 0 && /\s/.test(out[j]!)) j--
  if (j < 0) return true
  const prev = out[j]!
  if (
    (prev === '+' && out[j - 1] === '+') ||
    (prev === '-' && out[j - 1] === '-')
  ) {
    return false
  }
  if ('([{,;?:!~+-*/%^&|=<>'.includes(prev)) {
    return true
  }
  if (prev === ')') {
    let depth = 1
    let k = j - 1
    while (k >= 0 && depth > 0) {
      if (out[k] === ')') depth++
      else if (out[k] === '(') depth--
      k--
    }
    if (depth === 0) {
      while (k >= 0 && /\s/.test(out[k]!)) k--
      if (k >= 0 && /[A-Za-z0-9_$]/.test(out[k]!)) {
        let start = k
        while (start > 0 && /[A-Za-z0-9_$]/.test(out[start - 1]!)) start--
        if (!isPrecededByMemberDot(out, start)) {
          const word = out.slice(start, k + 1)
          if (PAREN_STATEMENT_KEYWORDS.has(word)) return true
        }
      }
    }
    return false
  }
  if (/[A-Za-z0-9_$]/.test(prev)) {
    let start = j
    while (start > 0 && /[A-Za-z0-9_$]/.test(out[start - 1]!)) start--
    if (isPrecededByMemberDot(out, start)) return false
    const word = out.slice(start, j + 1)
    return REGEX_PRECEDING_KEYWORDS.has(word)
  }
  return false
}

/**
 * Strip JS comments, regex literals, and string/template text (preserving
 * `${...}` interpolation expressions) so unset-var guard detection never fires
 * on strings, regexes, or comments.
 */
export function stripJsCommentsAndStrings(code: string): string {
  let out = ''
  const templateBraceDepths: number[] = []
  let i = 0
  const len = code.length
  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    // Line comment
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      out += ' '
      continue
    }
    // Block comment
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') out += '\n'
        i++
      }
      i += 2
      out += ' '
      continue
    }
    // Regex literal (disambiguated from division via preceding token)
    if (ch === '/' && canPrecedeRegexLiteral(out)) {
      i++
      let inCharClass = false
      while (i < len) {
        const rc = code[i]!
        if (rc === '\\') {
          i += 2
          continue
        }
        if (rc === '\n' || rc === '\r') {
          break
        }
        if (rc === '[') {
          inCharClass = true
          i++
          continue
        }
        if (rc === ']') {
          inCharClass = false
          i++
          continue
        }
        if (!inCharClass && rc === '/') {
          i++
          while (i < len && /[a-z]/i.test(code[i]!)) i++
          break
        }
        i++
      }
      out += '""'
      continue
    }
    // Single or double quoted string
    if (ch === "'" || ch === '"') {
      const quote = ch
      i++
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === quote) {
          i++
          break
        }
        i++
      }
      out += '""'
      continue
    }
    // Template literal start or resume after closing `}` of `${...}`
    if (ch === '`') {
      i++
      out += ' '
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          out += '('
          break
        }
        if (code[i] === '`') {
          i++
          out += '""'
          break
        }
        if (code[i] === '\n') out += '\n'
        i++
      }
      continue
    }
    if (templateBraceDepths.length > 0) {
      if (ch === '{') {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
      } else if (ch === '}') {
        const depth = templateBraceDepths[templateBraceDepths.length - 1]!
        if (depth === 0) {
          templateBraceDepths.pop()
          i++
          out += ')'
          // Continue scanning the enclosing template literal
          while (i < len) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            if (code[i] === '$' && code[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              out += '('
              break
            }
            if (code[i] === '`') {
              i++
              out += '""'
              break
            }
            if (code[i] === '\n') out += '\n'
            i++
          }
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = depth - 1
      }
    }
    out += ch
    i++
  }
  return out
}

export function splitTopLevelCommas(inner: string): string[] {
  const parts: string[] = []
  let depthCurly = 0
  let depthSquare = 0
  let depthParen = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (c === '{') depthCurly++
    else if (c === '}') depthCurly--
    else if (c === '[') depthSquare++
    else if (c === ']') depthSquare--
    else if (c === '(') depthParen++
    else if (c === ')') depthParen--
    else if (
      c === ',' &&
      depthCurly === 0 &&
      depthSquare === 0 &&
      depthParen === 0
    ) {
      parts.push(inner.slice(start, i))
      start = i + 1
    }
  }
  parts.push(inner.slice(start))
  return parts
}

function stripTopLevelDefaultRhs(segment: string): string {
  let depthCurly = 0
  let depthSquare = 0
  let depthParen = 0
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (c === '{') depthCurly++
    else if (c === '}') depthCurly--
    else if (c === '[') depthSquare++
    else if (c === ']') depthSquare--
    else if (c === '(') depthParen++
    else if (c === ')') depthParen--
    else if (
      c === '=' &&
      depthCurly === 0 &&
      depthSquare === 0 &&
      depthParen === 0 &&
      segment[i + 1] !== '=' &&
      segment[i + 1] !== '>'
    ) {
      return segment.slice(0, i)
    }
  }
  return segment
}

function findTopLevelColon(segment: string): number {
  let depthCurly = 0
  let depthSquare = 0
  let depthParen = 0
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (c === '{') depthCurly++
    else if (c === '}') depthCurly--
    else if (c === '[') depthSquare++
    else if (c === ']') depthSquare--
    else if (c === '(') depthParen++
    else if (c === ')') depthParen--
    else if (
      c === ':' &&
      depthCurly === 0 &&
      depthSquare === 0 &&
      depthParen === 0
    ) {
      return i
    }
  }
  return -1
}

export function collectDestructuringBindings(
  pattern: string,
  isObject: boolean,
  out: Set<string>,
): void {
  const trimmed = pattern.trim()
  if (trimmed.length < 2) return
  const inner = trimmed.slice(1, -1)
  for (const rawPart of splitTopLevelCommas(inner)) {
    let lhs = stripTopLevelDefaultRhs(rawPart).trim()
    if (!lhs) continue
    if (lhs.startsWith('...')) {
      lhs = lhs.slice(3).trim()
    }
    if (isObject) {
      const colonIdx = findTopLevelColon(lhs)
      const target = colonIdx >= 0 ? lhs.slice(colonIdx + 1).trim() : lhs
      if (target.startsWith('{') && target.endsWith('}')) {
        collectDestructuringBindings(target, true, out)
      } else if (target.startsWith('[') && target.endsWith(']')) {
        collectDestructuringBindings(target, false, out)
      } else if (VALID_IDENTIFIER_RE.test(target)) {
        out.add(target)
      }
    } else if (lhs.startsWith('{') && lhs.endsWith('}')) {
      collectDestructuringBindings(lhs, true, out)
    } else if (lhs.startsWith('[') && lhs.endsWith(']')) {
      collectDestructuringBindings(lhs, false, out)
    } else if (VALID_IDENTIFIER_RE.test(lhs)) {
      out.add(lhs)
    }
  }
}

function isBoundInDestructuring(stripped: string, name: string): boolean {
  const declRe = /\b(?:const|let|var)\s*([{[])/g
  let match: RegExpExecArray | null
  while ((match = declRe.exec(stripped)) !== null) {
    const openChar = match[1]!
    const closeChar = openChar === '{' ? '}' : ']'
    const startIdx = match.index + match[0].length - 1
    let depth = 0
    let endIdx = -1
    for (let i = startIdx; i < stripped.length; i++) {
      const c = stripped[i]!
      if (c === openChar) depth++
      else if (c === closeChar) {
        depth--
        if (depth === 0) {
          endIdx = i
          break
        }
      }
    }
    if (endIdx > startIdx) {
      const bindings = new Set<string>()
      collectDestructuringBindings(
        stripped.slice(startIdx, endIdx + 1),
        openChar === '{',
        bindings,
      )
      if (bindings.has(name)) return true
      declRe.lastIndex = endIdx + 1
    }
  }
  return false
}

function isIdentifierShadowedOrBound(stripped: string, name: string): boolean {
  const esc = escapeRegExp(name)
  const idStart = '(?<![A-Za-z0-9_$])'
  const idEnd = '(?![A-Za-z0-9_$])'
  // Redeclared via const/let/var/function/class or destructuring
  if (
    new RegExp(`\\b(?:const|let|var|function|class)\\s+${esc}${idEnd}`).test(
      stripped,
    ) ||
    isBoundInDestructuring(stripped, name)
  ) {
    return true
  }
  // Directly assigned at statement start
  if (new RegExp(`^\\s*${esc}\\s*=(?!=)`, 'm').test(stripped)) {
    return true
  }
  // Checked with typeof
  if (new RegExp(`\\btypeof\\s+${esc}${idEnd}`).test(stripped)) {
    return true
  }
  // Shadowed as arrow parameter (`x => ...` or `(..., x, ...) => ...`),
  // regular function parameter, or catch parameter
  if (
    new RegExp(`(?<![.A-Za-z0-9_$])${esc}\\s*=>`).test(stripped) ||
    new RegExp(`\\([^()]*${idStart}${esc}${idEnd}[^()]*\\)\\s*=>`).test(
      stripped,
    ) ||
    new RegExp(
      `\\bfunction\\b[^{]*\\([^()]*${idStart}${esc}${idEnd}[^()]*\\)`,
    ).test(stripped) ||
    new RegExp(`\\bcatch\\s*\\(\\s*${esc}${idEnd}`).test(stripped)
  ) {
    return true
  }
  return false
}

export function injectUnsetVarGuards(
  code: string,
  unsetVars: ReadonlySet<string>,
): string {
  if (unsetVars.size === 0) return code
  const stripped = stripJsCommentsAndStrings(code)
  const guards: string[] = []
  for (const name of unsetVars) {
    const esc = escapeRegExp(name)
    if (isIdentifierShadowedOrBound(stripped, name)) continue
    const referenced = new RegExp(`(?<![.\\w$])${esc}(?![\\w$:])`).test(
      stripped,
    )
    if (referenced) {
      guards.push(
        `if (typeof ${name} === 'undefined') { throw new ReferenceError(${JSON.stringify(`Nothing ran: it reads a variable (${name}) that an earlier step never set`)}); }`,
      )
    }
  }
  return guards.length > 0 ? `${guards.join('\n')}\n${code}` : code
}

export function skipWsAndComments(code: string, start: number): number {
  let i = start
  const len = code.length
  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      continue
    }
    break
  }
  return i
}

export function scanStringLiteralEnd(code: string, start: number): number {
  const quote = code[start]!
  let i = start + 1
  const len = code.length
  while (i < len) {
    if (code[i] === '\\') {
      i += 2
      continue
    }
    if (code[i] === quote) return i + 1
    i++
  }
  return len
}

export function scanRegexLiteralEnd(code: string, start: number): number {
  let i = start + 1
  const len = code.length
  let inCharClass = false
  while (i < len) {
    const rc = code[i]!
    if (rc === '\\') {
      i += 2
      continue
    }
    if (rc === '\n' || rc === '\r') return i
    if (rc === '[') {
      inCharClass = true
      i++
      continue
    }
    if (rc === ']') {
      inCharClass = false
      i++
      continue
    }
    if (!inCharClass && rc === '/') {
      i++
      while (i < len && /[a-z]/i.test(code[i]!)) i++
      return i
    }
    i++
  }
  return len
}

export function findMatchingDelimiter(
  code: string,
  openIdx: number,
  openChar: '(' | '{' | '[',
  closeChar: ')' | '}' | ']',
): number {
  let depth = 0
  let i = openIdx
  const len = code.length
  let emitted = ''
  const templateBraceDepths: number[] = []
  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      emitted += ' '
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
      emitted += ' '
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          emitted += '('
          break
        }
        if (code[i] === '`') {
          i++
          emitted += '""'
          break
        }
        i++
      }
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
          emitted += ')'
          i++
          while (i < len) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            if (code[i] === '$' && code[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              emitted += '('
              break
            }
            if (code[i] === '`') {
              i++
              emitted += '""'
              break
            }
            i++
          }
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
    if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) return i
    }
    emitted += ch
    i++
  }
  return -1
}

export function findTopLevelSemicolons(inner: string): number[] {
  const semis: number[] = []
  let depthParen = 0
  let depthBracket = 0
  let depthCurly = 0
  let i = 0
  const len = inner.length
  let emitted = ''
  const templateBraceDepths: number[] = []
  while (i < len) {
    const ch = inner[i]!
    const next = inner[i + 1]
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && inner[i] !== '\n') i++
      emitted += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(inner[i] === '*' && inner[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      emitted += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      i = scanStringLiteralEnd(inner, i)
      emitted += '""'
      continue
    }
    if (ch === '`') {
      i++
      while (i < len) {
        if (inner[i] === '\\') {
          i += 2
          continue
        }
        if (inner[i] === '$' && inner[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          break
        }
        if (inner[i] === '`') {
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
        i++
        continue
      }
      if (ch === '}') {
        const td = templateBraceDepths[templateBraceDepths.length - 1]!
        if (td === 0) {
          templateBraceDepths.pop()
          i++
          while (i < len) {
            if (inner[i] === '\\') {
              i += 2
              continue
            }
            if (inner[i] === '$' && inner[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              break
            }
            if (inner[i] === '`') {
              i++
              break
            }
            i++
          }
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = td - 1
        i++
        continue
      }
    }
    if (ch === '/' && canPrecedeRegexLiteral(emitted)) {
      i = scanRegexLiteralEnd(inner, i)
      emitted += '""'
      continue
    }
    if (ch === '(') depthParen++
    else if (ch === ')') depthParen--
    else if (ch === '[') depthBracket++
    else if (ch === ']') depthBracket--
    else if (ch === '{') depthCurly++
    else if (ch === '}') depthCurly--
    else if (
      ch === ';' &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthCurly === 0
    ) {
      semis.push(i)
    }
    emitted += ch
    i++
  }
  return semis
}

export function findSingleStatementEnd(code: string, start: number): number {
  let depthParen = 0
  let depthBracket = 0
  let depthCurly = 0
  let i = start
  const len = code.length
  let emitted = ''
  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      if (depthParen === 0 && depthBracket === 0 && depthCurly === 0) {
        return i
      }
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      continue
    }
    if (ch === "'" || ch === '"') {
      i = scanStringLiteralEnd(code, i)
      emitted += '""'
      continue
    }
    if (ch === '`') {
      i++
      let td = 0
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (td === 0 && code[i] === '$' && code[i + 1] === '{') {
          td = 1
          i += 2
          continue
        }
        if (td > 0) {
          if (code[i] === '{') td++
          else if (code[i] === '}') td--
          i++
          continue
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
    if (ch === '/' && canPrecedeRegexLiteral(emitted)) {
      i = scanRegexLiteralEnd(code, i)
      emitted += '""'
      continue
    }
    if (ch === '(') depthParen++
    else if (ch === ')') depthParen--
    else if (ch === '[') depthBracket++
    else if (ch === ']') depthBracket--
    else if (ch === '{') depthCurly++
    else if (ch === '}') {
      if (depthCurly === 0) return i
      depthCurly--
    } else if (depthParen === 0 && depthBracket === 0 && depthCurly === 0) {
      if (ch === ';') return i + 1
      if (ch === '\n') return i
    }
    emitted += ch
    i++
  }
  return len
}

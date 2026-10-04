/**
 * densable leftover `_ne` / `X$t` / `an` / `mUr` — secret-shaped env keys.
 * Shared by leftover `Yf`/`Vf` inherit (`spawnEval`) and leftover `wUr`
 * sandbox.credentials.envVars (`evalSandboxFence`).
 */

/** densable leftover `Qo`. */
const EVAL_AUTH0_PREFIX_RE = /^AUTH0_/i

/** densable leftover `vo` — `_ne` excludes GIT_CONFIG_KEY_* from secret-shape. */
const EVAL_GIT_CONFIG_KEY_VO_RE = /^GIT_CONFIG_KEY_[0-9][A-Za-z0-9_]*$/

/** densable leftover `un` inside `Jt`. */
const EVAL_SECRET_SHAPE_UN = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'PASSPHRASE',
  'KEY',
  'AUTH',
  'COOKIE',
  'PAT',
  'DSN',
  'WEBHOOK',
  'CREDENTIAL',
  'CREDENTIALS',
  'CREDS',
  'APIKEY',
  'ACCESSKEY',
  'SECRETKEY',
  'ACCOUNTKEY',
  'PRIVATEKEY',
  'AUTHKEY',
  'SSHKEY',
  'SIGNINGKEY',
  'MASTERKEY',
  'DEPLOYKEY',
  'ENCRYPTIONKEY',
  'PGPASSWORD',
  'SSHPASS',
]

/** densable leftover `gn` inside `Jt`. */
const EVAL_SECRET_SHAPE_GN = ['KEY', 'SECRET', 'PASSWORD', 'CREDENTIAL']

/** densable leftover `dn` inside `Jt`. */
const EVAL_SECRET_SHAPE_DN = ['PWD', 'PASS', 'JWT']

/** densable leftover `pn` inside `Jt`. */
const EVAL_SECRET_SHAPE_PN = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'PASSPHRASE',
]

/** densable leftover `Jt`. */
const EVAL_SECRET_SHAPE_RE = new RegExp(
  `((^|_)(${EVAL_SECRET_SHAPE_UN.join('|')}|(${EVAL_SECRET_SHAPE_GN.join('|')})S)|_(${EVAL_SECRET_SHAPE_DN.join('|')})|(${EVAL_SECRET_SHAPE_PN.join('|')}))(?=$|[_0-9])`,
  'i',
)

/** densable leftover `Rn` inside `Y$t`. */
const EVAL_BUNDLE_SECRET_EXCEPT = [
  'BUILD',
  'LOCAL',
  'MIRROR',
  'PATH',
  'WITH',
  'WITHOUT',
  'CACHE',
  'DISABLE',
  'IGNORE',
  'ONLY',
]

/** densable leftover `ei` inside `Y$t`. */
const EVAL_BUNDLE_SECRET_EI =
  '(?:[A-Za-z0-9]+(?:___[A-Za-z0-9]+)*__)+[A-Za-z]{2,}'

/** densable leftover `Y$t`. */
const EVAL_BUNDLE_SECRET_RE = new RegExp(
  `^(?:INPUT_)?BUNDLE_(?!(?:${EVAL_BUNDLE_SECRET_EXCEPT.join('|')})__(?!${EVAL_BUNDLE_SECRET_EI}$))\\w*__`,
  'i',
)

/** densable leftover `qe` @176706876 — `mUr` CONN/CONNECTION_STRING. */
const EVAL_CONNECTION_STRING_RE = /CONN(ECT(ION)?)?_?STR(ING)?S?(?=$|[_0-9])/i

const EVAL_CAMEL_OAUTH_TOKENS = ['OAuth', 'NextAuth'] as const

/** densable leftover `An` inside `X$t`. */
const EVAL_XST_PREFIX = [
  'INPUT_',
  'ORG_GRADLE_PROJECT_',
  'POETRY_PYPI_TOKEN_',
  'POETRY_HTTP_BASIC_',
  'CARGO_REGISTRIES_',
  'CONAN_LOGIN_USERNAME_',
  'CONAN_PASSWORD_',
]

/** densable leftover `nt` inside `X$t`. */
const EVAL_XST_USER_PREFIX = ['POETRY_HTTP_BASIC_', 'CONAN_LOGIN_USERNAME_']

const EVAL_XST_II = new RegExp(`^(?:${EVAL_XST_PREFIX.join('|')})`, 'i')
const EVAL_XST_SI = new RegExp(
  `^(?:INPUT_)?(?:${EVAL_XST_USER_PREFIX.join('|')})`,
  'i',
)
const EVAL_XST_USER = /USER(?:_?NAME)?_?[0-9]*$/i

/** densable leftover `an` @176706876. */
export function evalEnvCamelToSnake(key: string): string {
  const folded = EVAL_CAMEL_OAUTH_TOKENS.reduce((acc, token) => {
    const head = token[0] ?? ''
    return acc.replaceAll(token, head + token.slice(1).toLowerCase())
  }, key)
  return folded
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
}

/** densable leftover `mUr` @176706876. */
export function isEvalConnectionStringEnvKey(key: string): boolean {
  return (
    EVAL_CONNECTION_STRING_RE.test(key) ||
    EVAL_CONNECTION_STRING_RE.test(evalEnvCamelToSnake(key))
  )
}

/**
 * densable leftover `_ne` — secret-shaped env key (AUTH0_ stripped, hyphen→_).
 * `vo` GIT_CONFIG_KEY_* is not secret-shaped.
 */
export function isEvalSecretShapedEnvKey(key: string): boolean {
  const n = key.replace(EVAL_AUTH0_PREFIX_RE, '').replace(/-/g, '_')
  return (
    (EVAL_SECRET_SHAPE_RE.test(n) ||
      EVAL_SECRET_SHAPE_RE.test(evalEnvCamelToSnake(n)) ||
      isEvalConnectionStringEnvKey(n) ||
      EVAL_BUNDLE_SECRET_RE.test(n)) &&
    !EVAL_GIT_CONFIG_KEY_VO_RE.test(key)
  )
}

/**
 * densable leftover `X$t` — INPUT_/POETRY_/CONAN_/CARGO_ prefixed keys that
 * are user-shaped or `_ne`.
 */
export function isEvalPrefixedSecretEnvKey(key: string): boolean {
  const n = key.replace(/-/g, '_')
  return (
    EVAL_XST_II.test(n) &&
    (EVAL_XST_SI.test(n) ||
      EVAL_XST_USER.test(n) ||
      isEvalSecretShapedEnvKey(n))
  )
}

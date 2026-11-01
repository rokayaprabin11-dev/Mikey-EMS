// Writes docs/API.md from the code: the endpoints from the shared contract, and the error codes
// each route can return from the server's source. Run `pnpm api:doc` after changing either; a
// test fails while the file is out of date.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as shared from '@mikey/shared'
import { ACCOUNTANT_DEFAULT_PERMISSIONS, type Access, API_PREFIX, type Endpoint, endpoints } from '@mikey/shared'
import ts from 'typescript'

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url))
const SOURCE_DIR = fileURLToPath(new URL('../src/', import.meta.url))
export const API_DOC = fileURLToPath(new URL('../../../docs/API.md', import.meta.url))

// What each kind of access can refuse with, checked in http/route.ts and auth/sessions.ts.
const ACCESS_CODES: Record<'anyone' | 'local_network' | 'allowed_computer' | 'signed_in' | 'permission', readonly string[]> = {
  anyone: [],
  local_network: ['NOT_ON_LOCAL_NETWORK'],
  allowed_computer: ['NOT_ALLOWED'],
  signed_in: ['NOT_ALLOWED', 'NOT_SIGNED_IN', 'SESSION_EXPIRED'],
  permission: ['NOT_ALLOWED', 'NOT_SIGNED_IN', 'SESSION_EXPIRED', 'NO_PERMISSION'],
}

// Every request can also get these, so they are said once, above the table.
const GLOBAL_CODES = ['BAD_REQUEST', 'INTERNAL_ERROR', 'NOT_FOUND']

function accessLevel(access: Access): keyof typeof ACCESS_CODES {
  return access === 'anyone' || access === 'local_network' || access === 'allowed_computer' || access === 'signed_in'
    ? access
    : 'permission'
}

function who(access: Access): string {
  switch (access) {
    case 'anyone':
      return 'anyone, no sign-in'
    case 'local_network':
      return 'a computer on the office network, no sign-in'
    case 'allowed_computer':
      return 'an allowed computer, before sign-in'
    case 'signed_in':
      return 'both'
    default:
      return `${(ACCOUNTANT_DEFAULT_PERMISSIONS as readonly string[]).includes(access) ? 'both' : 'Super Admin'} (\`${access}\`)`
  }
}

// The export name of every shared schema, so a contract's request and reply can be named.
function schemaNames(): Map<unknown, string> {
  const names = new Map<unknown, string>()
  for (const [name, value] of Object.entries(shared)) {
    if (name.endsWith('Schema') && typeof value === 'object' && value !== null && '_zod' in value) {
      names.set(value, name)
    }
  }
  return names
}

function nameOf(names: Map<unknown, string>, schema: unknown, where: string): string {
  const name = names.get(schema)
  if (name === undefined) {
    throw new Error(`The ${where} schema is not exported from packages/shared, so the API doc cannot name it.`)
  }
  return `\`${name}\``
}

interface ServerSource {
  // The codes each registered route can fail with, by endpoint name.
  routeCodes: Map<string, Set<string>>
  // The codes the access check can fail with.
  accessCodes: Set<string>
}

// Follows every call from each route handler through the server's own source, collecting the
// codes passed to fail(). Functions from packages and other workspaces are not followed.
function readServerSource(): ServerSource {
  const configPath = ts.findConfigFile(SERVER_DIR, (file) => ts.sys.fileExists(file), 'tsconfig.json')
  if (configPath === undefined) {
    throw new Error('apps/server/tsconfig.json was not found.')
  }
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    },
  })
  if (config === undefined) {
    throw new Error('apps/server/tsconfig.json could not be read.')
  }
  const program = ts.createProgram({
    rootNames: config.fileNames.filter((file) => file.startsWith(SOURCE_DIR) && !file.endsWith('.test.ts')),
    options: config.options,
  })
  const checker = program.getTypeChecker()

  function ownFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
    let symbol = checker.getSymbolAtLocation(node)
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = checker.getAliasedSymbol(symbol)
    }
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    if (declaration === undefined || !declaration.getSourceFile().fileName.startsWith(SOURCE_DIR)) {
      return null
    }
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) {
      return declaration
    }
    const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined
    return initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer : null
  }

  function isFail(node: ts.CallExpression): boolean {
    const target = ownFunction(node.expression)
    return target !== null && ts.isFunctionDeclaration(target) && target.name?.text === 'fail' && target.getSourceFile().fileName === `${SOURCE_DIR}errors.ts`
  }

  function codesFrom(start: ts.Node): Set<string> {
    const codes = new Set<string>()
    const seen = new Set<ts.Node>()
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isFail(node)) {
        const [code] = node.arguments
        if (code === undefined || !ts.isStringLiteral(code)) {
          throw new Error(`fail() is called without a written code in ${node.getSourceFile().fileName}.`)
        }
        codes.add(code.text)
      } else if (ts.isIdentifier(node)) {
        // A function of ours, whether called here or handed on to be called.
        const target = ownFunction(node)
        if (target !== null && !seen.has(target)) {
          seen.add(target)
          visit(target)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(start)
    return codes
  }

  const routeCodes = new Map<string, Set<string>>()
  let accessCodes: Set<string> | null = null
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(SOURCE_DIR)) {
      continue
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'registerRoute') {
        const [, , name, handler] = node.arguments
        if (name !== undefined && handler !== undefined && ts.isStringLiteral(name)) {
          routeCodes.set(name.text, codesFrom(handler))
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'checkAccess') {
        accessCodes = codesFrom(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  if (accessCodes === null) {
    throw new Error('checkAccess was not found in apps/server/src.')
  }
  return { routeCodes, accessCodes }
}

function requestText(names: Map<unknown, string>, endpoint: Endpoint, endpointName: string): string {
  const parts: string[] = []
  if (endpoint.query !== undefined) {
    parts.push(`query ${nameOf(names, endpoint.query, `${endpointName} query`)}`)
  }
  if (endpoint.body !== undefined) {
    parts.push(`body ${nameOf(names, endpoint.body, `${endpointName} body`)}`)
  }
  return parts.length === 0 ? '—' : parts.join(', ')
}

function replyText(names: Map<unknown, string>, endpoint: Endpoint, endpointName: string): string {
  switch (endpoint.response) {
    case 'pdf':
      return 'PDF'
    case 'xlsx':
      return 'Excel workbook'
    case 'empty':
      return 'nothing'
    default:
      return nameOf(names, endpoint.response, `${endpointName} reply`)
  }
}

export function buildApiDoc(): string {
  const names = schemaNames()
  const { routeCodes, accessCodes } = readServerSource()
  const known = new Set(Object.values(ACCESS_CODES).flat())
  const unknown = [...accessCodes].filter((code) => !known.has(code))
  if (unknown.length > 0) {
    throw new Error(`The access check can now fail with ${unknown.join(', ')}; say which access levels in ACCESS_CODES.`)
  }

  const rows = Object.entries(endpoints).map(([endpointName, endpoint]: [string, Endpoint]) => {
    const handlerCodes = routeCodes.get(endpointName)
    let errors = 'not built yet'
    if (handlerCodes !== undefined) {
      const hasInput = endpoint.params !== undefined || endpoint.query !== undefined || endpoint.body !== undefined
      const codes = new Set([
        ...ACCESS_CODES[accessLevel(endpoint.access)],
        ...(hasInput ? ['VALIDATION_FAILED'] : []),
        ...[...handlerCodes].filter((code) => !GLOBAL_CODES.includes(code) || code === 'NOT_FOUND'),
      ])
      errors = [...codes].sort().join(', ') || '—'
    }
    const cells = [
      endpoint.method,
      `\`${endpoint.path}\``,
      who(endpoint.access),
      requestText(names, endpoint, endpointName),
      replyText(names, endpoint, endpointName),
      errors,
    ]
    return `| ${cells.join(' | ')} |`
  })

  return `# API

Generated from the code by \`pnpm api:doc\` (apps/server/scripts/api-doc.ts): the endpoints from the shared contract (packages/shared/src/api/contract.ts), and the error codes each route can return from the server's source. A test fails while this file is out of date, so do not edit it by hand.

- Every path starts with \`${API_PREFIX}\`. Path parameters (\`:paymentId\`) are checked like the request.
- **Who**: the role that can call it with the permissions each role has by default (DOMAIN_RULES §9), and the permission key. "both" means the Super Admin and the Accountant.
- **Request** and **Reply** name the Zod schemas exported from packages/shared. Money is always an integer number of paisa.
- **Errors** are the codes in packages/shared/src/errors.ts. Any request can also get ${GLOBAL_CODES.map((code) => `\`${code}\``).join(', ')} (a body that is not JSON, a fault on Computer 1, an unknown address).

| Method | Path | Who | Request | Reply | Errors |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(API_DOC, buildApiDoc())
  process.stdout.write(`Wrote ${API_DOC}\n`)
}

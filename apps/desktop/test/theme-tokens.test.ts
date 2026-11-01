import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const designSystem = readFileSync(new URL('../../../docs/DESIGN_SYSTEM.md', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

function documentedTokens(markdown: string): Record<string, string> {
  const section = markdown.split('## Colour tokens')[1]?.split('\n## ')[0]
  if (section === undefined) {
    throw new Error('docs/DESIGN_SYSTEM.md has no "## Colour tokens" section.')
  }

  const tokens: Record<string, string> = {}
  for (const line of section.split('\n')) {
    const [, nameCell = '', hexCell = ''] = line.split('|')
    const names = [...nameCell.matchAll(/`([a-z-]+)`/g)].map((match) => match[1])
    const hexes = [...hexCell.matchAll(/`(#[0-9A-Fa-f]{6})`/g)].map((match) => match[1])
    if (names.length !== hexes.length) {
      throw new Error(`Token row does not pair names with colours: ${line}`)
    }
    names.forEach((name, index) => {
      const hex = hexes[index]
      if (name !== undefined && hex !== undefined) {
        tokens[name] = hex.toUpperCase()
      }
    })
  }
  return tokens
}

function cssTokens(source: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [, name, hex] of source.matchAll(/--color-([a-z-]+):\s*(#[0-9A-Fa-f]{6});/g)) {
    if (name !== undefined && hex !== undefined) {
      tokens[name] = hex.toUpperCase()
    }
  }
  return tokens
}

describe('colour tokens', () => {
  it('are defined in index.css exactly as listed in docs/DESIGN_SYSTEM.md', () => {
    const documented = documentedTokens(designSystem)
    expect(Object.keys(documented).length).toBeGreaterThan(0)
    expect(cssTokens(css)).toEqual(documented)
  })

  it("are all that shadcn/ui's colour names point at", () => {
    const documented = documentedTokens(designSystem)
    const aliases = [...css.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].filter(([, , value]) => !value?.startsWith('#'))
    expect(aliases.map(([, name]) => name)).toContain('primary')
    for (const [, name, value] of aliases) {
      const token = /^var\(--color-([a-z-]+)\)$/.exec(value ?? '')?.[1]
      expect(token !== undefined && token in documented, `--color-${name ?? ''}: ${value ?? ''}`).toBe(true)
    }
  })

  it('are the only colours the screens use: no colour is written out in their code', () => {
    const sourceDir = fileURLToPath(new URL('../src/', import.meta.url))
    const files = readdirSync(sourceDir, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file))
    expect(files.length).toBeGreaterThan(0)
    const withColours = files.filter((file) => /#[0-9A-Fa-f]{3,8}\b|\b(?:rgb|hsl|oklch)\(/.test(readFileSync(join(sourceDir, file), 'utf8')))
    expect(withColours).toEqual([])
  })
})

import { readFileSync } from 'node:fs'

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
})

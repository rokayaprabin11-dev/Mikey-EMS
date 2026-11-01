import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { settingsStore } from '../electron/main/settings.ts'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'mikey-settings-test-'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe("this computer's settings", () => {
  it('start empty, before setup', async () => {
    expect(await settingsStore(folder).read()).toEqual({ serverUrl: null, printer: null })
  })

  it('keep the server address and the printer, each saved on its own', async () => {
    const store = settingsStore(folder)
    await Promise.all([
      store.update({ serverUrl: 'http://192.168.1.10:3100' }),
      store.update({ printer: { name: 'EPSON L3150', paper: 'A5' } }),
    ])
    const expected = { serverUrl: 'http://192.168.1.10:3100', printer: { name: 'EPSON L3150', paper: 'A5' } }
    expect(await store.read()).toEqual(expected)
    // A new store, as after a restart, reads the same file.
    expect(await settingsStore(folder).read()).toEqual(expected)
  })

  it('refuse to save an address that is not one', async () => {
    const store = settingsStore(folder)
    await expect(store.update({ serverUrl: '192.168.1.10' })).rejects.toThrow()
    await expect(store.update({ serverUrl: 'http://192.168.1.10:3100/api' })).rejects.toThrow()
    expect(await store.read()).toEqual({ serverUrl: null, printer: null })
  })

  it('go back to setup when the file cannot be read back', async () => {
    await writeFile(join(folder, 'settings.json'), '{"serverUrl": "http://192.168.1.10:31')
    expect(await settingsStore(folder).read()).toEqual({ serverUrl: null, printer: null })
    await writeFile(join(folder, 'settings.json'), JSON.stringify({ serverUrl: 'http://x/', printer: null }))
    expect(await settingsStore(folder).read()).toEqual({ serverUrl: null, printer: null })

    // Setting up again writes a good file over it.
    await settingsStore(folder).update({ serverUrl: 'http://192.168.1.10:3100' })
    expect(JSON.parse(await readFile(join(folder, 'settings.json'), 'utf8'))).toEqual({
      serverUrl: 'http://192.168.1.10:3100',
      printer: null,
    })
  })
})

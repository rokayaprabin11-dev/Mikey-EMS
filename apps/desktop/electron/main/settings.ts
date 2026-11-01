import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { serverUrlFrom } from '../server-address.ts'

// What this computer keeps: where Computer 1 is and which printer takes receipts. School records
// are never kept here.
const settingsSchema = z.object({
  serverUrl: z
    .string()
    .refine((value) => serverUrlFrom(value) === value)
    .nullable(),
  printer: z.object({ name: z.string().min(1), paper: z.literal('A5') }).nullable(),
})

export type Settings = z.infer<typeof settingsSchema>

const NOT_SET_UP: Settings = { serverUrl: null, printer: null }

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export interface SettingsStore {
  read(): Promise<Settings>
  update(change: Partial<Settings>): Promise<void>
}

export function settingsStore(folder: string): SettingsStore {
  const file = join(folder, 'settings.json')
  // Changes are written one after another, so two saved at once cannot undo each other.
  let writing = Promise.resolve()

  async function read(): Promise<Settings> {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) {
        return NOT_SET_UP
      }
      throw error
    }
    // A file that cannot be read back (a disk fault, or someone edited it) means setting this
    // computer up again, which writes a good one.
    let saved: unknown
    try {
      saved = JSON.parse(text)
    } catch {
      return NOT_SET_UP
    }
    const parsed = settingsSchema.safeParse(saved)
    return parsed.success ? parsed.data : NOT_SET_UP
  }

  function update(change: Partial<Settings>): Promise<void> {
    const next = writing.then(async () => {
      const settings = settingsSchema.parse({ ...(await read()), ...change })
      await mkdir(folder, { recursive: true })
      // Written beside it first, so a power cut never leaves half a file.
      await writeFile(`${file}.new`, JSON.stringify(settings, null, 2))
      await rename(`${file}.new`, file)
    })
    writing = next.catch(() => undefined)
    return next
  }

  return { read, update }
}

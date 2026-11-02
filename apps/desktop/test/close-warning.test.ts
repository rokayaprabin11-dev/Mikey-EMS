import { describe, expect, it } from 'vitest'

import { CLOSE, mayClose, STAY } from '../electron/main/close-warning.ts'

const WARNING = { message: 'A payment is waiting for Computer 1.', stay: 'Stay', close: 'Close anyway' }

describe('closing the app window', () => {
  it('closes without asking when nothing is waiting', () => {
    expect(mayClose(null, () => {
      throw new Error('Asked when nothing was waiting.')
    })).toBe(true)
  })

  it('stays open unless Close anyway is chosen while a payment waits', () => {
    const asked: string[] = []
    expect(mayClose(WARNING, (warning) => (asked.push(warning.message), STAY))).toBe(false)
    expect(mayClose(WARNING, () => CLOSE)).toBe(true)
    expect(asked).toEqual(['A payment is waiting for Computer 1.'])
  })
})

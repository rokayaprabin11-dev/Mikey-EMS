import type { Bridge } from '../electron/bridge.ts'

declare global {
  interface Window {
    mikey?: Bridge
  }
}

// The preload's bridge to the main process: the only way out of the renderer.
export function bridge(): Bridge {
  if (window.mikey === undefined) {
    throw new Error('The app window was opened without its preload, so it cannot reach the main process.')
  }
  return window.mikey
}

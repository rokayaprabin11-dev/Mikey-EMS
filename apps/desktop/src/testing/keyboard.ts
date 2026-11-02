import { act, fireEvent } from '@testing-library/react'

// The keyboard as a browser handles it, for screen tests: the test environment sends key events
// but does not move the focus on Tab or press a button on Enter or Space by itself.

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'

function reachable(element: HTMLElement): boolean {
  return (
    element.tabIndex >= 0 &&
    !element.hasAttribute('disabled') &&
    element.closest('[inert], [hidden], [aria-hidden="true"]') === null &&
    !(element instanceof HTMLInputElement && element.type === 'hidden')
  )
}

function focused(): HTMLElement {
  const element = document.activeElement
  if (!(element instanceof HTMLElement)) {
    throw new Error('Nothing has the focus.')
  }
  return element
}

// Tab: the next element in the page that the keyboard can reach.
export function tab(): void {
  const elements = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable)
  const next = elements[elements.indexOf(focused()) + 1] ?? elements[0]
  if (next === undefined) {
    throw new Error('Nothing on the page can take the focus.')
  }
  act(() => next.focus())
}

// A key on whatever has the focus. Enter presses a focused button and Space ticks a checkbox,
// unless the screen stopped them (a checkbox ignores Enter).
export function press(key: string, modifiers: { ctrlKey?: boolean } = {}): void {
  const target = focused()
  const goOn = fireEvent.keyDown(target, { key, ...modifiers })
  const presses = target instanceof HTMLButtonElement && (key === 'Enter' || key === ' ')
  if (goOn && modifiers.ctrlKey !== true && presses) {
    fireEvent.click(target)
  }
  fireEvent.keyUp(target, { key, ...modifiers })
}

// Typing into the focused box replaces what it holds.
export function type(text: string): void {
  fireEvent.change(focused(), { target: { value: text } })
}

export function hasFocus(element: Element): boolean {
  return document.activeElement === element
}

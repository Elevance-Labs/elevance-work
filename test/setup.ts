// Shared test harness: a jsdom browser, helpers to drive MUI the way a person
// would, and a tiny reporter. Each test file is a plain script run by
// vite-node (see `yarn test`); it exits non-zero if any check failed.
//
// Call `setupDom()` before importing React, MUI or anything from src/ — they
// read `window` and `document` when first loaded.
import { JSDOM } from 'jsdom'

type Global = Record<string, unknown>

const screen = { width: 1280, displayMode: 'browser' }

/**
 * The screen the media queries describe: its width, and whether the page is
 * a browser tab (`browser`) or the installed app (`standalone`). Read when a
 * component mounts, so set it before `mountApp`.
 */
export function setScreen(next: Partial<typeof screen>) {
  Object.assign(screen, next)
}

export function setupDom(url = 'http://localhost/') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url, pretendToBeVisual: true })
  const w = dom.window as unknown as Global
  const g = globalThis as unknown as Global

  g.window = w
  g.document = w.document
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true })
  g.getComputedStyle = w.getComputedStyle
  // Not an act() environment: React schedules work as it does in a browser and
  // the helpers below simply wait for it. The mock resolves on later ticks,
  // which act() scopes cannot follow without warnings.
  g.IS_REACT_ACT_ENVIRONMENT = false

  // MUI reaches for these DOM globals directly (focus management, portals, transitions).
  for (const name of [
    'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'HTMLButtonElement',
    'HTMLDivElement', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Event', 'MouseEvent',
    'KeyboardEvent', 'FocusEvent', 'CustomEvent', 'DOMRect', 'MutationObserver', 'getSelection',
    'File', 'Blob', 'FileList', 'DataTransfer', 'FormData',
  ]) {
    if (w[name] !== undefined) g[name] = w[name]
  }
  g.requestAnimationFrame = w.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0)
  g.cancelAnimationFrame = w.cancelAnimationFrame = (id: number) => clearTimeout(id)
  // jsdom has no media queries. Answer min/max-width ones as a 1280px desktop
  // (see `setScreen`), so the layout renders its permanent nav drawer, and
  // display-mode ones as a browser tab.
  w.matchMedia = g.matchMedia = (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const mode = /display-mode:\s*([\w-]+)/.exec(query)
    const matches = mode
      ? mode[1] === screen.displayMode
      : (!min || screen.width >= Number(min[1])) && (!max || screen.width <= Number(max[1]))
    return {
      matches, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent: () => false,
    }
  }
  // jsdom has no layout, so MUI's Autocomplete/Popper need a stub.
  g.ResizeObserver = w.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // Node's URL.createObjectURL only takes Node's own Blob; jsdom hands out
  // its own. Image previews and CSV downloads just need an address.
  URL.createObjectURL = () => 'blob:mock'
  URL.revokeObjectURL = () => {}

  return dom
}

/**
 * Make "today" this date (local noon) for `new Date()` and `Date.now()`. The
 * clock still runs, so timers and MUI transitions behave; only the day moves.
 */
export function freezeToday(isoDate: string) {
  const RealDate = Date
  const offset = new RealDate(`${isoDate}T12:00:00`).getTime() - RealDate.now()
  class TestDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length) super(...(args as [number]))
      else super(RealDate.now() + offset)
    }
    static now() {
      return RealDate.now() + offset
    }
  }
  globalThis.Date = TestDate as DateConstructor
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

export function reporter() {
  let failed = 0
  return {
    check(name: string, ok: unknown, extra: unknown = '') {
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${String(extra)}`}`)
      if (!ok) failed++
    },
    done: () => process.exit(failed ? 1 : 0),
  }
}

// ---------------------------------------------------------------------------
// Driving the page
// ---------------------------------------------------------------------------

const doc = () => (globalThis as unknown as { document: Document }).document
const win = () => (globalThis as unknown as { window: Window & typeof globalThis }).window

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Let effects, mock queries and MUI transitions settle: wait `ms`, then until
 * no spinner or loading bar is left (pages show one while they fetch), up to 3s.
 */
export async function settle(ms = 30) {
  await sleep(ms)
  // Indeterminate only: a determinate bar (a leave balance) is content, not loading.
  const loading = () =>
    doc().querySelector('.MuiLinearProgress-indeterminate, .MuiCircularProgress-indeterminate')
  for (let waited = 0; waited < 3000 && loading(); waited += 20) await sleep(20)
}

/** Wait until `condition` holds (up to `ms`), e.g. for a dialog's exit transition. */
export async function waitFor(condition: () => unknown, ms = 2000) {
  for (let waited = 0; waited < ms && !condition(); waited += 20) await sleep(20)
  return !!condition()
}

export const text = () => doc().body.textContent ?? ''

/** Buttons, by their visible text or aria-label, optionally within `root`. */
export function buttons(name: string, root: ParentNode = doc()) {
  return [...root.querySelectorAll<HTMLElement>('button, [role="button"], a.MuiButton-root')].filter(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  )
}
export const button = (name: string, root?: ParentNode) => buttons(name, root)[0]

/** The open dialog (MUI renders it in a portal at the end of body). */
export const dialog = () => [...doc().querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1) ?? null

/** The table body row that contains this text. */
export const row = (contains: string) =>
  [...doc().querySelectorAll<HTMLTableRowElement>('tbody tr')].find((r) => r.textContent?.includes(contains))

/** A labelled checkbox (MUI FormControlLabel). */
export const checkbox = (label: string) =>
  [...doc().querySelectorAll('.MuiFormControlLabel-root')]
    .find((l) => l.textContent?.trim() === label)
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null

export async function click(el: Element | null | undefined) {
  if (!el) throw new Error('click: element not found')
  el.dispatchEvent(new (win().MouseEvent)('click', { bubbles: true, cancelable: true }))
  await settle()
}

/** The form control wrapping the field with this label (required `*` ignored). */
export function field(label: string, root: ParentNode = doc()) {
  // Select labels are not <label> elements in MUI 9, so match on the class.
  const labelEl = [...root.querySelectorAll('.MuiFormLabel-root')].find(
    (l) => l.textContent?.replace(/[\s* ]+$/, '').trim() === label,
  )
  return labelEl?.closest('.MuiFormControl-root') ?? null
}

/** Type into a text field — found by label, or by placeholder — the way React sees a keystroke. */
export async function type(labelOrPlaceholder: string, value: string, root: ParentNode = doc()) {
  const input =
    field(labelOrPlaceholder, root)?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ??
    [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].find(
      (i) => i.placeholder === labelOrPlaceholder,
    )
  if (!input) throw new Error(`type: no field labelled "${labelOrPlaceholder}"`)
  const proto = input instanceof win().HTMLTextAreaElement ? win().HTMLTextAreaElement : win().HTMLInputElement
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new (win().Event)('input', { bubbles: true }))
  await settle(0)
}

/** Open an MUI select by its label and pick the option with this text. */
export async function choose(label: string, option: string, root: ParentNode = doc()) {
  const combo = field(label, root)?.querySelector('[role="combobox"]')
  if (!combo) throw new Error(`choose: no select labelled "${label}"`)
  combo.dispatchEvent(new (win().MouseEvent)('mousedown', { bubbles: true, button: 0 }))
  await settle()
  await click(options().find((o) => o.textContent?.trim() === option))
}

/** The options of whichever select or autocomplete is open. */
export const options = () => [...doc().querySelectorAll('[role="option"]')]

/** The current value shown by an MUI select or text field. */
export function valueOf(label: string) {
  const f = field(label)
  return f?.querySelector('input:not([aria-hidden])')?.getAttribute('value') ??
    (f?.querySelector('input') as HTMLInputElement | null)?.value ?? null
}

/** Pick a file in the (hidden) file input. */
export async function pickFile(file: File, label?: string, root: ParentNode = doc()) {
  const input = root.querySelector<HTMLInputElement>(label ? `input[type="file"][aria-label="${label}"]` : 'input[type="file"]')
  if (!input) throw new Error(`pickFile: no file input${label ? ` labelled "${label}"` : ''}`)
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new (win().Event)('change', { bubbles: true }))
  await settle()
}

/** The nav drawer's links, by label. */
export const navLabels = () =>
  [...doc().querySelectorAll('.MuiDrawer-root .MuiListItemText-primary')].map((n) => n.textContent)

// ---------------------------------------------------------------------------
// Elevance Work additions
// ---------------------------------------------------------------------------

/** An input or control by its aria-label (fields without a visible label). */
export const labelled = <T extends Element = HTMLInputElement>(label: string, root: ParentNode = doc()) =>
  root.querySelector<T & Element>(`[aria-label="${label}"]`)

/** Type into an input found by aria-label. */
export async function typeInto(label: string, value: string, root: ParentNode = doc()) {
  const input = labelled<HTMLInputElement>(label, root)
  if (!input) throw new Error(`typeInto: nothing labelled "${label}"`)
  const proto = input instanceof win().HTMLTextAreaElement ? win().HTMLTextAreaElement : win().HTMLInputElement
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new (win().Event)('input', { bubbles: true }))
  await settle(0)
}

/** Submit the form an element is in (Enter in a one-field form). */
export async function submit(el: Element | null | undefined) {
  const form = el?.closest('form')
  if (!form) throw new Error('submit: no form')
  form.dispatchEvent(new (win().Event)('submit', { bubbles: true, cancelable: true }))
  await settle()
}

/** The menu item (role=menuitem or option) with this text, in whatever menu is open. */
export const menuItem = (label: string) =>
  [...doc().querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"]')].find((m) => m.textContent?.trim() === label)

/** Let the lazily loaded chunks (issue dialog, editor) arrive. */
export async function settleLazy() {
  for (let i = 0; i < 5; i++) await settle(60)
}

/** Put HTML into the TipTap editor labelled `label`, the way TipTap exposes it. */
export async function write(label: string, html: string, root: ParentNode = doc()) {
  const el = root.querySelector(`.ProseMirror[aria-label="${label}"]`) as (Element & { editor?: { commands: { setContent(c: string, o?: unknown): void } } }) | null
  if (!el?.editor) throw new Error(`write: no editor labelled "${label}"`)
  el.editor.commands.setContent(html, { emitUpdate: true })
  await settle()
}

/** Open an MUI select found by its input's aria-label and pick the option with this text. */
export async function chooseLabelled(label: string, option: string, root: ParentNode = doc()) {
  const combo = labelled(label, root)?.closest('.MuiInputBase-root')?.querySelector('[role="combobox"]')
  if (!combo) throw new Error(`chooseLabelled: no select labelled "${label}"`)
  combo.dispatchEvent(new (win().MouseEvent)('mousedown', { bubbles: true, button: 0 }))
  await settle()
  await click(options().find((o) => o.textContent?.trim() === option))
}

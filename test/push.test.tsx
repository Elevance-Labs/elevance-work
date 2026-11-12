// Notifications on devices (Web Push): the encryption and VAPID token
// push-send sends (against RFC 8291's own example), what a device shows and
// that it says what the bell says, the service worker's push and tap
// handling, and the app's side: turning a device on from the bell or the
// settings, a device that stopped, a shared browser, signing out, the icon
// badge, a tapped notification, and opening an issue marking it read.
import vm from 'node:vm'
import { setupDom, reporter, button, click, dialog, menuItem, settle, settleLazy, text, waitFor } from './setup'
const dom = setupDom()
const W = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>

// ---------------------------------------------------------------------------
// A browser that can do Web Push (installed before the app is imported)
// ---------------------------------------------------------------------------
const ENDPOINT = 'https://push.example/device-1'
const browser = {
  permission: 'default' as NotificationPermission,
  asked: 0,
  subscribedWith: null as null | { applicationServerKey: Uint8Array },
  unsubscribed: 0,
  badges: [] as number[],
}
let subscription: null | { endpoint: string; toJSON(): unknown; unsubscribe(): Promise<boolean> } = null
const fakeSubscription = () => ({
  endpoint: ENDPOINT,
  toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }),
  unsubscribe: async () => {
    browser.unsubscribed++
    subscription = null
    return true
  },
})
const workerListeners = new Set<(e: { data: unknown }) => void>()
const registration = {
  pushManager: {
    getSubscription: async () => subscription,
    subscribe: async (opts: { applicationServerKey: Uint8Array }) => {
      browser.subscribedWith = opts
      subscription = fakeSubscription()
      return subscription
    },
  },
}
Object.defineProperty(W.navigator, 'serviceWorker', {
  configurable: true,
  value: {
    getRegistration: async () => registration,
    addEventListener: (_: string, fn: (e: { data: unknown }) => void) => workerListeners.add(fn),
    removeEventListener: (_: string, fn: (e: { data: unknown }) => void) => workerListeners.delete(fn),
  },
})
Object.defineProperty(W.navigator, 'permissions', { configurable: true, value: { query: async () => ({ onchange: null }) } })
Object.defineProperty(W.navigator, 'setAppBadge', { configurable: true, value: async (n: number) => { browser.badges.push(n) } })
Object.defineProperty(W.navigator, 'clearAppBadge', { configurable: true, value: async () => { browser.badges.push(0) } })
W.PushManager = function PushManager() {} as unknown as typeof PushManager
;(globalThis as Record<string, unknown>).Notification = W.Notification = {
  get permission() {
    return browser.permission
  },
  requestPermission: async () => {
    browser.asked++
    browser.permission = 'granted'
    return 'granted'
  },
} as unknown as typeof Notification
const fromWorker = async (data: unknown) => {
  for (const l of workerListeners) l({ data })
  await settle(400)
}

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, PEOPLE } = await import('./mockSupabase')
const { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } = await import('../supabase/functions/push-send/webpush')
const message = await import('../supabase/functions/push-send/message')
const { notificationSentence, excerpt } = await import('../src/lib/notifications')
const { pushStatus, pushPrompt, deviceLabel, vapidKeyBytes } = await import('../src/lib/push')
const { pwa } = await import('../vite.pwa')

const { check, done } = reporter()
const enc = new TextEncoder()
const subtle = globalThis.crypto.subtle

// ---------------------------------------------------------------------------
// push-send: RFC 8291 and RFC 8292
// ---------------------------------------------------------------------------
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}
const rfcBody = await encryptPayload(enc.encode(RFC.plaintext), RFC.uaPublic, RFC.auth, {
  salt: b64urlDecode(RFC.salt), local: { publicKey: RFC.asPublic, privateKey: RFC.asPrivate },
})
check('push-send encrypts RFC 8291\'s worked example byte for byte', b64urlEncode(rfcBody) === RFC.body)

// A receiver written from the spec opens a real (random) one.
type Bytes = Uint8Array<ArrayBuffer>
const concat = (...p: Uint8Array[]): Bytes => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0))
  let i = 0
  for (const x of p) {
    o.set(x, i)
    i += x.length
  }
  return o
}
const hkdf = async (salt: Bytes, ikm: Bytes, info: Bytes, len: number) => new Uint8Array(await subtle.deriveBits(
  { name: 'HKDF', hash: 'SHA-256', salt, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8))
async function receive(body: Bytes, ua: CryptoKeyPair, authSecret: Bytes) {
  const salt = body.slice(0, 16)
  const asPublic = body.slice(21, 21 + body[20])
  const sealed = body.slice(21 + body[20])
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256))
  const uaPublic = new Uint8Array(await subtle.exportKey('raw', ua.publicKey))
  const ikm = await hkdf(authSecret, secret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed))
  return { text: new TextDecoder().decode(plain.slice(0, -1)), delimiter: plain.at(-1) }
}
const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
const uaPublic = b64urlEncode(new Uint8Array(await subtle.exportKey('raw', ua.publicKey)))
const authSecret = globalThis.crypto.getRandomValues(new Uint8Array(16))
const payload = JSON.stringify({ title: 'WEB-2 · Hero banner', body: 'Amna Khan mentioned you: “café ☕”' })
const opened = await receive(await encryptPayload(enc.encode(payload), uaPublic, b64urlEncode(authSecret)), ua, authSecret)
check('…and a browser with the subscription\'s keys opens it', opened.text === payload && opened.delimiter === 2)

const vapidPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
const vapid = {
  publicKey: b64urlEncode(new Uint8Array(await subtle.exportKey('raw', vapidPair.publicKey))),
  privateKey: (await subtle.exportKey('jwk', vapidPair.privateKey)).d!,
  subject: 'mailto:work@example.com',
}
const now = Date.UTC(2026, 10, 12, 9, 0, 0)
const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, now)
const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? []
const [h, c, sig] = token.split('.')
const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)))
check('the VAPID token names the push service\'s origin, 12 hours, and who to contact',
  claims.aud === 'https://fcm.googleapis.com' && claims.exp === now / 1000 + 12 * 3600 && claims.sub === vapid.subject && k === vapid.publicKey)
check('…and is signed ES256 with the key browsers subscribe with', await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
  vapidPair.publicKey, b64urlDecode(sig), enc.encode(`${h}.${c}`)))

// ---------------------------------------------------------------------------
// What a device shows
// ---------------------------------------------------------------------------
const kinds = ['assigned', 'mentioned', 'commented', 'status_changed', 'test'] as const
check('a device says what the bell says, for every kind', kinds.every((kind) =>
  message.sentence(kind, 'In Review', 'Amna Khan') === notificationSentence(kind, 'In Review', 'Amna Khan') &&
  message.sentence(kind, null, null) === notificationSentence(kind, null, null)))
const html = '<p>Hi <span data-type="mention" data-id="x">@Sara</span>, use&nbsp;the <b>new</b> photo &amp; logo</p>'
check('an assignment made with a status change says both',
  notificationSentence('assigned', 'In Progress', 'Amna Khan') === 'Amna Khan assigned you and moved it to In Progress' &&
  notificationSentence('assigned', null, 'Amna Khan') === 'Amna Khan assigned you')
check('…and so does a device', message.sentence('assigned', 'In Progress', 'Amna Khan') === 'Amna Khan assigned you and moved it to In Progress')
check('…and quotes a comment the same way, as plain words', message.excerpt(html) === excerpt(html) &&
  excerpt(html) === 'Hi @Sara , use the new photo & logo')
check('a long comment is cut at a word', excerpt('word '.repeat(60), 40).endsWith('word…'))

const mention = message.pushMessage({
  id: 'n-9', kind: 'mentioned', detail: null, issue_id: 'i-web-2', actor: { full_name: 'Amna Khan' },
  comment: { body: '<p>Look at this</p>' }, issue: { key: 'WEB-2', title: 'Hero banner' },
}, 3)
check('a mention: the issue as its title, who and what they said as its body',
  mention.title === 'WEB-2 · Hero banner' && mention.body === 'Amna Khan mentioned you: “Look at this”')
check('…one per issue on the device, opening the issue over the dashboard, with the unread count',
  mention.tag === 'i-web-2' && mention.path === '#/dashboard?issue=WEB-2' && mention.unread === 3)
const status = message.pushMessage({
  id: 'n-8', kind: 'status_changed', detail: 'Done', issue_id: 'i-web-2', actor: null, comment: null,
  issue: { key: 'WEB-2', title: 'Hero banner' },
}, 1)
check('a status change quotes nothing', status.body === 'Someone moved it to Done')
const test = message.pushMessage({ id: 'n-7', kind: 'test', detail: null, issue_id: null, actor: null, comment: null, issue: null }, 0)
check('a test names the app and opens the dashboard', test.title === 'Elevance Work' && test.path === '#/dashboard' && test.tag === 'test-n-7')

// ---------------------------------------------------------------------------
// Whether a device can have them, and what the bell says
// ---------------------------------------------------------------------------
const facts = {
  vapidKey: 'k', hasWorker: true, hasPush: true, hasNotification: true, permission: 'granted' as NotificationPermission,
  device: { os: 'android' as const, browser: 'chrome' as const, mobile: true }, standalone: false, subscribed: true, registered: true,
}
check('on: subscribed, allowed and registered to you', pushStatus(facts) === 'on')
check('off when the server no longer has it', pushStatus({ ...facts, registered: false }) === 'off')
check('blocked when refused', pushStatus({ ...facts, permission: 'denied' }) === 'blocked')
check('an iPhone tab must install first', pushStatus({ ...facts, device: { os: 'ios', browser: 'safari', mobile: true } }) === 'install-first')
check('…an iPhone Home Screen app can have them',
  pushStatus({ ...facts, device: { os: 'ios', browser: 'safari', mobile: true }, standalone: true }) === 'on')
check('a build without a key says not set up', pushStatus({ ...facts, vapidKey: '' }) === 'unconfigured')
check('no Web Push: unsupported, and the bell says nothing', pushStatus({ ...facts, hasPush: false }) === 'unsupported' &&
  pushPrompt('unsupported') === null)
check('off is offered, until snoozed', pushPrompt('off')?.canEnable === true && pushPrompt('off', { snoozedUntil: Date.now() + 1000 }) === null)
check('a device that stopped says so, snoozed or not',
  pushPrompt('off', { wasOn: true, snoozedUntil: Date.now() + 1000 })?.kind === 'stopped')
check('a device has a name a person knows', deviceLabel({ os: 'android', browser: 'chrome', mobile: true }) === 'Chrome on Android' &&
  deviceLabel({ os: 'ios', browser: 'safari', mobile: true }, true) === 'Home Screen app on iPhone or iPad')
check('the VAPID key is handed to the browser as its 65 bytes', vapidKeyBytes(RFC.asPublic).length === 65)

// ---------------------------------------------------------------------------
// The service worker
// ---------------------------------------------------------------------------
const plugin = pwa({ id: 'el-work', name: 'Elevance Work', shortName: 'Work', description: 'x', themeColor: '#000', backgroundColor: '#fff' })
;(plugin.configResolved as (c: { base: string }) => void)({ base: '/work/' })
const emitted: Record<string, string> = {}
;(plugin.generateBundle as (this: unknown, o: unknown, b: unknown) => void).call(
  { emitFile: (f: { fileName: string; source: string }) => { emitted[f.fileName] = f.source } },
  {}, { 'index.html': { source: '<html></html>' }, 'assets/app.js': {} })
const sw = emitted['sw.js']
check('the worker handles pushes and taps', sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'"))
check('…and caches the status-bar badge with the app', sw.includes('icons/badge-96.png'))

const SCOPE = 'https://app.example/work/'
function boot({ windows = [] as string[] } = {}) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const log = { shown: [] as { title: string; options: Record<string, unknown> & { data: { url: string } } }[], badges: [] as number[],
    opened: [] as string[], focused: [] as string[], messages: [] as { url: string; m: { type: string; url?: string; id?: string } }[] }
  const self = {
    registration: { scope: SCOPE, showNotification: async (title: string, options: never) => { log.shown.push({ title, options }) } },
    clients: {
      matchAll: async () => windows.map((url) => ({
        url, postMessage: (m: never) => log.messages.push({ url, m }), focus: async () => { log.focused.push(url) },
      })),
      openWindow: async (url: string) => { log.opened.push(url) },
      claim: async () => {},
    },
    navigator: { setAppBadge: async (n: number) => log.badges.push(n), clearAppBadge: async () => log.badges.push(0) },
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn },
    skipWaiting: () => {},
  }
  vm.runInNewContext(sw, { self, caches: {}, URL, Response, Request, fetch, Promise, JSON, Date, console })
  const fire = async (type: string, event: object) => {
    let pending: Promise<unknown> = Promise.resolve()
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => { pending = p } })
    await pending
  }
  return { fire, log }
}
const pushEvent = (data: unknown) => ({
  data: typeof data === 'string' ? { json: () => JSON.parse(data), text: () => data } : { json: () => data, text: () => JSON.stringify(data) },
})
{
  const { fire, log } = boot({ windows: [`${SCOPE}#/projects/WEB/board`] })
  await fire('push', pushEvent(mention))
  const shown = log.shown[0]
  check('a push shows its title and body', shown?.title === 'WEB-2 · Hero banner' && shown.options.body === mention.body)
  check('…one per issue, a newer one still alerting', shown?.options.tag === 'i-web-2' && shown.options.renotify === true)
  check('…with the app icon and the status-bar badge',
    shown?.options.icon === `${SCOPE}icons/icon-192.png` && shown.options.badge === `${SCOPE}icons/badge-96.png`)
  check('…remembers the page a tap opens, inside the app', shown?.options.data.url === `${SCOPE}#/dashboard?issue=WEB-2`)
  check('…counts unread on the app icon', log.badges.at(-1) === 3)
  check('…and tells an open window, so its bell refreshes', log.messages.some((x) => x.m.type === 'push' && x.m.id === 'n-9'))
}
{
  const { fire, log } = boot()
  await fire('push', pushEvent('not json'))
  check('a payload it cannot read still shows something (never a silent push)',
    log.shown[0]?.title === 'Elevance Work' && log.shown[0]?.options.body === 'not json')
}
for (const [path, why] of [['https://evil.example/', 'another site'], ['../support/', 'a sibling app on the same origin']]) {
  const { fire, log } = boot()
  await fire('push', pushEvent({ title: 'x', path }))
  check(`a tap never leads to ${why}`, log.shown[0]?.options.data.url === SCOPE)
}
{
  const { fire, log } = boot({ windows: [`${SCOPE}#/projects/WEB/board`] })
  const event = { notification: { data: { url: `${SCOPE}#/dashboard?issue=WEB-2` }, closed: false, close() { this.closed = true } } }
  await fire('notificationclick', event)
  check('a tap closes the notification, and focuses the open app', event.notification.closed && log.focused[0] === `${SCOPE}#/projects/WEB/board`)
  check('…which goes to the issue itself, without a new window', log.opened.length === 0 &&
    log.messages.some((x) => x.m.type === 'open' && x.m.url === `${SCOPE}#/dashboard?issue=WEB-2`))
}
{
  const { fire, log } = boot()
  await fire('notificationclick', { notification: { data: { url: `${SCOPE}#/dashboard?issue=WEB-2` }, close() {} } })
  check('with the app closed, a tap opens it on the issue', log.opened[0] === `${SCOPE}#/dashboard?issue=WEB-2`)
}

// ---------------------------------------------------------------------------
// The app: turning a device on from the bell
// ---------------------------------------------------------------------------
const prompt = () => document.querySelector('[data-push-prompt]')
const inPrompt = (name: string) => [...(prompt()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name)
const bell = () => document.querySelector<HTMLElement>('button[aria-label^="Notifications"]')
const openBell = async () => {
  await click(bell())
  await settle(100)
}
const devices = () => table('push_subscriptions')

reset()
window.localStorage.clear()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await openBell()
check('the bell offers to turn notifications on for this device', prompt()?.getAttribute('data-push-prompt') === 'off' &&
  !!inPrompt('Turn on') && !!inPrompt('Not now'))
await click(inPrompt('Not now'))
check('"Not now" puts it away', !prompt())
await mountApp('/dashboard')
await openBell()
check('…and it stays away for a while', !prompt())
window.localStorage.clear()

await mountApp('/dashboard')
await openBell()
await click(inPrompt('Turn on'))
await settle(100)
check('Turn on asks the browser\'s permission', browser.asked === 1 && browser.permission === 'granted')
check('…subscribes with the app\'s key', browser.subscribedWith?.applicationServerKey.length === 65)
check('…and registers this device to you', devices().length === 1 && devices()[0].profile_id === PEOPLE.member.id &&
  captured.rpcs.some((r) => r.name === 'save_push_subscription' && r.args?.p_refresh_only === false && r.args?.p_endpoint === ENDPOINT))
check('…then the bell stops offering', !prompt())

// ---------------- the settings ----------------
await mountApp('/dashboard')
await click(button('Account menu'))
await click(menuItem('Notifications'))
await settleLazy()
check('the account menu has the notification settings', !!dialog()?.textContent?.includes('On this device'))
check('…saying this device is on, and listing it', !!dialog()?.textContent?.includes('(this device)') &&
  [...(dialog()?.querySelectorAll('.MuiChip-label') ?? [])].some((c) => c.textContent === 'On'))
await click(button('Send a test', dialog()!))
await settle(100)
check('Send a test sends one, to you', captured.rpcs.some((r) => r.name === 'send_test_notification') &&
  table('notifications').some((n) => n.kind === 'test' && n.recipient_id === PEOPLE.member.id))
check('…and says it is on its way', !!dialog()?.textContent?.includes('It should appear'))

devices().push({ id: 'd-other', profile_id: PEOPLE.member.id, endpoint: 'https://push.example/laptop', device: 'Safari on Mac',
  created_at: new Date().toISOString(), last_used_at: null })
await mountApp('/dashboard')
await click(button('Account menu'))
await click(menuItem('Notifications'))
await settleLazy()
await click(button('Remove Safari on Mac', dialog()!))
check('another device can be removed from here', !devices().some((d) => d.id === 'd-other') &&
  captured.deletes.some((d) => d.table === 'push_subscriptions' && JSON.stringify(d.filters) === '[["id","eq","d-other"]]'))
check('…leaving this one on', devices().length === 1 && subscription !== null)

// ---------------- a device that stopped ----------------
devices().length = 0 // removed on another device, or dropped by push-send as gone
await mountApp('/dashboard')
await settle(100)
check('a device that stopped puts a mark on the bell', !!bell()?.getAttribute('aria-label')?.includes('stopped on this device'))
await openBell()
check('…and says so, with no "Not now"', prompt()?.getAttribute('data-push-prompt') === 'stopped' &&
  !!inPrompt('Turn back on') && !inPrompt('Not now') && text().includes('stopped on this device'))
await click(inPrompt('Turn back on'))
await settle(100)
check('Turn back on registers it again', devices().length === 1 && !prompt())

// ---------------- a shared browser ----------------
signInAs(PEOPLE.admin)
await mountApp('/dashboard')
await settle(100)
check('someone else signing in on this browser ends the last person\'s registration', devices().length === 0)
await openBell()
check('…and is offered to turn it on, not told it stopped', prompt()?.getAttribute('data-push-prompt') === 'off')

// ---------------- signing out ----------------
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await openBell()
await click(inPrompt('Turn back on') ?? inPrompt('Turn on'))
await settle(100)
const unsubscribedBefore = browser.unsubscribed
await click(button('Account menu'))
await click(menuItem('Sign out'))
await settle(200)
check('signing out forgets this device: its row, then the browser\'s subscription', devices().length === 0 &&
  browser.unsubscribed === unsubscribedBefore + 1 && subscription === null)
check('…and then signs out', captured.calls.includes('push_subscriptions.delete') &&
  captured.auth.some((a) => a.call === 'signOut'))

// ---------------- blocked ----------------
reset()
window.localStorage.clear()
browser.permission = 'denied'
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await openBell()
check('blocked: says where to allow them, with nothing to press but Not now',
  prompt()?.getAttribute('data-push-prompt') === 'blocked' && !inPrompt('Turn on') && !!inPrompt('Not now'))
browser.permission = 'granted'

// ---------------------------------------------------------------------------
// The app: badge, live refresh, taps and reading
// ---------------------------------------------------------------------------
reset()
signInAs(PEOPLE.member)
browser.badges.length = 0
await mountApp('/issues')
await settle(100)
check('the app\'s icon counts unread notifications', browser.badges.at(-1) === 1)

const feedReads = () => captured.selects.filter((s) => s.table === 'notifications').length
const before = feedReads()
table('notifications').push({ ...table('notifications')[0], id: 'n-new', kind: 'assigned', issue_id: 'i-web-5', comment_id: null })
await fromWorker({ type: 'push', id: 'n-new' })
check('a push arriving refreshes the bell', feedReads() > before && !!bell()?.getAttribute('aria-label')?.includes('2 unread'))
check('…and the icon', browser.badges.at(-1) === 2)

await fromWorker({ type: 'open', url: 'http://localhost/#/dashboard?issue=WEB-2' })
check('a tapped notification opens its issue over the page you are on',
  await waitFor(() => location.pathname === '/issues' && location.search === '?issue=WEB-2'))
await settleLazy()
check('…in the dialog', await waitFor(() => dialog()?.textContent?.includes('Hero banner')))
check('opening an issue marks its notifications read', await waitFor(() => captured.updates.some((u) => u.table === 'notifications' &&
  JSON.stringify(u.filters) === '[["recipient_id","eq","p-sara"],["issue_id","eq","i-web-2"],["read_at","is",null]]')))
check('…and the bell counts one fewer', await waitFor(() => bell()?.getAttribute('aria-label') === 'Notifications (1 unread)'))

await fromWorker({ type: 'open', url: 'https://evil.example/#/admin/people' })
check('a message naming another site goes nowhere', location.search === '?issue=WEB-2')

done()

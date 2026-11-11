// Installing the app: telling the device and browser apart, the steps shown
// for each, and the Install button — beside Collapse on a desktop, leading
// the navigation on a phone (until dismissed), gone once installed.
import { setupDom, setScreen, reporter, click, settle, dialog, waitFor, button } from './setup'
setupDom()

const { detectDevice, installGuide, installLabel, isStandalone } = await import('../src/lib/install')
const { mountApp } = await import('./app')
const { reset, signInAs, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneGmail: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
}

// ---------------- telling devices apart ----------------
const d = (ua: string, touch = 0) => detectDevice(ua, touch)
check('an iPhone in Safari', JSON.stringify(d(UA.iphoneSafari)) === '{"os":"ios","browser":"safari","mobile":true}')
check('an iPhone in Chrome', d(UA.iphoneChrome).browser === 'chrome' && d(UA.iphoneChrome).os === 'ios')
check('a link opened inside another iPhone app', d(UA.iphoneGmail).browser === 'in-app')
check('an iPad says Mac, but has a touch screen', d(UA.ipad, 5).os === 'ios' && d(UA.ipad, 0).os === 'mac')
check('Android Chrome', d(UA.androidChrome).os === 'android' && d(UA.androidChrome).browser === 'chrome')
check('Samsung Internet is not Chrome', d(UA.androidSamsung).browser === 'samsung')
check('an Android web view is another app', d(UA.androidWebView).browser === 'in-app')
check('a Mac in Chrome, a computer', d(UA.macChrome).os === 'mac' && d(UA.macChrome).browser === 'chrome' && !d(UA.macChrome).mobile)
check('a Mac in Safari', d(UA.macSafari).browser === 'safari')
check('Edge on Windows is not Chrome', d(UA.winEdge).os === 'windows' && d(UA.winEdge).browser === 'edge')
check('Firefox on Windows', d(UA.winFirefox).browser === 'firefox')

check('a browser tab is not the app', !isStandalone((q) => q === '(display-mode: browser)'))
check('an app window is', isStandalone((q) => q === '(display-mode: standalone)'))
check('nor is a home-screen app on an older iPhone', isStandalone(() => false, true))

// ---------------- the steps ----------------
const guide = (ua: string, touch = 0) => installGuide(detectDevice(ua, touch), 'Elevance Work')
check('iPhone Safari: the share sheet, then Add to Home Screen',
  guide(UA.iphoneSafari).steps.some((s) => s.includes('Share')) && guide(UA.iphoneSafari).steps.some((s) => s.includes('Add to Home Screen')))
check('an iPhone says Add to Home Screen', installLabel(detectDevice(UA.iphoneSafari)) === 'Add to Home Screen')
check('iPhone Chrome needs a newer iOS', guide(UA.iphoneChrome).note?.includes('16.4') === true)
check('inside another app, open Safari first', guide(UA.iphoneGmail).steps[0].includes('Open in Safari'))
check('Samsung has its own menu', guide(UA.androidSamsung).steps.some((s) => s.includes('Add page to')))
check('Edge on Windows: Apps, then install', guide(UA.winEdge).steps.some((s) => s.includes('Install this site as an app')))
check('Safari on a Mac: Add to Dock', guide(UA.macSafari).steps.some((s) => s.includes('Add to Dock')))
check('Firefox cannot, and says where to go instead',
  guide(UA.winFirefox).steps.length === 0 && guide(UA.winFirefox).note?.includes('Chrome or Edge') === true)
check('a computer is told about a window, a phone its home screen',
  guide(UA.macChrome).title === 'Install Elevance Work' && guide(UA.androidChrome).title.includes('Home Screen'))

// ---------------- the page ----------------
const setUserAgent = (ua: string, touch = 0) => {
  Object.defineProperty(window.navigator, 'userAgent', { get: () => ua, configurable: true })
  Object.defineProperty(window.navigator, 'maxTouchPoints', { get: () => touch, configurable: true })
}
const installButton = () => document.querySelector<HTMLElement>('.MuiDrawer-root [aria-label="Install app"]')
const collapseButton = () => document.querySelector('.MuiDrawer-root [aria-label="Collapse navigation"]')
const banner = () => document.querySelector('[aria-label="Install the app"]')

reset()
signInAs(PEOPLE.member)
setUserAgent(UA.macChrome)
window.localStorage.clear()
await mountApp('/dashboard')

const install = installButton()
check('desktop: Install sits in the foot of the navigation', install !== null)
check('in one row with Collapse, Collapse first',
  install !== null && collapseButton() !== null && install.parentElement === collapseButton()?.parentElement &&
    (collapseButton()!.compareDocumentPosition(install) & 4) !== 0)
check('no offer at the top of a desktop navigation', banner() === null)

// No offer from the browser yet: the steps.
await click(install)
check('without the browser\'s offer it shows the steps', dialog()?.textContent?.includes('Install page as app') === true,
  dialog()?.textContent)
await click(button('Close', dialog()!))
await waitFor(() => !dialog())

// The browser offers to install: the button asks it directly.
let prompted = 0
const offer = Object.assign(new window.Event('beforeinstallprompt', { cancelable: true }), {
  prompt: async () => { prompted++ },
  userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
})
window.dispatchEvent(offer)
check('the browser\'s own banner is held back', offer.defaultPrevented)
await click(installButton())
check('with an offer, Install opens the browser\'s dialog', prompted === 1)
check('turned down there, no steps follow', dialog() === null)
await click(installButton())
check('an offer is used once; then it is the steps again', prompted === 1 && dialog() !== null)
await click(button('Close', dialog()!))
await waitFor(() => !dialog())

// Collapsed: an icon above Collapse.
window.localStorage.removeItem('elevance.nav-collapsed')
await click(collapseButton())
await settle()
const expand = document.querySelector('.MuiDrawer-root [aria-label="Expand navigation"]')
check('collapsed, Install is an icon above Expand',
  installButton() !== null && expand !== null && (installButton()!.compareDocumentPosition(expand) & 4) !== 0 &&
    !installButton()!.textContent?.trim())
await click(expand)
await settle()

// Opened as the app.
setScreen({ displayMode: 'standalone' })
await mountApp('/dashboard')
check('running as the app, there is nothing to install', installButton() === null && collapseButton() !== null)
setScreen({ displayMode: 'browser' })

// ---------------- a phone ----------------
setScreen({ width: 390 })
setUserAgent(UA.iphoneSafari)
window.localStorage.clear()
await mountApp('/dashboard')
check('a phone has no navigation foot', collapseButton() === null)
await click(document.querySelector('[aria-label="Open navigation"]'))
await settle()
const offerBox = banner()
const firstPage = document.querySelector('.MuiDrawer-root a[aria-label="Dashboard"]')
check('opened, the navigation leads with the offer',
  offerBox !== null && firstPage !== null && (offerBox.compareDocumentPosition(firstPage) & 4) !== 0)
check('in iPhone words', offerBox?.textContent?.includes('home screen') === true && button('Add to Home Screen', offerBox!) !== undefined)
await click(button('Add to Home Screen', offerBox!))
check('an iPhone cannot be asked: it shows the steps', dialog()?.textContent?.includes('Open as Web App') === true)
await click(button('Close', dialog()!))
await waitFor(() => !dialog())

await click(button('Dismiss', banner()!))
check('dismissed, it goes', banner() === null)
check('and is remembered in this browser', window.localStorage.getItem('el-work:install-dismissed') === '1')
await mountApp('/dashboard')
await click(document.querySelector('[aria-label="Open navigation"]'))
await settle()
check('a fresh load does not bring it back', banner() === null && document.querySelector('.MuiDrawer-root a[aria-label="Dashboard"]') !== null)

window.localStorage.clear()
setScreen({ displayMode: 'standalone' })
await mountApp('/dashboard')
await click(document.querySelector('[aria-label="Open navigation"]'))
await settle()
check('a phone running the app is not offered it', banner() === null)
setScreen({ width: 1280, displayMode: 'browser' })

// ---------------- installed from the tab ----------------
setUserAgent(UA.macChrome)
await mountApp('/dashboard')
check('a desktop tab offers it again', installButton() !== null)
// Installed during this visit: gone.
window.dispatchEvent(new window.Event('appinstalled'))
await settle()
check('once installed, the button goes', installButton() === null)

done()

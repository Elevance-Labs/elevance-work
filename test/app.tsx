// Mounts the real app — AuthProvider, routes, layout — at a path, the way
// main.tsx does but with a MemoryRouter. Sign in first with `signInAs` from
// the mock. Import this only after `setupDom()`.
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'
import App from '../src/App'
import { AuthProvider } from '../src/auth/AuthProvider'
import { clearProjectMeta } from '../src/workspace/useProjectMeta'
import { theme } from '../src/theme'
import { settle } from './setup'

let root: Root | null = null

/** Where the router is now, so a test can see a redirect land. */
export const location = { pathname: '', search: '' }

function LocationProbe() {
  const { pathname, search } = useLocation()
  location.pathname = pathname
  location.search = search
  return null
}

export async function mountApp(path = '/') {
  root?.unmount()
  // Project meta is cached per session; a new mount is a new session.
  clearProjectMeta()
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  root.render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <App />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  )
  await settle(80)
  // Once the sign-in spinner goes there is a commit with no spinner before a
  // <Navigate> redirect lands; on a cold run settle() can stop right there.
  await settle()
  await settle()
}

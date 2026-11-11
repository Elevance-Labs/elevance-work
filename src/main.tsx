import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'
import '@fontsource/roboto/latin-400.css'
import '@fontsource/roboto/latin-500.css'
import '@fontsource/roboto/latin-700.css'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import UpdatePrompt from './components/UpdatePrompt'
import { listenForInstall } from './pwa'
import { theme } from './theme'

// GitHub Pages can't send X-Frame-Options or frame-ancestors, so the app
// refuses to run inside another site's frame, where it could be overlaid to
// trick someone into clicking (clickjacking).
if (window.top !== window.self) {
  document.getElementById('root')!.textContent = 'Elevance Work cannot be shown inside another page.'
} else {
  // Before the first render: the browser's install offer can come at once.
  listenForInstall()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <UpdatePrompt />
        <AuthProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}

import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { pwa } from './vite.pwa'

// GitHub Pages can't send response headers, so the built page carries its
// Content Security Policy as a meta tag. Only scripts from the app itself run;
// the page talks only to Supabase (HTTPS, and a websocket for Realtime),
// shows Google profile photos, and frames only Google Docs / Drive previews.
// A new external host must be added here. Build only: the dev server injects
// inline scripts this policy would block.
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : ''
  const realtime = supabase.replace(/^http/, 'ws')
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // MUI (emotion) writes its styles into <style> tags at runtime.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase} https://*.googleusercontent.com`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${realtime}`,
    'frame-src https://docs.google.com https://drive.google.com https://accounts.google.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
      // Open the connection to Supabase (DNS, TLS) while the scripts load and
      // parse, rather than at the first request. crossorigin: the app's
      // requests to it are CORS without cookies, and use that connection.
      ...(supabase ? [{ tag: 'link', attrs: { rel: 'preconnect', href: supabase, crossorigin: 'anonymous' }, injectTo: 'head' as const }] : []),
    ],
  }
}

export default defineConfig(({ mode }) => ({
  // Relative base so the build works under any GitHub Pages sub-path.
  base: './',
  plugins: [
    react(),
    contentSecurityPolicy(loadEnv(mode, process.cwd()).VITE_SUPABASE_URL),
    // Installable. The service worker keeps the app's own files only; it never
    // answers for, or stores, anything from Supabase.
    pwa({
      id: 'el-work',
      name: 'Elevance Work',
      shortName: 'Work',
      description: 'The Elevance Labs work tracker',
      themeColor: '#3f51b5',
      backgroundColor: '#f6f7fb',
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // React, MUI and drag-and-drop are big and change rarely: their own
        // chunks cache well across deploys. A group takes its modules'
        // dependencies along, so React, which the others depend on, is
        // claimed first; else it rides in the dnd chunk and drag-and-drop
        // loads with the first screen. (The editor is already split off:
        // only lazily loaded modules import it.)
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/, priority: 3 },
            { name: 'mui', test: /node_modules[\\/](@mui|@emotion)[\\/]/, priority: 2 },
            { name: 'dnd', test: /node_modules[\\/]@dnd-kit[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
}))

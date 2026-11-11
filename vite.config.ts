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
    rollupOptions: {
      output: {
        // MUI and drag-and-drop are big and change rarely: their own chunks cache well.
        // (The editor is already split off: only lazily loaded modules import it.)
        manualChunks(id) {
          if (id.includes('node_modules/@dnd-kit')) return 'dnd'
          if (id.includes('node_modules/@mui') || id.includes('node_modules/@emotion')) return 'mui'
          return undefined
        },
      },
    },
  },
}))

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const mock = path.resolve('test/mockSupabase.ts')

// Every import of src/lib/supabase resolves to the in-memory mock, so no test
// can reach a real project.
export default defineConfig({
  // A build with device notifications set up (the key is RFC 8291's example
  // sender key; nothing is ever pushed). jsdom has no Web Push, so every page
  // but the push tests (which install one) sees "unsupported" and stays quiet.
  define: {
    'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
  },
  plugins: [
    react(),
    {
      name: 'mock-supabase',
      enforce: 'pre',
      resolveId(source) {
        if (/(^|\/)lib\/supabase(\.ts)?$/.test(source) || /^\.\/supabase(\.ts)?$/.test(source)) return mock
        return null
      },
    },
  ],
})

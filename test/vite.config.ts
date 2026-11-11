import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const mock = path.resolve('test/mockSupabase.ts')

// Every import of src/lib/supabase resolves to the in-memory mock, so no test
// can reach a real project.
export default defineConfig({
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

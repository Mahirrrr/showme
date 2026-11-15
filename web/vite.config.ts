import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { suggestTestsDev } from './server/suggestTests.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' prefix = also load non-VITE_ vars. They stay in Node (this file),
  // they are NOT exposed to browser code. Only VITE_* vars reach the bundle.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Dev-only Gemini route; in production vision/ serves /api/tests/suggest.
      suggestTestsDev({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL || 'gemini-2.5-flash',
        catalogPath: fileURLToPath(new URL('../shared/tests.json', import.meta.url)),
      }),
    ],
    server: {
      // shared/ lives one level up (mock_request.json, tests.json)
      fs: { allow: ['..'] },
      // In production nginx proxies /api to uvicorn; in dev Vite does it.
      proxy: { '/api': 'http://localhost:8000' },
    },
  }
})

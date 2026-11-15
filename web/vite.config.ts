import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // shared/ lives one level up (mock_request.json, tests.json)
    fs: { allow: ['..'] },
    // In production nginx proxies /api to uvicorn; in dev Vite does it.
    // /api/tests/suggest (Gemini) is served by vision/ like every other route.
    proxy: { '/api': 'http://localhost:8000' },
  },
})

// AIT-TBC | vite.config.ts | Ramesh Konda | 2026-10-28 | Vite dev/build config; proxies /api to the mail server
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Forward API calls to the mail server (npm run server)
        proxy: {
          '/api': `http://localhost:${env.MAIL_SERVER_PORT || 3001}`,
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

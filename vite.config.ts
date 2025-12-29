import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  // Fix: Cast process to any to avoid TS error about 'cwd' missing on type 'Process'
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    define: {
      // This is critical: It replaces `process.env.API_KEY` in your client code 
      // with the actual value from Vercel's Environment Variables during the build.
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      // Polyfill simple process.env checks if any libraries use them
      'process.env': {} 
    }
  };
});
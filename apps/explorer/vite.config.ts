import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// VITE_API_URL is the HTTP API's $default execute-api URL (decisions 21); the mirror is same-origin under /tables/*.
export default defineConfig({ plugins: [react()] });

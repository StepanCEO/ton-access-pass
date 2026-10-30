import { defineConfig } from 'vite';

export default defineConfig({
    build: { target: 'es2020', chunkSizeWarningLimit: 600 }, // TON Connect UI (~520 КБ) грузится отдельным чанком
});

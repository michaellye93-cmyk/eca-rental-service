import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '127.0.0.1',
        strictPort: true,
      },
      plugins: [react(), tailwindcss()],
      build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: ['react', 'react-dom', 'lucide-react', '@supabase/supabase-js']
            }
          }
        }
      },
      optimizeDeps: {
        include: ['react', 'react-dom', 'lucide-react', '@supabase/supabase-js']
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

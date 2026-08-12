import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173
  },
  preview: {
    // 局域网 IP 漂移或使用 *.local 主机名时仍可访问
    allowedHosts: true
  }
});

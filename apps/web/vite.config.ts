import { defineConfig } from "vite";

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const backendHost = process.env.HOST ?? "127.0.0.1";
const backendPort = parsePort(process.env.PORT, 8787);
const webDevHost = process.env.WEB_DEV_HOST ?? "127.0.0.1";
const webDevPort = parsePort(process.env.WEB_DEV_PORT, 5173);
const webPreviewHost = process.env.WEB_PREVIEW_HOST ?? "127.0.0.1";
const webPreviewPort = parsePort(process.env.WEB_PREVIEW_PORT, 4173);
const apiTarget = `http://${backendHost}:${backendPort}`;

export default defineConfig({
  server: {
    host: webDevHost,
    port: webDevPort,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      }
    }
  },
  preview: {
    host: webPreviewHost,
    port: webPreviewPort,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});

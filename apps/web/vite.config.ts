import { defineConfig } from "vite";

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const backendHost = process.env.HOST ?? "127.0.0.1";
const backendPort = parsePort(process.env.PORT, 8787);
const webDevHost = process.env.WEB_DEV_HOST ?? "127.0.0.1";
const webDevPort = parsePort(process.env.WEB_DEV_PORT, 5173);
const webPreviewHost = process.env.WEB_PREVIEW_HOST ?? "127.0.0.1";
const webPreviewPort = parsePort(process.env.WEB_PREVIEW_PORT, 4173);
const webAllowedHosts = unique([
  "localhost",
  "127.0.0.1",
  ".ts.net",
  webDevHost,
  webPreviewHost,
  ...parseCsv(process.env.WEB_ALLOWED_HOSTS)
]);
const apiTarget = `http://${backendHost}:${backendPort}`;

export default defineConfig({
  server: {
    host: webDevHost,
    port: webDevPort,
    allowedHosts: webAllowedHosts,
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
    allowedHosts: webAllowedHosts,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});

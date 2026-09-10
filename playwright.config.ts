import { defineConfig } from "@playwright/test";

// E2E 冒烟测试：本地起 Vite dev server，chromium 无头执行。
// 运行：npm run test:e2e（首次需 npx playwright install chromium）
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5179",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5179 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5179",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

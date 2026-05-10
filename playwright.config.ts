import { defineConfig, devices } from "@playwright/test";

const usePreviewServer = process.env.PLAYCIRCLE_PLAYWRIGHT_SERVER === "preview";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: usePreviewServer ? "npm run preview" : "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    }
  ]
});

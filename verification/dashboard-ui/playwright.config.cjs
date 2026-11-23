const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  projects: [
    { name: "dashboard-ui", testDir: __dirname, testMatch: "*.pw.cjs" },
    { name: "dashboard-layout", testDir: "../../e2e", testMatch: "dashboard-chart-layout.spec.cjs" }
  ],
  outputDir: require("node:path").join(__dirname, "../../.tmp/dashboard-ui/results"),
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 5_000 },
  use: { browserName: "chromium", serviceWorkers: "block", actionTimeout: 6500, viewport: { width: 1440, height: 960 } }
});

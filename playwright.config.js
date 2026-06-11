const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  use: {
    baseURL: 'http://localhost:4321',
    headless: true,
  },
  webServer: {
    command: 'npx serve . --listen 4321 --no-clipboard',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});

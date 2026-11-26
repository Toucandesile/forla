import { defineConfig, devices } from '@playwright/test';

// BASE_URL permet de tester la version en ligne : BASE_URL=https://… npx playwright test
const remote = process.env.BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: remote ?? 'http://localhost:4321',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
  },
  webServer: remote
    ? undefined
    : {
        command: 'npm run preview -- --port 4321 --strictPort',
        url: 'http://localhost:4321',
        reuseExistingServer: true,
        timeout: 60_000,
      },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});

import { defineConfig, devices } from '@playwright/test';

// Two servers on throwaway data directories: the normal one, and one that requires an
// invite code. `npm run test:e2e` builds the frontend first, so both serve the same dist/.
const server = (port: number, dir: string, env = '') => ({
  command: `rm -rf ${dir} && PORT=${port} DATA_DIR=${dir} SESSION_SECRET=e2e-secret-e2e-secret-e2e-secret-x ${env} node --import tsx backend/server.ts`,
  url: `http://localhost:${port}/api/health`,
  reuseExistingServer: false,
});

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  webServer: [server(3100, 'e2e/.data/main'), server(3101, 'e2e/.data/invite', 'REGISTRATION_CODE=let-me-in-please')],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});

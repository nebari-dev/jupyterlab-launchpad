/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

module.exports = {
  ...baseConfig,
  projects: [
    { testIgnore: '**/readme.spec.ts' },
    {
      name: 'readme',
      testMatch: '**/readme.spec.ts',
      // These baselines are the images displayed in the README itself.
      snapshotPathTemplate: '{testDir}/../docs/images/{arg}{ext}'
    }
  ],
  webServer: {
    command: 'jlpm start',
    url: 'http://localhost:8888/lab',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  },
  workers: 1
};

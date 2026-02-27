import { expect, test } from '@jupyterlab/galata';

/**
 * Tests for server-proxy launcher icons.
 *
 * These tests mock the server-proxy API to simulate having a configured
 * server-proxy entry with an icon, then verify the launcher renders
 * the icon as an <img> element with the correct class.
 */

const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="10" fill="#4a90d9"/>
  <text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-family="sans-serif">T</text>
</svg>`;

test.describe('Server proxy icons', () => {
  // Prevent automatic navigation so we can set up route mocks first
  test.use({ autoGoto: false });

  test('should render server-proxy icon in launcher card', async ({
    page,
    baseURL
  }) => {
    // Mock the server-proxy servers-info endpoint
    await page.route('**/server-proxy/servers-info', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          server_processes: [
            {
              name: 'test-app',
              new_browser_tab: false,
              launcher_entry: {
                enabled: true,
                title: 'Test App',
                path_info: 'test-app',
                icon_url: '/server-proxy/icon/test-app'
              }
            }
          ]
        })
      });
    });

    // Mock the icon URL to return a deterministic SVG
    await page.route('**/server-proxy/icon/test-app', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: TEST_SVG
      });
    });

    // Navigate to JupyterLab
    await page.goto(baseURL ?? 'http://localhost:8888');

    // Wait for the launcher to be ready
    const launcher = page.locator('.jp-LauncherBody');
    await expect(launcher).toBeVisible({ timeout: 30000 });

    // Wait for the server-proxy card to appear
    const serverProxyCard = launcher.locator(
      '.jp-Launcher-TypeCard:has(img.jp-Launcher-kernelIcon)'
    );
    await expect(serverProxyCard).toBeVisible({ timeout: 10000 });

    // Verify the img element has the correct attributes
    const img = serverProxyCard.locator('img.jp-Launcher-kernelIcon');
    await expect(img).toHaveAttribute('src', /server-proxy\/icon\/test-app/);

    // Verify the card label
    const label = serverProxyCard.locator('.jp-LauncherCard-label');
    await expect(label).toContainText('Test App');

    // Screenshot just the "Create Empty" section containing the server-proxy card
    const createEmptySection = launcher.locator(
      '.jp-CollapsibleSection:has(.jp-Launcher-TypeCard)'
    );
    expect(await createEmptySection.screenshot()).toMatchSnapshot(
      'server-proxy-icon-in-launcher.png'
    );
  });
});

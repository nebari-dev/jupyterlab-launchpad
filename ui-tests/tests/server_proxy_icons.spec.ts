import { expect, test } from '@jupyterlab/galata';

/**
 * Tests for server-proxy launcher icons.
 *
 * These tests rely on jupyter-server-proxy being installed and configured
 * with a test entry in jupyter_server_test_config.py. The server-proxy
 * extension registers a "Test App" launcher item with an icon URL, and
 * the launcher should render it as an <img> element.
 */

test.describe('Server proxy icons', () => {
  test('should render server-proxy icon in launcher card', async ({ page }) => {
    const launcher = page.locator('.jp-LauncherBody');
    await expect(launcher).toBeVisible();

    // The server-proxy "Test App" card should appear in the "Create Empty" section
    // with an <img> tag (not a LabIcon) because it uses kernelIconUrl
    const serverProxyCard = launcher.locator(
      '.jp-Launcher-TypeCard:has(img.jp-Launcher-kernelIcon)'
    );
    await expect(serverProxyCard).toBeVisible({ timeout: 10000 });

    // Verify the img element has the correct attributes
    const img = serverProxyCard.locator('img.jp-Launcher-kernelIcon');
    await expect(img).toHaveAttribute('src', /server-proxy\/icon\//);

    // Verify the card label
    const label = serverProxyCard.locator('.jp-LauncherCard-label');
    await expect(label).toContainText('Test App');

    // Screenshot the "Create Empty" section for visual regression
    const createEmptySection = launcher.locator(
      '.jp-CollapsibleSection:has(.jp-Launcher-TypeCard)'
    );
    expect(await createEmptySection.screenshot()).toMatchSnapshot(
      'server-proxy-icon-in-launcher.png'
    );
  });
});

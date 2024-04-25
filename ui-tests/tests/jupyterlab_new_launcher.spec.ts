import { expect, test } from '@jupyterlab/galata';

test('should render new launcher', async ({ page }) => {
  const launcher = page.locator('jp-LauncherBody');
  expect(await launcher.screenshot()).toMatchSnapshot('launcher.png');
});

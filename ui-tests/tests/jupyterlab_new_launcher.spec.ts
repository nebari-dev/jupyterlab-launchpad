import { expect, test, galata } from '@jupyterlab/galata';

const SETTINGS_ID = 'jupyterlab-new-launcher:plugin';

test.describe('Default settings', () => {
  test('should render new launcher', async ({ page }) => {
    const launcher = page.locator('.jp-LauncherBody');
    expect(await launcher.screenshot()).toMatchSnapshot('launcher.png');
  });
});

test.describe('With starred section', () => {
  test.use({
    mockSettings: {
      ...galata.DEFAULT_SETTINGS,
      [SETTINGS_ID]: {
        ...galata.DEFAULT_SETTINGS[SETTINGS_ID],
        starredSection: true
      }
    }
  });

  test('should render new launcher with starred section', async ({ page }) => {
    const launcher = page.locator('.jp-LauncherBody');
    // expand the console section
    await page.locator('.jp-Launcher-launchConsole summary').click();
    // star some items
    await page
      .locator('.jp-Launcher-launchNotebook .jp-starIconButton')
      .click();
    await page.locator('.jp-Launcher-launchConsole .jp-starIconButton').click();
    // collapse the "create empty" section
    await page.locator('.jp-Launcher-openByType summary').click();
    // wait for animations to complete
    await page.waitForTimeout(400);
    expect(await launcher.screenshot()).toMatchSnapshot(
      'launcher-with-starred.png'
    );
  });
});

test.describe('Filter individual', () => {
  test.use({
    mockSettings: {
      ...galata.DEFAULT_SETTINGS,
      [SETTINGS_ID]: {
        ...galata.DEFAULT_SETTINGS[SETTINGS_ID],
        searchAllSections: false
      }
    }
  });

  test('search in individual sections', async ({ page }) => {
    const launcher = page.locator('.jp-LauncherBody');
    expect(await launcher.screenshot()).toMatchSnapshot(
      'launcher-search-in-individual.png'
    );
  });
});

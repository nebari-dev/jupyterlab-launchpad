import { expect, test, galata } from '@jupyterlab/galata';
import { Page } from '@playwright/test';

const SETTINGS_ID = 'jupyterlab-new-launcher:plugin';

test.describe('Default settings', () => {
  test('should render new launcher', async ({ page }) => {
    const launcher = page.locator('.jp-LauncherBody');
    expect(await launcher.screenshot()).toMatchSnapshot('launcher.png');
  });

  test('should open table context menu', async ({ page }) => {
    const tableHead = page.locator(
      '.jp-Launcher-launchNotebook thead > tr > th[data-id="star"]'
    );
    await tableHead.click({ button: 'right' });
    const contextMenu = page.locator('.jp-NewLauncher-contextMenu');
    await expect(contextMenu).toBeVisible();
    expect
      .soft(await contextMenu.screenshot())
      .toMatchSnapshot('table-context-menu.png');
    const visibleColumnsEntry = page.locator(
      '.jp-NewLauncher-contextMenu li >> text="Visible Columns"'
    );
    await visibleColumnsEntry.hover();
    const columnsContextMenu = page.locator(
      '.jp-NewLauncher-contextMenu-visibleColumns'
    );
    await expect(columnsContextMenu).toBeVisible();
    expect
      .soft(await columnsContextMenu.screenshot())
      .toMatchSnapshot('table-context-menu-visible-columns.png');
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

  const clickOnStars = async (page: Page) => {
    await page
      .locator('.jp-Launcher-launchNotebook .jp-starIconButton')
      .click();
    await page.locator('.jp-Launcher-launchConsole .jp-starIconButton').click();
  };

  test('should render new launcher with starred section', async ({ page }) => {
    const launcher = page.locator('.jp-LauncherBody');
    // expand the console section
    await page.locator('.jp-Launcher-launchConsole summary').click();
    // star some items
    await clickOnStars(page);
    // collapse the "create empty" section
    await page.locator('.jp-Launcher-openByType summary').click();
    // wait for animations to complete
    await page.waitForTimeout(400);
    expect(await launcher.screenshot()).toMatchSnapshot(
      'launcher-with-starred.png'
    );
    // remove stars from the items
    await clickOnStars(page);
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

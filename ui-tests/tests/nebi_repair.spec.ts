import { expect, galata, test } from '@jupyterlab/galata';

test.use({
  autoGoto: false,
  mockSettings: {
    ...galata.DEFAULT_SETTINGS,
    'jupyterlab-launchpad:plugin': {
      launchConsoleSection: false,
      hiddenColumns: { actions: 'visible', nebi_status: 'visible' }
    }
  },
  waitForApplication: async ({}, use) => {
    await use(async page => {
      await page.evaluate(() => window.jupyterapp.restored);
      await page.locator('.jp-LauncherBody').waitFor();
    });
  }
});

// No HTTP routes are fulfilled here: capabilities, repair, refresh and kernel
// discovery all go through Jupyter Server and the installed Launchpad extension.
for (const scenario of [
  {
    name: 'server validation rejects an unavailable repair',
    dependencies: [],
    status: 400,
    detail: 'No automatic repair is available. Open this environment in Nebi.'
  },
  {
    name: 'Pixi fails with multiline stderr',
    dependencies: ['test-failing-kernel'],
    status: 500,
    detail: 'Could not install test-failing-kernel.\nPackage is unavailable.'
  },
  {
    name: 'installation succeeds but discovery still reports an unusable environment',
    dependencies: ['test-no-kernel'],
    status: 200,
    detail:
      'The environment is still unavailable. Open it in Nebi to resolve the remaining problem.'
  }
]) {
  test(`surfaces the error when ${scenario.name}`, async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(
      '[workspace]\nname = "repair-test"\n',
      'text',
      `${tmpPath}/pixi.toml`
    );
    await page.contents.uploadContent(
      JSON.stringify({
        nebi_missing_dependencies: scenario.dependencies,
        nebi_not_ready_reason: 'missing-dependencies'
      }),
      'text',
      `${tmpPath}/nebi-test.json`
    );
    await page.goto(`tree/${tmpPath}?reset`);
    const repair = page
      .locator('.jp-Launcher-launchNotebook tbody tr')
      .filter({ hasText: 'Nebi repair integration fixture' })
      .getByRole('button', {
        name: 'Install missing dependencies',
        exact: true
      });

    const responsePromise = page.waitForResponse(
      '**/jupyterlab-launchpad/nebi/install-dependencies*'
    );
    await repair.click();
    const response = await responsePromise;
    expect(response.status()).toBe(scenario.status);
    if (scenario.status !== 200) {
      // Assert the real APIHandler error body, not just an HTTP status phrase.
      expect(await response.json()).toMatchObject({ message: scenario.detail });
    } else {
      expect(await response.json()).toEqual({ ok: true });
    }

    for (const line of scenario.detail.split('\n')) {
      await expect(
        page.getByRole('alert').filter({ hasText: line })
      ).toBeVisible();
    }
    await expect(
      page.getByRole('alert').filter({ hasText: 'Installing dependencies...' })
    ).toHaveCount(0);
    await expect(repair).toBeEnabled();
    await expect(
      page.getByText('Dependencies installed', { exact: true })
    ).toHaveCount(0);

    if (scenario.dependencies.length) {
      const invocation = await page.request.get(
        `/api/contents/${tmpPath}/pixi-invocation.json`
      );
      expect(invocation.ok()).toBe(true);
      const args = JSON.parse((await invocation.json()).content);
      expect(args).toEqual([
        'add',
        '--manifest-path',
        expect.stringContaining(`${tmpPath}/pixi.toml`),
        ...scenario.dependencies
      ]);
    }
  });
}

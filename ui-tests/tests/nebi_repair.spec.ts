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

// Browser requests use the real Jupyter proxy and the external Nebi API fixture.
for (const scenario of [
  {
    name: 'no missing packages',
    dependencies: [],
    detail: 'No automatic repair is available. Open this environment in Nebi.'
  },
  {
    name: 'failed package job',
    screenshot: 'nebi-repair-install-error.png',
    dependencies: ['example-kernel'],
    detail: 'Could not install example-kernel.\nPackage is unavailable.'
  },
  {
    name: 'completed job without a matching version',
    dependencies: ['missing-version'],
    detail:
      'Could not verify the repair version. Check the job and versions in Nebi before retrying.'
  },
  {
    name: 'environment remains unusable',
    screenshot: 'nebi-repair-still-unavailable.png',
    dependencies: ['test-no-kernel'],
    detail:
      'The environment is still unavailable. Open it in Nebi to resolve the remaining problem.'
  },
  {
    name: 'successful versioned repair',
    dependencies: ['ipykernel'],
    detail: ''
  },
  {
    name: 'uses the current user kernel packages',
    dependencies: ['numpy'],
    kernelDependencies: ['r-irkernel'],
    detail: ''
  }
]) {
  test(scenario.name, async ({ page, tmpPath }) => {
    await page.contents.uploadContent(
      '[workspace]\nname = "repair-test"\n',
      'text',
      `${tmpPath}/pixi.toml`
    );
    await page.contents.uploadContent(
      JSON.stringify({
        nebi_missing_dependencies: scenario.dependencies,
        nebi_not_ready_reason: scenario.kernelDependencies
          ? 'kernel-not-installed'
          : 'missing-dependencies'
      }),
      'text',
      `${tmpPath}/nebi-test.json`
    );
    await page.goto(`tree/${tmpPath}?reset`);
    if (scenario.kernelDependencies) {
      await page.evaluate(async packages => {
        const settings = await window.galata.getPlugin(
          '@jupyterlab/apputils-extension:settings'
        );
        await settings!.set(
          'jupyterlab-launchpad:plugin',
          'nebiKernelDependencies',
          packages
        );
      }, scenario.kernelDependencies);
    }
    const row = page
      .locator('.jp-Launcher-launchNotebook tbody tr')
      .filter({ hasText: 'Nebi repair integration fixture' });
    const repair = row.getByRole('button', {
      name: 'Install missing dependencies',
      exact: true
    });
    const posts: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/nebi/')) {
        posts.push(new URL(request.url()).pathname);
      }
    });
    await repair.click();
    if (scenario.detail) {
      const notification = page.locator('.jp-Notification-Toast-error');
      await expect(notification).toBeVisible();
      await expect(notification.locator('.jp-toast-message')).toHaveText(
        scenario.detail,
        { useInnerText: true }
      );
      if (scenario.screenshot) {
        await expect(notification).toHaveScreenshot(scenario.screenshot);
      }
      await expect(repair).toBeEnabled();
      await expect(
        page.getByText('Dependencies installed', { exact: true })
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByText('Dependencies installed', { exact: true })
      ).toBeVisible();
      await expect(repair).toHaveCount(0);
      await expect(row).toContainText('Ready');
    }
    await expect(
      page.getByRole('alert').filter({ hasText: 'Installing dependencies...' })
    ).toHaveCount(0);
    expect(posts).toEqual(
      scenario.dependencies.length
        ? [`/nebi/api/v1/workspaces/${tmpPath}/packages`]
        : []
    );
    if (scenario.dependencies.length) {
      const invocation = await page.request.get(
        `/api/contents/${tmpPath}/native-job.json`
      );
      expect(invocation.ok()).toBe(true);
      expect(JSON.parse((await invocation.json()).content)).toEqual({
        action: 'packages',
        packages: [
          ...scenario.dependencies,
          ...(scenario.kernelDependencies ?? [])
        ]
      });
    }
  });
}

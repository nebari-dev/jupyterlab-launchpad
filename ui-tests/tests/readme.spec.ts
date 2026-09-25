import { expect, galata, test } from '@jupyterlab/galata';
import { readFileSync } from 'fs';
import type { Locator } from '@playwright/test';

// Recreate the kernel mix, favourites and usage history in the original README.
const threeHoursAgo = '2026-01-01T09:00:00Z';
const sevenDaysAgo = '2025-12-25T12:00:00Z';
const environments = [
  { name: 'bash', displayName: 'Bash', language: 'bash', version: '1.0.0' },
  {
    name: 'coconut',
    version: '2.2.0',
    status: 'missing-deps',
    displayName: 'Coconut',
    language: 'coconut',
    lastUsed: threeHoursAgo
  },
  {
    name: 'coconut-python',
    version: '2.1.0',
    status: 'outdated',
    displayName: "Coconut (from 'python')",
    language: 'coconut',
    lastUsed: threeHoursAgo
  },
  {
    name: 'coconut-python2',
    version: '1.6.0',
    status: 'not-installed',
    displayName: "Coconut (from 'python2')",
    language: 'coconut'
  },
  {
    name: 'coconut-python3',
    version: '2.2.1',
    status: 'not-pulled',
    displayName: "Coconut (from 'python3')",
    language: 'coconut',
    lastUsed: threeHoursAgo
  },
  {
    name: 'ipython-3-10-6',
    version: '3.10.6',
    displayName: 'IPython 3.10.6',
    language: 'python'
  },
  {
    name: 'ipython-3-11-0rc0',
    version: '3.11.0rc0',
    displayName: 'IPython 3.11.0rc0',
    language: 'python',
    lastUsed: threeHoursAgo
  },
  {
    name: 'ipython-3-8-9',
    version: '3.8.9',
    displayName: 'IPython 3.8.9',
    language: 'python',
    lastUsed: threeHoursAgo,
    starred: true
  },
  {
    name: 'ipython-3-9-9',
    version: '3.9.9',
    status: 'failed',
    displayName: 'IPython 3.9.9',
    language: 'python'
  },
  {
    name: 'javascript',
    version: '22.0.0',
    status: 'not-installed',
    displayName: 'JavaScript (Node.js)',
    language: 'javascript'
  },
  {
    name: 'julia-1-4-1',
    version: '1.4.1',
    status: 'outdated',
    displayName: 'Julia 1.4.1',
    language: 'julia'
  },
  {
    name: 'julia-1-5-3',
    version: '1.5.3',
    displayName: 'Julia 1.5.3',
    language: 'julia',
    lastUsed: threeHoursAgo,
    starred: true
  },
  {
    name: 'julia-1-8-4',
    version: '1.8.4',
    displayName: 'Julia 1.8.4',
    language: 'julia'
  },
  {
    name: 'python3',
    version: '3.12.0',
    displayName: 'Python 3 (ipykernel)',
    language: 'python',
    lastUsed: sevenDaysAgo
  },
  { name: 'ir', version: '4.4.0', displayName: 'R', language: 'R' },
  {
    name: 'rust',
    version: '1.82.0',
    status: 'not-pulled',
    displayName: 'Rust',
    language: 'rust'
  }
];

// Use local SVGs so screenshots never depend on external icon servers.
// JavaScript and Rust: https://github.com/simple-icons/simple-icons (CC0-1.0).
const icons = Object.fromEntries(
  [
    ['python', '@jupyterlab/ui-components/style/icons/filetype/python.svg'],
    ['julia', '@jupyterlab/ui-components/style/icons/filetype/julia.svg'],
    ['R', '@jupyterlab/ui-components/style/icons/filetype/r-kernel.svg'],
    ['javascript', '../fixtures/icons/javascript.svg'],
    ['rust', '../fixtures/icons/rust.svg']
  ].map(([language, icon]) => [
    language,
    'data:image/svg+xml;base64,' +
      readFileSync(require.resolve(icon)).toString('base64')
  ])
);

const notebookKey = (name: string) =>
  'notebook:create-new_' +
  JSON.stringify({ isLauncher: true, kernelName: name });

async function expectDemoFeatures(table: Locator): Promise<void> {
  for (const status of [
    'ready',
    'outdated',
    'missing-deps',
    'not-installed',
    'not-pulled',
    'failed'
  ]) {
    await expect(
      table.locator(`[data-status="${status}"]`).first()
    ).toBeVisible();
  }
  for (const action of [
    'nebi-pull',
    'nebi-install-environment',
    'nebi-install-dependencies',
    'nebi-open-overview'
  ]) {
    await expect(
      table.locator(`[data-action="${action}"]`).first()
    ).toBeVisible();
  }
  await expect(table.getByText('3.12.0', { exact: true })).toBeVisible();
  await expect(
    table.getByText('update available', { exact: true }).first()
  ).toBeVisible();
  for (const label of ['JavaScript (Node.js)', 'Rust']) {
    const icon = table
      .getByRole('row')
      .filter({ hasText: label })
      .locator('img');
    await expect(icon).toBeVisible();
    await expect
      .poll(() =>
        icon.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
        )
      )
      .toBe(true);
  }
}

test.use({
  autoGoto: false,
  viewport: { width: 1280, height: 1320 },
  colorScheme: 'light',
  locale: 'en-US',
  timezoneId: 'UTC',
  mockSettings: {
    ...galata.DEFAULT_SETTINGS,
    'jupyterlab-launchpad:plugin': {}
  }
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-01T12:00:00Z'));
  await page.route('**/api/kernelspecs*', route =>
    route.fulfill({
      json: {
        default: 'python3',
        kernelspecs: Object.fromEntries(
          environments.map(
            ({ name, displayName, language, version, status = 'ready' }) => [
              name,
              {
                name,
                resources: icons[language]
                  ? { 'logo-svg': icons[language] }
                  : {},
                spec: {
                  argv: [],
                  display_name: displayName,
                  language,
                  metadata: {
                    debugger: language === 'python',
                    nebi_status: status,
                    nebi_location: status === 'not-pulled' ? 'remote' : 'local',
                    nebi_local_version:
                      status === 'not-pulled' ? null : version,
                    nebi_remote_version:
                      status === 'outdated' ? '3.0.0' : version,
                    nebi_outdated: status === 'outdated',
                    nebi_workspace: `demo/${name}`,
                    nebi_workspace_path:
                      status === 'not-pulled' ? '' : `/srv/${name}`,
                    pixi_environment: 'default',
                    ...(status === 'missing-deps'
                      ? { nebi_missing_dependencies: ['ipykernel'] }
                      : {})
                  }
                }
              }
            ]
          )
        )
      }
    })
  );
  await page.route('**/jupyterlab-launchpad/nebi/capabilities*', route =>
    route.fulfill({ json: { nebi: true, pixi: true } })
  );
  await page.route('**/server-proxy/servers-info*', route =>
    route.fulfill({
      json: {
        server_processes: [
          { name: 'nebi', launcher_entry: { path_info: 'nebi/workspaces' } }
        ]
      }
    })
  );
  // Launchpad stores these separately from JupyterLab's mocked state database.
  const databases: Record<string, Record<string, string | boolean>> = {
    favorites: Object.fromEntries(
      environments
        .filter(item => item.starred)
        .map(item => [notebookKey(item.name), true])
    ),
    'last-used': Object.fromEntries(
      environments
        .filter(item => item.lastUsed)
        .map(item => [notebookKey(item.name), item.lastUsed!])
    )
  };
  await page.route('**/jupyterlab-launchpad/database/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    if (route.request().method() === 'POST') {
      databases[name] = route.request().postDataJSON();
      await route.fulfill({ status: 204 });
    } else {
      await route.fulfill({ json: databases[name] });
    }
  });
  await page.goto();
  await page.sidebar.close();
  await expect(
    page.locator('.jp-Launcher-launchNotebook tbody tr')
  ).toHaveCount(environments.length);
});

test('launcher screenshot for the README', async ({ page }) => {
  const launcher = page.locator('.jp-LauncherBody');
  const notebooks = launcher.locator('.jp-Launcher-launchNotebook');
  await expect(
    notebooks.getByRole('button', {
      name: 'Click to remove the kernel from favourites'
    })
  ).toHaveCount(2);
  await expect(notebooks.getByText('3 hours ago', { exact: true })).toHaveCount(
    6
  );
  await expect(notebooks.getByText('7 days ago', { exact: true })).toHaveCount(
    1
  );
  await expect(notebooks.getByText('Rust', { exact: true })).toBeInViewport();
  await expectDemoFeatures(notebooks);
  await page.mouse.move(0, 0);
  await expect(launcher).toHaveScreenshot('launcher.png');
});

test('kernel selection dialog screenshot for the README', async ({
  page,
  tmpPath
}) => {
  const notebookPath = `${tmpPath}/Example.ipynb`;
  await page.contents.uploadContent(
    JSON.stringify({
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5
    }),
    'text',
    notebookPath
  );
  await page.evaluate(async path => {
    await window.jupyterapp.commands.execute('docmanager:open', {
      path,
      kernelPreference: { shouldStart: false }
    });
  }, notebookPath);

  // Show the original idle Python and starting R sessions without real kernels.
  const kernels = [
    {
      id: 'readme-python',
      name: 'python3',
      execution_state: 'idle',
      connections: 1
    },
    { id: 'readme-r', name: 'ir', execution_state: 'starting', connections: 1 }
  ];
  await page.routeWebSocket(/\/api\/kernels\/readme-[^/]+\/channels/, () => {});
  await page.route(/\/api\/kernels\/readme-[^/?]+(\?.*)?$/, route =>
    route.fulfill({
      json: kernels.find(kernel =>
        new URL(route.request().url()).pathname.endsWith('/' + kernel.id)
      )
    })
  );
  await page.route(/\/api\/kernels(\?.*)?$/, route =>
    route.fulfill({ json: kernels })
  );
  await page.route(/\/api\/sessions(\?.*)?$/, route =>
    route.fulfill({
      json: kernels.map((kernel, index) => ({
        id: `readme-session-${index}`,
        path: `Untitled${45 - index}.ipynb`,
        name: `Untitled${45 - index}.ipynb`,
        type: 'notebook',
        kernel
      }))
    })
  );
  await page.evaluate(async () => {
    const { kernels, sessions } = window.jupyterapp.serviceManager;
    await Promise.all([kernels.refreshRunning(), sessions.refreshRunning()]);
  });
  await page.getByRole('button', { name: 'No Kernel', exact: true }).click();
  const dialog = page.locator('.jp-KernelSelector-Dialog .jp-Dialog-content');
  await expect(dialog.locator('tbody tr')).toHaveCount(environments.length + 2);
  await expect(
    dialog.getByText('Start a new kernel for "Example.ipynb"', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText('Untitled45.ipynb', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText('Untitled44.ipynb', { exact: true })
  ).toBeInViewport();
  await expect(dialog.getByText('idle', { exact: true })).toBeVisible();
  await expect(dialog.getByText('starting', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('button', {
      name: 'Click to remove the kernel from favourites'
    })
  ).toHaveCount(2);
  await expect(dialog.getByText('3 hours ago', { exact: true })).toHaveCount(6);
  await expect(dialog.getByText('7 days ago', { exact: true })).toHaveCount(1);
  await expect(dialog.getByText('Rust', { exact: true })).toBeInViewport();
  await expectDemoFeatures(dialog.locator('.jp-NewLauncher-table').first());
  await page.mouse.move(0, 0);
  await expect(dialog).toHaveScreenshot('dialog.png');
});

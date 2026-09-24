import { expect, test, galata } from '@jupyterlab/galata';
import { Page } from '@playwright/test';

const SETTINGS_ID = 'jupyterlab-launchpad:plugin';

type KernelspecsResponse = {
  default: string;
  kernelspecs: Record<string, unknown>;
};

const commonHiddenColumns = {
  debugger: 'hidden',
  conda_env_path: 'hidden',
  conda_raw_kernel_name: 'hidden',
  conda_language: 'hidden',
  conda_is_base_environment: 'hidden',
  conda_is_currently_running: 'hidden',
  supported_encryption: 'hidden',
  nebi: 'hidden',
  nebi_state: 'hidden',
  nebi_location: 'hidden',
  nebi_source: 'hidden',
  nebi_local_version: 'hidden',
  nebi_remote_version: 'hidden',
  nebi_missing_dependencies: 'hidden',
  nebi_outdated: 'hidden',
  nebi_not_ready_reason: 'hidden',
  nebi_logo_reason: 'hidden',
  nebi_discovery_hash: 'hidden',
  nebi_discovered_at: 'hidden',
  nebi_kernel_spec: 'hidden',
  nebi_kernel_state: 'hidden',
  nebi_workspace: 'hidden',
  nebi_workspace_path: 'hidden',
  pixi_environment: 'hidden'
};

const tableColumnOrder = [
  'star',
  'kernel',
  'nebi_version',
  'nebi_status',
  'actions',
  'last-used'
];

const nebiMetadataMockSettings = {
  ...galata.DEFAULT_SETTINGS,
  [SETTINGS_ID]: {
    ...galata.DEFAULT_SETTINGS[SETTINGS_ID],
    createEmptySection: true,
    launchConsoleSection: false,
    hiddenColumns: commonHiddenColumns,
    collapsedSections: {
      'create-empty': 'expanded',
      starred: 'collapsed',
      'launch-console': 'collapsed',
      'launch-notebook': 'expanded'
    },
    columnOrder: tableColumnOrder
  }
};

const kernelspecs: KernelspecsResponse = {
  default: 'nebi-python-ready',
  kernelspecs: {
    'nebi-python-ready': {
      name: 'nebi-python-ready',
      resources: {},
      spec: {
        argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        display_name: 'Nebi Python Ready',
        language: 'python',
        metadata: {
          nebi_status: 'ready',
          nebi_location: 'local',
          nebi_local_version: '1.2.0',
          nebi_remote_version: '1.2.0',
          nebi_outdated: false,
          nebi_workspace: 'nebari/demo-python',
          nebi_workspace_path: '/srv/nebari/demo-python',
          pixi_environment: 'python'
        }
      }
    },
    'nebi-r-missing-deps': {
      name: 'nebi-r-missing-deps',
      resources: {},
      spec: {
        argv: ['R', '--slave', '-e', 'IRkernel::main()'],
        display_name: 'Nebi R Missing Deps',
        language: 'R',
        metadata: {
          nebi_status: 'missing-deps',
          nebi_location: 'local',
          nebi_missing_dependencies: ['r-irkernel'],
          nebi_local_version: '0.8.0',
          nebi_remote_version: '0.8.0',
          nebi_outdated: false,
          nebi_workspace: 'nebari/demo-r',
          nebi_workspace_path: '/srv/nebari/demo-r',
          pixi_environment: 'r'
        }
      }
    },
    'nebi-remote-workspace': {
      name: 'nebi-remote-workspace',
      resources: {},
      spec: {
        argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        display_name: 'Nebi Remote Workspace',
        language: 'python',
        metadata: {
          nebi_status: 'not-pulled',
          nebi_location: 'remote',
          nebi_remote_version: '2.0.0',
          nebi_workspace: 'nebari/remote-workspace',
          pixi_environment: 'python'
        }
      }
    }
  }
};

const overflowReadyKernelspecs = Array.from({ length: 18 }).reduce<
  Record<string, unknown>
>((specs, _, index) => {
  const suffix = String(index + 1).padStart(2, '0');
  return {
    ...specs,
    [`nebi-overflow-ready-${suffix}`]: {
      name: `nebi-overflow-ready-${suffix}`,
      resources: {},
      spec: {
        argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        display_name: `Nebi Z Overflow Ready ${suffix}`,
        language: 'python',
        metadata: {
          nebi_status: 'ready',
          nebi_location: 'local',
          nebi_local_version: '1.2.0',
          nebi_remote_version: '1.2.0',
          nebi_outdated: false,
          nebi_workspace: `nebari/overflow-ready-${suffix}`,
          nebi_workspace_path: `/srv/nebari/overflow-ready-${suffix}`,
          pixi_environment: 'python'
        }
      }
    }
  };
}, {});

const overflowKernelspecs: KernelspecsResponse = {
  default: kernelspecs.default,
  kernelspecs: {
    ...kernelspecs.kernelspecs,
    ...overflowReadyKernelspecs
  }
};

const responsiveKernelspecs: KernelspecsResponse = {
  default: 'nebi-python-ready',
  kernelspecs: {
    ...kernelspecs.kernelspecs,
    ...overflowReadyKernelspecs,
    'nebi-analytics-outdated-long-name': {
      name: 'nebi-analytics-outdated-long-name',
      resources: {},
      spec: {
        argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        display_name:
          'Nebi Analytics Outdated Workspace With Extra Long Environment Name',
        language: 'python',
        metadata: {
          nebi_status: 'missing-deps',
          nebi_location: 'local',
          nebi_missing_dependencies: ['ipykernel', 'pandas'],
          nebi_local_version: '1.0.0',
          nebi_remote_version: '1.2.0',
          nebi_outdated: true,
          nebi_workspace: 'nebari/analytics-outdated',
          nebi_workspace_path: '/srv/nebari/analytics-outdated',
          pixi_environment: 'python'
        }
      }
    },
    'nebi-new-environment': {
      name: 'nebi-new-environment',
      resources: {},
      spec: {
        argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        display_name: 'Nebi New Environment',
        language: 'python',
        metadata: {
          nebi_status: 'not-installed',
          nebi_location: 'local',
          nebi_workspace: 'nebari/new-environment',
          nebi_workspace_path: '/srv/nebari/new-environment',
          pixi_environment: 'python'
        }
      }
    }
  }
};

async function mockNebiEndpoints(
  page: Page,
  options: {
    includeNebiServerProxy?: boolean;
    specs?: KernelspecsResponse;
  } = {}
): Promise<void> {
  const { includeNebiServerProxy = false, specs = kernelspecs } = options;

  await page.route('**/api/kernelspecs*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(specs)
    });
  });

  await page.route(
    '**/jupyterlab-launchpad/nebi/capabilities*',
    async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nebi: true, pixi: true })
      });
    }
  );

  if (includeNebiServerProxy) {
    await page.route('**/server-proxy/servers-info*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          server_processes: [
            {
              name: 'nebi',
              launcher_entry: {
                path_info: 'nebi/workspaces'
              }
            }
          ]
        })
      });
    });
  }
}

test.describe('Nebi kernel metadata', () => {
  test.use({
    autoGoto: false,
    viewport: { width: 1440, height: 720 },
    mockSettings: nebiMetadataMockSettings
  });

  test('should render Nebi metadata columns and actions', async ({
    page,
    tmpPath
  }) => {
    await mockNebiEndpoints(page, {
      includeNebiServerProxy: true,
      specs: overflowKernelspecs
    });
    await page.goto(`tree/${tmpPath}?reset`);

    const launcher = page.locator('.jp-LauncherBody');
    const notebookSection = launcher.locator('.jp-Launcher-launchNotebook');

    await expect(notebookSection.locator('tbody tr')).toHaveCount(21);
    await expect(
      notebookSection.getByText('Ready', { exact: true }).first()
    ).toBeVisible();
    await expect(
      notebookSection.getByText('Missing dependencies', { exact: true })
    ).toHaveCount(1);
    await expect(
      notebookSection
        .locator('.jp-KernelActionButton')
        .filter({ hasText: 'Pull' })
    ).toBeVisible();
    await expect(
      notebookSection.locator(
        '.jp-KernelActionButton[data-action="nebi-open-overview"]'
      )
    ).toHaveCount(1);
    await expect(
      notebookSection.locator('.jp-NewLauncher-table-scrollerWrapper')
    ).toHaveClass(/jp-mod-hasMoreBelow/);

    await notebookSection.scrollIntoViewIfNeeded();
    expect(await notebookSection.screenshot()).toMatchSnapshot(
      'nebi-kernel-metadata.png'
    );
  });
});

test.describe('Nebi kernel metadata responsive layout', () => {
  test.use({
    autoGoto: false,
    viewport: { width: 625, height: 720 },
    mockSettings: nebiMetadataMockSettings
  });

  test('should render compact Nebi metadata on a narrow screen', async ({
    page,
    tmpPath
  }) => {
    await mockNebiEndpoints(page, {
      includeNebiServerProxy: true,
      specs: responsiveKernelspecs
    });
    await page.goto(`tree/${tmpPath}?reset`);
    if (await page.locator('#jp-left-stack').isVisible()) {
      await page.evaluate(async () => {
        const app = (
          window as typeof window & {
            jupyterapp: {
              commands: {
                execute: (id: string) => Promise<unknown>;
              };
            };
          }
        ).jupyterapp;

        await app.commands.execute('application:toggle-left-area');
      });
      await expect(page.locator('#jp-left-stack')).toBeHidden();
    }

    const launcher = page.locator('.jp-LauncherBody');
    const notebookSection = launcher.locator('.jp-Launcher-launchNotebook');

    await expect(notebookSection.locator('tbody tr')).toHaveCount(23);
    await expect(
      notebookSection.locator('.jp-NebiStatus-ready').first()
    ).toBeVisible();
    await expect(
      notebookSection.locator(
        '.jp-KernelActionButton[data-action="nebi-open-overview"]'
      )
    ).toHaveCount(2);
    await expect(
      notebookSection.locator('.jp-NewLauncher-table-scrollerWrapper')
    ).toHaveClass(/jp-mod-hasMoreBelow/);

    await notebookSection.scrollIntoViewIfNeeded();
    expect(await notebookSection.screenshot()).toMatchSnapshot(
      'nebi-kernel-metadata-narrow.png'
    );
  });
});

test.describe('Nebi kernel selector dialog', () => {
  test.use({
    autoGoto: false,
    mockSettings: nebiMetadataMockSettings,
    waitForApplication: async ({}, use) => {
      await use(async page => {
        await page.evaluate(() => window.jupyterapp.restored);
        await page.locator('.jp-LauncherBody').waitFor();
      });
    }
  });

  test('keeps its layout stable when opened, resized, and headers are hovered', async ({
    page,
    tmpPath
  }) => {
    // Short names and statuses make the unbounded dialog cross the compact
    // breakpoint in opposite directions on successive ResizeObserver callbacks.
    const specs: KernelspecsResponse = {
      default: 'demo0',
      kernelspecs: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => {
          const name = `demo${index}`;
          return [
            name,
            {
              name,
              resources: {},
              spec: {
                argv: [],
                display_name: `env${index}`,
                language: 'python',
                metadata: {
                  nebi_state: index % 2 ? 'remote-not-pulled' : 'ready',
                  nebi_local_version: index % 2 ? null : `1.0.${index}`,
                  nebi_remote_version: `1.0.${index}`,
                  nebi_outdated: false,
                  nebi_workspace: name,
                  nebi_workspace_path: index % 2 ? '' : `/tmp/${name}`,
                  pixi_environment: 'default'
                }
              }
            }
          ];
        })
      )
    };
    await mockNebiEndpoints(page, { specs });
    await page.goto(`tree/${tmpPath}?reset`);
    await page.evaluate(async path => {
      const app = window.jupyterapp;
      const model = await app.serviceManager.contents.newUntitled({
        type: 'notebook',
        path
      });
      await app.commands.execute('docmanager:open', {
        path: model.path,
        kernelPreference: { shouldStart: false }
      });
    }, tmpPath);
    await page.getByRole('button', { name: 'No Kernel', exact: true }).click();
    const dialog = page.locator('.jp-KernelSelector-Dialog');
    await expect(dialog).toBeVisible();
    const table = dialog.locator('.jp-NewLauncher-table').first();
    await expect(table.locator('tbody tr')).toHaveCount(12);

    const expectStableLayout = async () => {
      const samples = await dialog.evaluate(async node => {
        const samples: string[] = [];
        for (let frame = 0; frame < 70; frame++) {
          await new Promise(requestAnimationFrame);
          if (frame < 10) {
            continue;
          }
          const content = node.querySelector('.jp-Dialog-content')!;
          const table = node.querySelector('.jp-NewLauncher-table')!;
          samples.push(
            JSON.stringify({
              width: content.clientWidth,
              height: content.clientHeight,
              compact: table.classList.contains('jp-mod-compactTable'),
              headers: Array.from(table.querySelectorAll('th')).map(th => [
                th.clientWidth,
                th.className
              ])
            })
          );
        }
        return samples;
      });
      expect(new Set(samples).size).toBe(1);
    };

    for (const width of [1280, 850, 625, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectStableLayout();
      const bounds = await dialog.locator('.jp-Dialog-content').boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      const header = table.locator('th[data-id="nebi_status"]');
      await header.hover();
      await expectStableLayout();
      await header.getByRole('button').focus();
      await expectStableLayout();
      await page.mouse.move(0, 0);
      await header.getByRole('button').evaluate(button => button.blur());
    }
    await dialog
      .getByRole('button', { name: 'No Kernel', exact: true })
      .click();
    await expect(dialog).toBeHidden();
  });
});

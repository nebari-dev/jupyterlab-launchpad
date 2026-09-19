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
  nebi_missing_dependencies: 'hidden',
  nebi_outdated: 'hidden',
  nebi_not_ready_reason: 'hidden',
  nebi_logo_reason: 'hidden',
  nebi_discovery_hash: 'hidden',
  nebi_discovered_at: 'hidden',
  nebi_kernel_spec: 'hidden',
  nebi_kernel_state: 'hidden',
  nebi_workspace_path: 'hidden'
};

const hiddenColumns = {
  ...commonHiddenColumns,
  nebi_version: 'hidden',
  'last-used': 'hidden',
  star: 'hidden'
};

const responsiveHiddenColumns = {
  ...commonHiddenColumns,
  nebi_location: 'hidden',
  nebi_local_version: 'hidden',
  nebi_remote_version: 'hidden',
  nebi_workspace: 'hidden',
  pixi_environment: 'hidden'
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
        display_name: `Nebi Overflow Ready ${suffix}`,
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
    mockSettings: {
      ...galata.DEFAULT_SETTINGS,
      [SETTINGS_ID]: {
        ...galata.DEFAULT_SETTINGS[SETTINGS_ID],
        createEmptySection: false,
        launchConsoleSection: false,
        hiddenColumns,
        collapsedSections: {
          'create-empty': 'collapsed',
          starred: 'collapsed',
          'launch-console': 'collapsed',
          'launch-notebook': 'expanded'
        },
        columnOrder: [
          'kernel',
          'nebi_status',
          'nebi_location',
          'nebi_local_version',
          'nebi_remote_version',
          'nebi_workspace',
          'pixi_environment',
          'actions',
          'last-used',
          'star'
        ]
      }
    }
  });

  test('should render Nebi metadata columns and actions', async ({
    page,
    tmpPath
  }) => {
    await mockNebiEndpoints(page, { specs: overflowKernelspecs });
    await page.goto(`tree/${tmpPath}?reset`);

    const launcher = page.locator('.jp-LauncherBody');
    const notebookSection = launcher.locator('.jp-Launcher-launchNotebook');

    await expect(notebookSection.locator('tbody tr')).toHaveCount(21);
    await expect(
      notebookSection.getByText('Ready', { exact: true }).first()
    ).toBeVisible();
    await expect(
      notebookSection.getByText('Missing dependencies', { exact: true })
    ).toBeVisible();
    await expect(
      notebookSection.getByText('Remote', { exact: true })
    ).toBeVisible();
    await expect(
      notebookSection
        .locator('.jp-KernelActionButton')
        .filter({ hasText: 'Pull' })
    ).toBeVisible();
    await expect(
      notebookSection.locator('.jp-NewLauncher-table-scrollerWrapper')
    ).toHaveClass(/jp-mod-hasMoreBelow/);

    expect(await launcher.screenshot()).toMatchSnapshot(
      'nebi-kernel-metadata.png'
    );
  });
});

test.describe('Nebi kernel metadata responsive layout', () => {
  test.use({
    autoGoto: false,
    viewport: { width: 625, height: 720 },
    mockSettings: {
      ...galata.DEFAULT_SETTINGS,
      [SETTINGS_ID]: {
        ...galata.DEFAULT_SETTINGS[SETTINGS_ID],
        createEmptySection: true,
        launchConsoleSection: false,
        hiddenColumns: responsiveHiddenColumns,
        collapsedSections: {
          'create-empty': 'expanded',
          starred: 'collapsed',
          'launch-console': 'collapsed',
          'launch-notebook': 'expanded'
        },
        columnOrder: [
          'star',
          'kernel',
          'nebi_version',
          'nebi_status',
          'actions',
          'last-used'
        ]
      }
    }
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
    await page.sidebar.close('left');

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

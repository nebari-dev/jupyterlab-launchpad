import { expect, test, galata } from '@jupyterlab/galata';
import { Page } from '@playwright/test';

const SETTINGS_ID = 'jupyterlab-launchpad:plugin';

const hiddenColumns = {
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
  nebi_workspace_path: 'hidden',
  'last-used': 'hidden',
  star: 'hidden'
};

const kernelspecs = {
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

async function mockNebiEndpoints(page: Page): Promise<void> {
  await page.route('**/api/kernelspecs*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(kernelspecs)
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
    await mockNebiEndpoints(page);
    await page.goto(`tree/${tmpPath}?reset`);

    const launcher = page.locator('.jp-LauncherBody');
    const notebookSection = launcher.locator('.jp-Launcher-launchNotebook');

    await expect(notebookSection.locator('tbody tr')).toHaveCount(3);
    await expect(
      notebookSection.getByText('Ready', { exact: true })
    ).toBeVisible();
    await expect(
      notebookSection.getByText('Missing deps', { exact: true })
    ).toBeVisible();
    await expect(
      notebookSection.getByText('Remote', { exact: true })
    ).toBeVisible();
    await expect(
      notebookSection
        .locator('.jp-KernelActionButton')
        .filter({ hasText: 'Pull' })
    ).toBeVisible();

    expect(await launcher.screenshot()).toMatchSnapshot(
      'nebi-kernel-metadata.png'
    );
  });
});

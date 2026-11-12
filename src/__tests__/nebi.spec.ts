jest.mock('@jupyterlab/ui-components', () => ({
  LabIcon: class {
    react = () => null;
  },
  infoIcon: {
    react: () => null
  }
}));

jest.mock('@jupyterlab/apputils', () => ({
  Notification: {
    emit: jest.fn(() => 'pending-id'),
    dismiss: jest.fn(),
    success: jest.fn(),
    error: jest.fn()
  },
  showErrorMessage: jest.fn(() => Promise.resolve())
}));

jest.mock('@jupyterlab/services', () => ({
  ServerConnection: {
    makeSettings: jest.fn(() => ({
      baseUrl: 'http://example.com/user/demo/'
    })),
    makeRequest: jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            server_processes: [
              {
                name: 'nebi',
                launcher_entry: {
                  path_info: 'nebi/workspaces'
                }
              }
            ]
          })
      })
    ),
    NetworkError: class extends Error {},
    ResponseError: class extends Error {}
  }
}));

jest.mock('../handler', () => ({
  refreshKernelsWithInvalidation: jest.fn(() => Promise.resolve()),
  requestAPI: jest.fn(() =>
    Promise.resolve({
      nebi: true,
      pixi: true,
      kernelDependencies: ['ipykernel']
    })
  )
}));

jest.mock('../nebi-repair', () => ({
  repairNebiEnvironment: jest.fn(() => Promise.resolve())
}));

jest.mock('../kernel-refresh-messages', () => ({
  addKernelRefreshMessageListener: jest.fn()
}));

import * as React from 'react';
import { Notification, showErrorMessage } from '@jupyterlab/apputils';
import { ServerConnection } from '@jupyterlab/services';
import { nullTranslator } from '@jupyterlab/translation';
import type { ReadonlyJSONObject } from '@lumino/coreutils';
import {
  compareKernelActionLists,
  LaunchpadKernelTable
} from '../kernel-table';
import {
  NebiCommandIDs,
  NEBI_JOB_COMPLETED_MESSAGE,
  nebiKernelTablePlugin
} from '../components/nebi';
import { refreshKernelsWithInvalidation, requestAPI } from '../handler';
import { repairNebiEnvironment } from '../nebi-repair';
import { addKernelRefreshMessageListener } from '../kernel-refresh-messages';
import { IKernelItem } from '../types';

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function activateNebiPlugin(
  registry: LaunchpadKernelTable,
  kernelDependencies: string[] = []
) {
  const app = {
    commands: {
      addCommand: jest.fn(),
      execute: jest.fn(),
      hasCommand: jest.fn(id => id === 'server-proxy:open'),
      notifyCommandChanged: jest.fn()
    },
    serviceManager: {
      serverSettings: {
        baseUrl: 'http://example.com/user/demo/'
      },
      kernelspecs: {
        specs: {
          kernelspecs: {} as Record<string, { metadata: ReadonlyJSONObject }>
        },
        refreshSpecs: jest.fn()
      }
    }
  };
  nebiKernelTablePlugin.activate(app as never, nullTranslator, registry, {
    load: jest.fn().mockResolvedValue({
      get: () => ({ composite: kernelDependencies })
    })
  });
  return app;
}

async function setupInstall(kernelDependencies: string[] = []) {
  const app = activateNebiPlugin(
    new LaunchpadKernelTable(),
    kernelDependencies
  );
  await settlePromises();
  const command = app.commands.addCommand.mock.calls.find(
    ([id]) => id === NebiCommandIDs.installDependencies
  )![1];
  return { app, command };
}

describe('LaunchpadKernelTable', () => {
  it.each([false, true])(
    'uses Nebi availability (%s) for column defaults',
    async nebi => {
      (requestAPI as jest.Mock).mockResolvedValueOnce({ nebi, pixi: true });
      const registry = new LaunchpadKernelTable();
      activateNebiPlugin(registry);
      await settlePromises();

      expect(registry.getColumnDefaultVisibility('nebi_status')).toBe(nebi);
      expect(registry.getColumnDefaultVisibility('actions')).toBe(nebi);
      expect(registry.getMetadataColumn('nebi_version')).toBeUndefined();
      expect(registry.getColumnDefaultVisibility('state')).toBe(true);
    }
  );

  it('keeps Nebi columns hidden when capability lookup fails', async () => {
    (requestAPI as jest.Mock).mockRejectedValueOnce(new Error('Unavailable'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = new LaunchpadKernelTable();
      activateNebiPlugin(registry);
      await settlePromises();
      expect(registry.getColumnDefaultVisibility('nebi_status')).toBe(false);
      expect(registry.getColumnDefaultVisibility('actions')).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('registers metadata columns', () => {
    const registry = new LaunchpadKernelTable();
    const column = { id: 'state', label: 'State' };
    let changes = 0;

    registry.changed.connect(() => {
      changes += 1;
    });

    registry.registerMetadataColumn(column);

    expect(registry.getMetadataColumn('state')).toBe(column);
    expect(changes).toBe(1);
  });

  it('replaces existing metadata columns with the same id', () => {
    const registry = new LaunchpadKernelTable();
    const first = { id: 'state', label: 'State' };
    const second = { id: 'state', label: 'Kernel state' };

    registry.registerMetadataColumn(first);
    registry.registerMetadataColumn(second);

    expect(registry.getMetadataColumn('state')).toBe(second);
  });

  it('registers Nebi metadata presentation', () => {
    const registry = new LaunchpadKernelTable();
    const item = {} as IKernelItem;

    activateNebiPlugin(registry);

    expect(
      registry
        .getMetadataColumns()
        .filter(column => column.isVisibleByDefault)
        .map(column => column.id)
    ).toEqual(['nebi_status']);

    const state = registry.getMetadataColumn('nebi_state');
    const source = registry.getMetadataColumn('nebi_source');
    const remoteVersion = registry.getMetadataColumn('nebi_remote_version');

    expect(state?.label).toBe('Nebi status');
    expect(source?.label).toBe('Location');
    expect(
      state?.title?.({
        item,
        metadataKey: 'nebi_state',
        value: 'local-missing-deps',
        metadata: {
          nebi_state: 'local-missing-deps',
          nebi_missing_dependencies: ['ipykernel']
        },
        trans: null as never
      })
    ).toBeNull();
    expect(
      state?.title?.({
        item,
        metadataKey: 'nebi_state',
        value: 'failed',
        metadata: {
          nebi_state: 'failed',
          nebi_not_ready_reason: 'The previous launch failed'
        },
        trans: null as never
      })
    ).toBeNull();
    const renderedRemoteVersion = remoteVersion?.render?.({
      item,
      metadataKey: 'nebi_remote_version',
      value: 'v2',
      metadata: {
        nebi_local_version: 'v1',
        nebi_remote_version: 'v2',
        nebi_outdated: true
      },
      trans: null as never
    });
    if (
      !React.isValidElement<{ children: React.ReactNode }>(
        renderedRemoteVersion
      )
    ) {
      throw new Error('Expected latest version to render as a React element');
    }
    expect(
      React.Children.toArray(renderedRemoteVersion.props.children).map(child =>
        React.isValidElement<{ children: React.ReactNode }>(child)
          ? child.props.children
          : child
      )
    ).toEqual(['v2']);
  });

  it('supports split Nebi status and location metadata', () => {
    const registry = new LaunchpadKernelTable();

    activateNebiPlugin(registry);

    const status = registry.getMetadataColumn('nebi_status');
    const location = registry.getMetadataColumn('nebi_location');

    expect(status?.label).toBe('Status');
    expect(location?.label).toBe('Location');
  });

  it('renders the default columns from upstream metadata without display fields', () => {
    const registry = new LaunchpadKernelTable();
    activateNebiPlugin(registry);
    const options = {
      item: {} as IKernelItem,
      value: undefined,
      metadata: {
        nebi_state: 'outdated',
        nebi_local_version: 'v1',
        nebi_remote_version: 'v2',
        nebi_outdated: true
      },
      trans: null as never
    };

    const status = registry.getMetadataColumn('nebi_status')?.render?.({
      ...options,
      metadataKey: 'nebi_status'
    });

    expect(React.isValidElement(status) && status.props['data-status']).toBe(
      'outdated'
    );
  });

  it('shows a remote-only workspace as not pulled without a local version', () => {
    const registry = new LaunchpadKernelTable();
    activateNebiPlugin(registry);
    const options = {
      item: {} as IKernelItem,
      value: undefined,
      metadata: {
        nebi_state: 'remote-not-pulled',
        nebi_remote_version: 'v2'
      },
      trans: null as never
    };

    const status = registry.getMetadataColumn('nebi_status')?.render?.({
      ...options,
      metadataKey: 'nebi_status'
    });
    expect(React.isValidElement(status) && status.props['data-status']).toBe(
      'not-pulled'
    );
  });

  it.each(['nebi_state', 'nebi_status'])(
    'sorts Nebi statuses from %s by readiness',
    field => {
      const registry = new LaunchpadKernelTable();
      const item = {} as IKernelItem;

      activateNebiPlugin(registry);

      const status = registry.getMetadataColumn('nebi_status');
      const sorted = [
        'remote-not-pulled',
        'local-not-installed',
        'local-missing-deps',
        'outdated',
        'ready'
      ].sort((a, b) => {
        return (
          status?.sort?.(
            {
              item,
              metadataKey: 'nebi_status',
              value: field === 'nebi_status' ? a : undefined,
              metadata: { [field]: a },
              trans: null as never
            },
            {
              item,
              metadataKey: 'nebi_status',
              value: field === 'nebi_status' ? b : undefined,
              metadata: { [field]: b },
              trans: null as never
            }
          ) ?? 0
        );
      });

      expect(sorted).toEqual([
        'ready',
        'outdated',
        'local-missing-deps',
        'local-not-installed',
        'remote-not-pulled'
      ]);
    }
  );

  it('sorts Nebi action lists by primary action', () => {
    const registry = new LaunchpadKernelTable();
    const item = {} as IKernelItem;

    activateNebiPlugin(registry);

    const rows: Array<{ label: string; metadata: ReadonlyJSONObject }> = [
      {
        label: 'ready',
        metadata: {
          nebi_status: 'ready'
        }
      },
      {
        label: 'failed',
        metadata: {
          nebi_status: 'failed'
        }
      },
      {
        label: 'not-installed',
        metadata: {
          nebi_status: 'not-installed',
          nebi_workspace_path: '/tmp/new-environment'
        }
      },
      {
        label: 'missing-deps',
        metadata: {
          nebi_status: 'missing-deps',
          nebi_workspace_path: '/tmp/missing-deps',
          nebi_missing_dependencies: ['ipykernel']
        }
      },
      {
        label: 'not-pulled',
        metadata: {
          nebi_status: 'not-pulled',
          nebi_workspace: 'nebari/remote-workspace'
        }
      }
    ];

    const sorted = rows.sort((a, b) =>
      compareKernelActionLists(
        registry.getActions({
          item,
          metadata: a.metadata,
          trans: null as never
        }),
        registry.getActions({
          item,
          metadata: b.metadata,
          trans: null as never
        })
      )
    );

    expect(sorted.map(row => row.label)).toEqual([
      'not-pulled',
      'missing-deps',
      'not-installed',
      'failed',
      'ready'
    ]);
    expect(
      sorted.map(row =>
        registry
          .getActions({
            item,
            metadata: row.metadata,
            trans: null as never
          })
          .map(action => action.label)
      )
    ).toEqual([
      ['Pull'],
      ['Attempt fix', 'Open in Nebi'],
      ['Install'],
      ['Open in Nebi'],
      []
    ]);
  });

  it('registers Nebi commands from the Nebi plugin', () => {
    const registry = new LaunchpadKernelTable();

    const app = activateNebiPlugin(registry);

    expect(app.commands.addCommand).toHaveBeenCalledWith(
      NebiCommandIDs.pull,
      expect.any(Object)
    );
    expect(app.commands.addCommand).toHaveBeenCalledWith(
      NebiCommandIDs.installDependencies,
      expect.any(Object)
    );
    expect(app.commands.addCommand).toHaveBeenCalledWith(
      NebiCommandIDs.openOverview,
      expect.any(Object)
    );
  });

  it('registers the Nebi completion listener from the Nebi plugin', () => {
    jest.clearAllMocks();
    const registry = new LaunchpadKernelTable();

    const app = activateNebiPlugin(registry);

    expect(addKernelRefreshMessageListener).toHaveBeenCalledWith(app, [
      NEBI_JOB_COMPLETED_MESSAGE
    ]);
  });

  it.each([
    ['kernel-not-installed', [], [], true],
    ['missing-dependencies', ['numpy'], ['numpy'], true],
    ['environment-not-installed', [], [], false]
  ])('selects the repair for %s', (reason, dependencies, expected, repair) => {
    const registry = new LaunchpadKernelTable();
    activateNebiPlugin(registry);
    const options = {
      item: {} as IKernelItem,
      metadata: {
        nebi_state: repair ? 'local-missing-deps' : 'local-not-installed',
        nebi_workspace_path: '/tmp/demo',
        pixi_environment: 'default',
        nebi_not_ready_reason: reason,
        nebi_missing_dependencies: dependencies
      } as ReadonlyJSONObject,
      trans: null as never
    };
    const action = registry.getActions(options)[0];
    expect(action.args?.(options)).toMatchObject({
      environment: 'default',
      missingDependencies: expected
    });
    expect(action.args?.(options)?.['repair']).toBe(repair || undefined);
    if (repair) {
      expect(action.args?.(options)?.['notReadyReason']).toBe(reason);
    }
    if (reason === 'kernel-not-installed') {
      expect(
        registry.getMetadataColumn('nebi_missing_dependencies')?.title?.({
          ...options,
          value: dependencies,
          metadataKey: 'nebi_missing_dependencies'
        })
      ).toContain('configured kernel dependencies');
    }
  });

  it.each([
    ['kernel-not-installed', true, ['r-irkernel'], ['r-irkernel']],
    ['kernel-not-installed', true, [], []],
    ['missing-dependencies', true, ['r-irkernel'], undefined],
    ['kernel-not-installed', false, ['r-irkernel'], undefined]
  ])(
    'sends the user kernel packages for reason %s and repair %s',
    async (reason, repair, packages, expected) => {
      jest.clearAllMocks();
      const { app, command } = await setupInstall(packages);
      app.serviceManager.kernelspecs.specs.kernelspecs = {
        python: {
          metadata: {
            nebi_workspace_path: '/tmp/demo',
            pixi_environment: 'default',
            nebi_state: 'ready'
          }
        }
      };
      await command.execute({
        workspacePath: '/tmp/demo',
        environment: 'default',
        notReadyReason: reason,
        missingDependencies: ['numpy'],
        repair
      });
      const body = (repairNebiEnvironment as jest.Mock).mock.calls[0][0];
      expect(repairNebiEnvironment).toHaveBeenCalledWith(
        body,
        ['ipykernel'],
        nullTranslator.load('jupyterlab-launchpad')
      );
      expect(body.kernelDependencies).toEqual(expected);
      expect(body.missingDependencies).toEqual(['numpy']);
    }
  );

  it.each([
    ['ready', 'default', true],
    ['outdated', 'default', true],
    ['local-missing-deps', 'default', false],
    ['ready', 'another-environment', false],
    [undefined, 'default', false]
  ])(
    'verifies repair with state %s in %s',
    async (state, environment, success) => {
      jest.clearAllMocks();
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const { app, command } = await setupInstall();
      app.serviceManager.kernelspecs.refreshSpecs.mockImplementationOnce(() => {
        // Discovery replaces the placeholder with a differently named real kernel.
        app.serviceManager.kernelspecs.specs.kernelspecs = state
          ? {
              'new-python-kernel': {
                metadata: {
                  nebi_workspace_path: '/tmp/demo',
                  pixi_environment: environment,
                  nebi_state: state
                }
              }
            }
          : {};
      });
      try {
        await command.execute({
          workspacePath: '/tmp/demo',
          environment: 'default',
          missingDependencies: [],
          notReadyReason: 'kernel-not-installed',
          repair: true
        });
        expect(Notification.emit).toHaveBeenCalledWith(
          'Installing dependencies...',
          'in-progress',
          { autoClose: false }
        );
        expect(Notification.dismiss).toHaveBeenCalledWith('pending-id');
        if (success) {
          expect(Notification.success).toHaveBeenCalledWith(
            'Dependencies installed',
            { autoClose: 3000 }
          );
          expect(Notification.error).not.toHaveBeenCalled();
        } else {
          expect(Notification.error).toHaveBeenCalledWith(
            expect.stringContaining('still unavailable'),
            { autoClose: false }
          );
          expect(Notification.success).not.toHaveBeenCalled();
        }
      } finally {
        consoleError.mockRestore();
      }
    }
  );

  it.each([
    { nebi: false, pixi: true },
    { nebi: true, pixi: false },
    { nebi: false, pixi: false }
  ])(
    'uses the proxy for repairs with CLI capabilities %j',
    async capabilities => {
      jest.clearAllMocks();
      (requestAPI as jest.Mock).mockResolvedValueOnce(capabilities);
      const { app, command } = await setupInstall();
      const args = { workspacePath: '/tmp/demo' };
      expect(command.isEnabled(args)).toBe(true);
      expect(command.isEnabled({ ...args, repair: true })).toBe(true);
      expect(
        command.isEnabled({ ...args, missingDependencies: ['ipykernel'] })
      ).toBe(true);
      const pull = app.commands.addCommand.mock.calls.find(
        ([id]) => id === NebiCommandIDs.pull
      )![1];
      expect(pull.isEnabled({ workspace: 'demo' })).toBe(capabilities.nebi);
      (requestAPI as jest.Mock).mockClear();
      await command.execute({ ...args, missingDependencies: ['ipykernel'] });
      expect(repairNebiEnvironment).toHaveBeenCalledWith(
        { ...args, missingDependencies: ['ipykernel'] },
        ['ipykernel'],
        nullTranslator.load('jupyterlab-launchpad')
      );
      if (!capabilities.nebi) {
        await pull.execute({ workspace: 'demo' });
      }
      expect(requestAPI).not.toHaveBeenCalled();
    }
  );

  it('requires a proxy for repairs', async () => {
    jest.clearAllMocks();
    (ServerConnection.makeRequest as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ server_processes: [] })
    });
    const { command } = await setupInstall();
    const args = { workspacePath: '/tmp/demo' };
    expect(command.isEnabled(args)).toBe(false);
    expect(command.isEnabled({ ...args, repair: true })).toBe(false);
    expect(
      command.isEnabled({ ...args, missingDependencies: ['ipykernel'] })
    ).toBe(false);
    await command.execute({ ...args, repair: true });
    expect(repairNebiEnvironment).not.toHaveBeenCalled();
  });

  it('does not show an extra error dialog for Nebi action failures', async () => {
    jest.clearAllMocks();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { command } = await setupInstall();

    try {
      (repairNebiEnvironment as jest.Mock).mockRejectedValueOnce(
        new Error('Pixi failed')
      );
      await command.execute({
        workspacePath: '/tmp/demo',
        missingDependencies: ['ipykernel']
      });

      expect(Notification.error).toHaveBeenCalledWith('Pixi failed', {
        autoClose: false
      });
      expect(Notification.dismiss).toHaveBeenCalledWith('pending-id');
      expect(Notification.success).not.toHaveBeenCalled();
      expect(showErrorMessage).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('refreshes after partial failure without replacing the repair error', async () => {
    jest.clearAllMocks();
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { app, command } = await setupInstall();
      (repairNebiEnvironment as jest.Mock).mockRejectedValueOnce(
        new Error('Saved version; install failed')
      );
      (refreshKernelsWithInvalidation as jest.Mock).mockRejectedValueOnce(
        new Error('refresh failed')
      );
      await command.execute({ workspacePath: '/tmp/demo', repair: true });
      expect(refreshKernelsWithInvalidation).toHaveBeenCalled();
      expect(app.serviceManager.kernelspecs.refreshSpecs).toHaveBeenCalled();
      expect(Notification.error).toHaveBeenCalledWith(
        'Saved version; install failed',
        { autoClose: false }
      );
      expect(Notification.success).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it('disables repair for missing paths and named environments', async () => {
    const { command } = await setupInstall();
    expect(command.isEnabled({ workspacePath: '', repair: true })).toBe(false);
    expect(
      command.isEnabled({
        workspacePath: '/tmp/demo',
        repair: true,
        environment: 'other'
      })
    ).toBe(false);
    expect(
      command.isEnabled({
        workspacePath: '/tmp/demo',
        missingDependencies: ['ipykernel'],
        environment: 'other'
      })
    ).toBe(false);
    expect(
      command.isEnabled({ workspacePath: '/tmp/demo', repair: true })
    ).toBe(true);
    const installArgs = {
      workspacePath: '/tmp/demo',
      environment: 'other'
    };
    expect(command.isEnabled(installArgs)).toBe(false);
    expect(command.isVisible(installArgs)).toBe(false);
  });

  it('opens the Nebi overview through server proxy', async () => {
    jest.clearAllMocks();
    const registry = new LaunchpadKernelTable();

    const app = activateNebiPlugin(registry);
    const openCommand = (app.commands.addCommand as jest.Mock).mock.calls.find(
      ([id]) => id === NebiCommandIDs.openOverview
    )?.[1];
    if (!openCommand) {
      throw new Error('Open in Nebi command was not registered');
    }

    await settlePromises();
    await openCommand.execute({});

    expect(app.commands.execute).toHaveBeenCalledWith('server-proxy:open', {
      id: 'server-proxy:nebi',
      title: 'Nebi',
      url: 'http://example.com/user/demo/nebi/workspaces',
      newBrowserTab: false
    });
    expect(
      (requestAPI as jest.Mock).mock.calls.map(([endpoint]) => endpoint)
    ).not.toContain('nebi/config-path');
  });

  it('requires the Nebi server-proxy entry before opening Nebi', async () => {
    jest.clearAllMocks();
    const registry = new LaunchpadKernelTable();

    const app = activateNebiPlugin(registry);
    const openCommand = (app.commands.addCommand as jest.Mock).mock.calls.find(
      ([id]) => id === NebiCommandIDs.openOverview
    )?.[1];
    if (!openCommand) {
      throw new Error('Open in Nebi command was not registered');
    }

    expect(openCommand.isVisible()).toBe(false);

    await settlePromises();

    expect(openCommand.isVisible()).toBe(true);
    expect(openCommand.isEnabled()).toBe(true);
    expect(ServerConnection.makeRequest).toHaveBeenCalledWith(
      'http://example.com/user/demo/server-proxy/servers-info',
      {},
      expect.objectContaining({
        baseUrl: 'http://example.com/user/demo/'
      })
    );
    expect(app.commands.notifyCommandChanged).toHaveBeenCalledWith(
      NebiCommandIDs.openOverview
    );
  });

  it('does not enable Open in Nebi without a Nebi server-proxy entry', async () => {
    jest.clearAllMocks();
    (ServerConnection.makeRequest as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ server_processes: [] })
    });
    const registry = new LaunchpadKernelTable();

    const app = activateNebiPlugin(registry);
    const openCommand = (app.commands.addCommand as jest.Mock).mock.calls.find(
      ([id]) => id === NebiCommandIDs.openOverview
    )?.[1];
    if (!openCommand) {
      throw new Error('Open in Nebi command was not registered');
    }

    await settlePromises();

    expect(openCommand.isVisible()).toBe(false);
    expect(openCommand.isEnabled()).toBe(false);
  });

  it('keeps Nebi fallback icon titles behind the Nebi plugin', () => {
    const registry = new LaunchpadKernelTable();
    const item = {} as IKernelItem;
    const options = {
      item,
      metadata: {
        nebi_logo_reason: 'Logo is missing'
      },
      trans: null as never
    };

    expect(registry.getIconFallbackTitle(options)).toBeUndefined();

    activateNebiPlugin(registry);

    expect(registry.getIconFallbackTitle(options)).toBe('Logo is missing');
  });

  it('registers context-dependent Nebi actions', () => {
    const registry = new LaunchpadKernelTable();
    const item = {} as IKernelItem;

    activateNebiPlugin(registry);

    const remoteActions = registry.getActions({
      item,
      metadata: {
        nebi_state: 'remote-not-pulled',
        nebi_workspace: 'demo'
      },
      trans: null as never
    });
    expect(remoteActions.map(action => action.command)).toEqual([
      NebiCommandIDs.pull
    ]);
    expect(
      remoteActions[0].args?.({
        item,
        metadata: {
          nebi_state: 'remote-not-pulled',
          nebi_workspace: 'demo'
        },
        trans: null as never
      })
    ).toMatchObject({
      workspace: 'demo'
    });

    const notInstalledActions = registry.getActions({
      item,
      metadata: {
        nebi_status: 'not-installed',
        nebi_workspace: 'demo',
        nebi_workspace_path: '/tmp/demo'
      },
      trans: null as never
    });
    expect(notInstalledActions.map(action => action.label)).toContain(
      'Install'
    );
    expect(notInstalledActions.map(action => action.command)).not.toContain(
      NebiCommandIDs.openOverview
    );

    const missingDependencyActions = registry.getActions({
      item,
      metadata: {
        nebi_status: 'missing-deps',
        nebi_workspace: 'demo',
        nebi_workspace_path: '/tmp/demo',
        nebi_missing_dependencies: ['ipykernel']
      },
      trans: null as never
    });
    expect(missingDependencyActions.map(action => action.command)).toEqual([
      NebiCommandIDs.installDependencies,
      NebiCommandIDs.openOverview
    ]);

    const missingDependencyActionsWithoutPath = registry.getActions({
      item,
      metadata: {
        nebi_status: 'missing-deps',
        nebi_workspace: 'demo',
        nebi_missing_dependencies: ['ipykernel']
      },
      trans: null as never
    });
    expect(
      missingDependencyActionsWithoutPath.map(action => action.command)
    ).toEqual([NebiCommandIDs.openOverview]);

    const failedActions = registry.getActions({
      item,
      metadata: {
        nebi_status: 'failed',
        nebi_workspace: 'demo'
      },
      trans: null as never
    });
    expect(failedActions.map(action => action.command)).toEqual([
      NebiCommandIDs.openOverview
    ]);

    const readyActions = registry.getActions({
      item,
      metadata: {
        nebi_status: 'ready',
        nebi_workspace: 'demo',
        nebi_workspace_path: '/tmp/demo'
      },
      trans: null as never
    });
    expect(readyActions.map(action => action.command)).toEqual([]);

    const builtInReadyActions = registry.getActions({
      item,
      metadata: {
        nebi_status: 'ready'
      },
      trans: null as never
    });
    expect(builtInReadyActions.map(action => action.command)).toEqual([]);
  });
});

describe('Nebi environment installation', () => {
  const makeRequest = ServerConnection.makeRequest as jest.Mock;
  const args = {
    workspacePath: '/tmp/demo',
    environment: 'default',
    missingDependencies: ['ipykernel']
  };

  function respond(data: unknown, status = 200) {
    makeRequest.mockResolvedValueOnce({
      ok: status < 400,
      status,
      json: async () => data
    });
  }

  async function setup(
    proxy = true,
    capabilities = { nebi: true, pixi: true }
  ) {
    (requestAPI as jest.Mock).mockResolvedValueOnce(capabilities);
    respond({ server_processes: proxy ? [{ name: 'nebi' }] : [] });
    const registry = new LaunchpadKernelTable();
    const app = activateNebiPlugin(registry);
    const action = registry.getActions({
      item: {} as IKernelItem,
      metadata: {
        nebi_status: 'not-installed',
        nebi_workspace_path: args.workspacePath,
        pixi_environment: args.environment,
        nebi_missing_dependencies: args.missingDependencies
      },
      trans: null as never
    })[0];
    expect(action.label).toBe('Install');
    const command = app.commands.addCommand.mock.calls.find(
      ([id]) => id === action.command
    )![1];
    expect(command.isEnabled(args)).toBe(false);
    await settlePromises();
    return { app, command };
  }

  function workspace() {
    respond({ mode: 'local' });
    respond([
      { id: 'wrong-id', path: '/tmp/demo-other' },
      { id: 'workspace-id', path: '/tmp/demo' }
    ]);
  }

  function translateMessages() {
    const bundle = nullTranslator.load('jupyterlab-launchpad');
    const translate = bundle.__.bind(bundle);
    jest
      .spyOn(bundle, '__')
      .mockImplementation((...values) => `translated: ${translate(...values)}`);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    makeRequest.mockReset();
    (requestAPI as jest.Mock).mockReset().mockResolvedValue({});
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('enables Install through the proxy without requiring either CLI capability', async () => {
    const { command } = await setup(true, { nebi: false, pixi: false });
    expect(command.isVisible(args)).toBe(true);
    expect(command.isEnabled(args)).toBe(true);
  });

  it('submits through the proxy and refreshes discovery only after the job completes', async () => {
    const { app, command } = await setup();
    expect(command.isEnabled(args)).toBe(true);
    workspace();
    respond({ id: 'job/id', status: 'pending' }, 202);
    respond({ id: 'job/id', status: 'running' });
    respond({ id: 'job/id', status: 'completed' });

    const installation = command.execute(args);
    await jest.advanceTimersByTimeAsync(2000);
    expect(requestAPI).not.toHaveBeenCalledWith(
      'nebi/install-dependencies',
      expect.anything()
    );
    expect(makeRequest).toHaveBeenCalledWith(
      'http://example.com/user/demo/nebi/api/v1/workspaces/workspace-id/install',
      { method: 'POST' },
      expect.objectContaining({ baseUrl: 'http://example.com/user/demo/' })
    );
    expect(Notification.emit).toHaveBeenCalledWith(
      'Installing environment...',
      'in-progress',
      { autoClose: false }
    );
    expect(Notification.success).not.toHaveBeenCalled();
    expect(refreshKernelsWithInvalidation).not.toHaveBeenCalled();
    expect(app.serviceManager.kernelspecs.refreshSpecs).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2000);
    await installation;
    expect(
      makeRequest.mock.calls.filter(([url]) => url.endsWith('/jobs/job%2Fid'))
    ).toHaveLength(2);
    expect(refreshKernelsWithInvalidation).toHaveBeenCalledTimes(1);
    expect(app.serviceManager.kernelspecs.refreshSpecs).toHaveBeenCalledTimes(
      1
    );
    expect(Notification.dismiss).toHaveBeenCalledWith('pending-id');
    expect(Notification.success).toHaveBeenCalledWith('Environment installed', {
      autoClose: 3000
    });
  });

  it('shows the job error without refreshing discovery after a failure', async () => {
    const { app, command } = await setup();
    workspace();
    respond({ id: 'job-id', status: 'pending' }, 202);
    respond({
      id: 'job-id',
      status: 'failed',
      error: 'Nebi installation failed'
    });
    const installation = command.execute(args);
    await jest.advanceTimersByTimeAsync(2000);
    await installation;
    expect(Notification.error).toHaveBeenCalledWith(
      'Nebi installation failed',
      {
        autoClose: false
      }
    );
    expect(Notification.success).not.toHaveBeenCalled();
    expect(app.serviceManager.kernelspecs.refreshSpecs).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    'reports API errors during polling: %s',
    async polling => {
      const { command } = await setup();
      workspace();
      if (polling) {
        translateMessages();
        respond({ id: 'job-id', status: 'running' }, 202);
      }
      respond({ error: 'Nebi rejected the request' }, 409);
      const installation = command.execute(args);
      await jest.advanceTimersByTimeAsync(2000);
      await installation;
      expect(Notification.error).toHaveBeenCalledWith(
        polling
          ? expect.stringContaining(
              'translated: Could not check Nebi job job-id.'
            )
          : 'Nebi rejected the request',
        {
          autoClose: false
        }
      );
      expect(Notification.success).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it.each([
    [false, args],
    [true, { ...args, workspacePath: '' }],
    [true, { ...args, environment: 'analysis' }]
  ])('disables installation with proxy %s and args %j', async (proxy, body) => {
    const { command } = await setup(proxy);
    expect(command.isEnabled(body)).toBe(false);
    expect(command.isVisible(body)).toBe(false);
    await command.execute(body);
    expect(makeRequest).toHaveBeenCalledTimes(1);
  });
});

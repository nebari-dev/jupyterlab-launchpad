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
    promise: jest.fn()
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
  requestAPI: jest.fn(() => Promise.resolve({ nebi: true, pixi: true }))
}));

jest.mock('../kernel-refresh-messages', () => ({
  addKernelRefreshMessageListener: jest.fn()
}));

import * as React from 'react';
import { Notification, showErrorMessage } from '@jupyterlab/apputils';
import { ServerConnection } from '@jupyterlab/services';
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
import { requestAPI } from '../handler';
import { addKernelRefreshMessageListener } from '../kernel-refresh-messages';
import { IKernelItem } from '../types';

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function activateNebiPlugin(registry: LaunchpadKernelTable) {
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
        refreshSpecs: jest.fn()
      }
    }
  };
  const translator = {
    load: () => ({
      __: (message: string) => message
    })
  };

  nebiKernelTablePlugin.activate(app as never, translator as never, registry);
  return app;
}

describe('LaunchpadKernelTable', () => {
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
    ).toEqual(['nebi_version', 'nebi_status']);

    const version = registry.getMetadataColumn('nebi_version');
    const state = registry.getMetadataColumn('nebi_state');
    const source = registry.getMetadataColumn('nebi_source');
    const remoteVersion = registry.getMetadataColumn('nebi_remote_version');

    expect(version?.label).toBe('Version');
    expect(state?.label).toBe('Status');
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

  it('sorts Nebi statuses by readiness', () => {
    const registry = new LaunchpadKernelTable();
    const item = {} as IKernelItem;

    activateNebiPlugin(registry);

    const status = registry.getMetadataColumn('nebi_status');
    const sorted = [
      'failed',
      'remote-not-pulled',
      'not-installed',
      'local-missing-deps',
      'outdated',
      'ready'
    ].sort((a, b) => {
      return (
        status?.sort?.(
          {
            item,
            metadataKey: 'nebi_status',
            value: a,
            metadata: { nebi_status: a },
            trans: null as never
          },
          {
            item,
            metadataKey: 'nebi_status',
            value: b,
            metadata: { nebi_status: b },
            trans: null as never
          }
        ) ?? 0
      );
    });

    expect(sorted).toEqual([
      'ready',
      'outdated',
      'local-missing-deps',
      'not-installed',
      'remote-not-pulled',
      'failed'
    ]);
  });

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

  it('shows progress notifications for Nebi install actions', async () => {
    jest.clearAllMocks();
    const registry = new LaunchpadKernelTable();

    const app = activateNebiPlugin(registry);
    await Promise.resolve();
    const installCommand = (
      app.commands.addCommand as jest.Mock
    ).mock.calls.find(([id]) => id === NebiCommandIDs.installDependencies)?.[1];
    if (!installCommand) {
      throw new Error('Install dependencies command was not registered');
    }

    await installCommand.execute({
      workspacePath: '/tmp/demo',
      missingDependencies: ['ipykernel']
    });

    expect(requestAPI).toHaveBeenCalledWith(
      'nebi/install-dependencies',
      expect.objectContaining({ method: 'POST' })
    );
    expect(Notification.promise).toHaveBeenCalledWith(
      expect.any(Promise),
      expect.objectContaining({
        pending: expect.objectContaining({
          message: 'Installing dependencies...'
        })
      })
    );
  });

  it('does not show an extra error dialog for Nebi action failures', async () => {
    jest.clearAllMocks();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    (Notification.promise as jest.Mock).mockImplementationOnce(
      (promise: Promise<unknown>) => promise.catch(() => undefined)
    );
    const registry = new LaunchpadKernelTable();

    const app = activateNebiPlugin(registry);
    await settlePromises();
    const installCommand = (
      app.commands.addCommand as jest.Mock
    ).mock.calls.find(([id]) => id === NebiCommandIDs.installDependencies)?.[1];
    if (!installCommand) {
      throw new Error('Install dependencies command was not registered');
    }

    try {
      (requestAPI as jest.Mock).mockRejectedValueOnce(new Error('Pixi failed'));
      await installCommand.execute({
        workspacePath: '/tmp/demo',
        missingDependencies: ['ipykernel']
      });

      expect(Notification.promise).toHaveBeenCalled();
      const [, messages] = (Notification.promise as jest.Mock).mock.calls[0];
      expect(messages.error.message()).toBe('Could not install dependencies');
      expect(showErrorMessage).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
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

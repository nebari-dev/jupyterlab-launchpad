jest.mock('@jupyterlab/ui-components', () => {
  const icon = {
    react: () => null
  };
  return {
    checkIcon: icon,
    downloadIcon: icon,
    errorIcon: icon,
    refreshIcon: icon
  };
});

jest.mock('@jupyterlab/apputils', () => ({
  Notification: {
    promise: jest.fn()
  },
  showErrorMessage: jest.fn(() => Promise.resolve())
}));

jest.mock('../handler', () => ({
  refreshKernelsWithInvalidation: jest.fn(() => Promise.resolve()),
  requestAPI: jest.fn(() => Promise.resolve({ nebi: true, pixi: true }))
}));

import * as React from 'react';
import { Notification } from '@jupyterlab/apputils';
import { LaunchpadKernelTable } from '../kernel-table';
import { NebiCommandIDs, nebiKernelTablePlugin } from '../components/nebi';
import { requestAPI } from '../handler';
import { IKernelItem } from '../types';

function activateNebiPlugin(registry: LaunchpadKernelTable) {
  const app = {
    commands: {
      addCommand: jest.fn(),
      execute: jest.fn(),
      notifyCommandChanged: jest.fn()
    },
    serviceManager: {
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

    const state = registry.getMetadataColumn('nebi_state');
    const source = registry.getMetadataColumn('nebi_source');
    const remoteVersion = registry.getMetadataColumn('nebi_remote_version');

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
    ).toBe('Missing: ipykernel');
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
    ).toEqual(['v2', '(Latest)']);
  });

  it('supports split Nebi status and location metadata', () => {
    const registry = new LaunchpadKernelTable();

    activateNebiPlugin(registry);

    const status = registry.getMetadataColumn('nebi_status');
    const location = registry.getMetadataColumn('nebi_location');

    expect(status?.label).toBe('Status');
    expect(location?.label).toBe('Location');
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
      NebiCommandIDs.editConfig,
      expect.any(Object)
    );
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
      NebiCommandIDs.editConfig
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
    expect(readyActions.map(action => action.command)).toEqual([
      NebiCommandIDs.editConfig
    ]);
  });
});

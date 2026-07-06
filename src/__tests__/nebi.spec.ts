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

import { LaunchpadKernelTable } from '../kernel-table';
import { nebiKernelTablePlugin } from '../components/nebi';
import { CommandIDs, IKernelItem } from '../types';

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

    nebiKernelTablePlugin.activate({} as never, registry);

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
    expect(
      remoteVersion?.render?.({
        item,
        metadataKey: 'nebi_remote_version',
        value: 'v2',
        metadata: {
          nebi_local_version: 'v1',
          nebi_remote_version: 'v2',
          nebi_outdated: true
        },
        trans: null as never
      })
    ).toBeDefined();
  });

  it('supports split Nebi status and location metadata', () => {
    const registry = new LaunchpadKernelTable();

    nebiKernelTablePlugin.activate({} as never, registry);

    const status = registry.getMetadataColumn('nebi_status');
    const location = registry.getMetadataColumn('nebi_location');

    expect(status?.label).toBe('Status');
    expect(location?.label).toBe('Location');
  });

  it('registers context-dependent Nebi actions', () => {
    const registry = new LaunchpadKernelTable();
    const item = {} as IKernelItem;

    nebiKernelTablePlugin.activate({} as never, registry);

    const remoteActions = registry.getActions({
      item,
      metadata: {
        nebi_state: 'remote-not-pulled',
        nebi_workspace: 'demo'
      },
      trans: null as never
    });
    expect(remoteActions.map(action => action.command)).toEqual([
      CommandIDs.nebiPull
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
      CommandIDs.nebiInstallDependencies,
      CommandIDs.nebiEditConfig
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
      CommandIDs.nebiEditConfig
    ]);
  });
});

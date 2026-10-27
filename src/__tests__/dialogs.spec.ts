jest.mock('../icons', () => ({
  codeServerIcon: {},
  nebiIcon: {},
  starIcon: { react: () => null },
  arrowUpDownIcon: { react: () => null },
  infoCircleIcon: { react: () => null },
  updateAvailableIcon: { react: () => null }
}));

jest.mock('../components/table', () => ({
  KernelTable: () => null
}));

jest.mock('@jupyterlab/apputils', () => {
  const { Widget } = jest.requireActual('@lumino/widgets');
  class ReactWidget extends Widget {
    render() {
      return null;
    }
  }
  class Dialog {
    static okButton = jest.fn((options?: any) => ({
      ...options,
      accept: true
    }));
    static cancelButton = jest.fn((options?: any) => ({
      ...options,
      accept: false
    }));
    launch = jest.fn(() =>
      Promise.resolve({
        button: { accept: false },
        value: null,
        isChecked: null
      })
    );
    resolve = jest.fn();
    node = document.createElement('div');
  }
  class SessionContextDialogs {}
  return {
    ReactWidget,
    Dialog,
    SessionContextDialogs,
    SessionContext: {}
  };
});

import type { CommandRegistry } from '@lumino/commands';
import { Signal } from '@lumino/signaling';
import { KernelSelector } from '../dialogs';
import type {
  IFavoritesDatabase,
  ILastUsedDatabase,
  ILaunchpadKernelTable,
  IKernelItem
} from '../types';
import type { ISettingRegistry } from '@jupyterlab/settingregistry';
import type { TranslationBundle } from '@jupyterlab/translation';

function createMockKernelSelector(options: {
  type: string;
  selection?: Partial<IKernelItem>;
}): KernelSelector {
  const commands = {
    iconClass: () => '',
    icon: () => undefined,
    caption: () => '',
    label: () => 'Python 3',
    execute: jest.fn(() => Promise.resolve())
  } as unknown as CommandRegistry;

  const lastUsedDatabase = {
    ready: Promise.resolve(),
    get: () => null,
    recordAsUsed: jest.fn(() => Promise.resolve()),
    recordAsUsedNow: jest.fn(() => Promise.resolve()),
    changed: new Signal<ILastUsedDatabase, void>({} as ILastUsedDatabase)
  } satisfies ILastUsedDatabase;

  const favoritesDatabase = {
    ready: Promise.resolve(),
    get: () => false,
    set: jest.fn(() => Promise.resolve()),
    changed: new Signal<IFavoritesDatabase, void>({} as IFavoritesDatabase)
  } satisfies IFavoritesDatabase;

  const settings = {
    composite: {}
  } as unknown as ISettingRegistry.ISettings;

  const kernelTable = {
    registerMetadataColumn: jest.fn(),
    getMetadataColumn: jest.fn(),
    getMetadataColumns: () => [],
    registerAction: jest.fn(),
    getActions: () => [],
    registerIconFallbackTitleProvider: jest.fn(),
    getIconFallbackTitle: () => '',
    setColumnDefaultVisibility: jest.fn(),
    getColumnDefaultVisibility: () => true,
    changed: new Signal<ILaunchpadKernelTable, void>(
      {} as ILaunchpadKernelTable
    )
  } satisfies ILaunchpadKernelTable;

  const trans = {
    __: (str: string, ...args: unknown[]) => str
  } as unknown as TranslationBundle;

  const dataChanged = new Signal<any, void>({});

  const selector = new KernelSelector({
    commands,
    lastUsedDatabase,
    favoritesDatabase,
    settings,
    kernelTable,
    trans,
    data: () => ({
      specs: {
        default: 'python3',
        kernelspecs: {
          python3: {
            name: 'python3',
            display_name: 'Python 3',
            language: 'python',
            argv: ['python3'],
            resources: {}
          }
        }
      },
      sessions: [] as any,
      kernels: [][Symbol.iterator](),
      preference: {} as any
    }),
    dataChanged,
    acceptDialog: jest.fn(),
    name: 'test',
    type: options.type
  });

  if (options.selection) {
    (selector as any)._selection = options.selection;
  }

  return selector;
}

describe('KernelSelector', () => {
  it('correctly resolves kernel name for console sessions with kernelPreference', () => {
    const selector = createMockKernelSelector({
      type: 'console',
      selection: {
        command: 'console:create',
        args: {
          isLauncher: true,
          kernelPreference: { name: 'python3' }
        },
        markAsUsedNow: jest.fn(() => Promise.resolve())
      } as any
    });

    const value = selector.getValue();
    expect(value).toEqual({ name: 'python3' });
  });

  it('correctly resolves kernel name for notebook sessions with kernelName', () => {
    const selector = createMockKernelSelector({
      type: 'notebook',
      selection: {
        command: 'notebook:create-new',
        args: {
          isLauncher: true,
          kernelName: 'python3'
        },
        markAsUsedNow: jest.fn(() => Promise.resolve())
      } as any
    });

    const value = selector.getValue();
    expect(value).toEqual({ name: 'python3' });
  });

  it('returns running kernel model when user selects an existing kernel', () => {
    const mockModel = { id: 'kernel-123', name: 'python3' };
    const selector = createMockKernelSelector({
      type: 'notebook',
      selection: {
        command: 'notebook:create-new',
        args: { isLauncher: true, kernelName: 'python3' },
        metadata: { model: mockModel },
        markAsUsedNow: jest.fn(() => Promise.resolve())
      } as any
    });

    const value = selector.getValue();
    expect(value).toEqual(mockModel);
  });

  it('returns null if no selection was made', () => {
    const selector = createMockKernelSelector({
      type: 'notebook'
    });

    const value = selector.getValue();
    expect(value).toBeNull();
  });

  it('connects and disconnects dataChanged on attach and detach without leaking', () => {
    const dataChanged = new Signal<any, void>({});
    const selector = createMockKernelSelector({ type: 'notebook' });
    (selector as any).options.dataChanged = dataChanged;

    const updateSpy = jest
      .spyOn(selector, 'update')
      .mockImplementation(() => {});

    selector.onAfterAttach({} as any);
    dataChanged.emit();
    expect(updateSpy).toHaveBeenCalledTimes(1);

    selector.onAfterDetach({} as any);
    dataChanged.emit();
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});

import { CustomSessionContextDialogs } from '../dialogs';

describe('CustomSessionContextDialogs', () => {
  it('cleans up runningChanged listeners when dialog resolves or cancels', async () => {
    const sessionRunningChanged = new Signal<any, void>({});
    const kernelRunningChanged = new Signal<any, void>({});

    const sessionConnectSpy = jest.spyOn(sessionRunningChanged, 'connect');
    const sessionDisconnectSpy = jest.spyOn(
      sessionRunningChanged,
      'disconnect'
    );
    const kernelConnectSpy = jest.spyOn(kernelRunningChanged, 'connect');
    const kernelDisconnectSpy = jest.spyOn(kernelRunningChanged, 'disconnect');

    const dialogs = new CustomSessionContextDialogs({
      database: {
        favorites: {
          ready: Promise.resolve(),
          changed: new Signal<any, void>({})
        } as any,
        lastUsed: {
          ready: Promise.resolve(),
          changed: new Signal<any, void>({})
        } as any
      },
      commands: {
        iconClass: () => '',
        icon: () => undefined,
        caption: () => '',
        label: () => ''
      } as any,
      settingRegistry: {
        load: jest.fn(() => Promise.resolve({ composite: {} }))
      } as any,
      kernelManager: {
        running: () => [][Symbol.iterator](),
        runningChanged: kernelRunningChanged
      } as any,
      kernelTable: {
        changed: new Signal<any, void>({})
      } as any
    });

    const mockSessionContext: any = {
      isDisposed: false,
      hasNoKernel: true,
      kernelDisplayName: 'No Kernel',
      kernelPreference: { autoStartDefault: false },
      specsManager: { specs: { kernelspecs: {} } },
      sessionManager: {
        running: () => [],
        runningChanged: sessionRunningChanged
      },
      changeKernel: jest.fn()
    };

    await dialogs.selectKernel(mockSessionContext);

    expect(sessionConnectSpy).toHaveBeenCalledTimes(1);
    expect(sessionDisconnectSpy).toHaveBeenCalledTimes(1);
    expect(kernelConnectSpy).toHaveBeenCalledTimes(1);
    expect(kernelDisconnectSpy).toHaveBeenCalledTimes(1);
  });
});

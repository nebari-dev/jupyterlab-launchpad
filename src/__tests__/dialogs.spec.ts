jest.mock('../icons', () => ({
  codeServerIcon: {},
  nebiIcon: {},
  starIcon: { react: () => null },
  arrowUpDownIcon: { react: () => null },
  infoCircleIcon: { react: () => null },
  updateAvailableIcon: { react: () => null }
}));

import { Dialog, ISessionContext } from '@jupyterlab/apputils';
import type { Kernel, KernelSpec, Session } from '@jupyterlab/services';
import type { ISettingRegistry } from '@jupyterlab/settingregistry';
import { nullTranslator } from '@jupyterlab/translation';
import type { CommandRegistry } from '@lumino/commands';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';
import { CustomSessionContextDialogs, KernelSelector } from '../dialogs';
import type {
  IFavoritesDatabase,
  ILastUsedDatabase,
  ILauncherDatabase,
  ILaunchpadKernelTable
} from '../types';

const kernelspec = (
  name: string,
  display_name: string
): KernelSpec.ISpecModel => ({
  name,
  display_name,
  language: 'python',
  argv: [],
  resources: {}
});

const specs: KernelSpec.ISpecModels = {
  default: 'python3',
  kernelspecs: {
    python3: kernelspec('python3', 'Python 3'),
    ir: kernelspec('ir', 'R')
  }
};

/**
 * A signal for a mock; the code under test never reads its sender.
 */
function createSignal<T, U = void>(): Signal<T, U> {
  return new Signal<T, U>({} as T);
}

/**
 * A signal that records the slots connected to and disconnected from it.
 */
function createSignalSpy() {
  return {
    connect: jest.fn((_slot: () => void) => true),
    disconnect: jest.fn((_slot: () => void) => true)
  };
}

function createOptions() {
  const database = {
    favorites: {
      ready: Promise.resolve(),
      get: () => false,
      set: jest.fn(() => Promise.resolve()),
      changed: createSignal<IFavoritesDatabase>()
    },
    lastUsed: {
      ready: Promise.resolve(),
      get: () => null,
      recordAsUsed: jest.fn(() => Promise.resolve()),
      recordAsUsedNow: jest.fn(() => Promise.resolve()),
      changed: createSignal<ILastUsedDatabase>()
    }
  } satisfies ILauncherDatabase;
  const commands = {
    iconClass: () => '',
    icon: () => undefined,
    caption: () => '',
    label: (_id: string, args: ReadonlyPartialJSONObject) => {
      const preference = args.kernelPreference as { name?: string } | undefined;
      return (args.kernelName as string | undefined) ?? preference?.name ?? '';
    },
    execute: jest.fn(() => Promise.resolve()),
    commandChanged: createSignal<
      CommandRegistry,
      CommandRegistry.ICommandChangedArgs
    >()
  };
  const settings = {
    composite: {},
    changed: createSignal<ISettingRegistry.ISettings>(),
    set: jest.fn(() => Promise.resolve())
  } as unknown as ISettingRegistry.ISettings;
  const kernelTable = {
    changed: createSignal<ILaunchpadKernelTable>(),
    getColumnDefaultVisibility: () => true,
    setColumnDefaultVisibility: jest.fn(),
    registerMetadataColumn: jest.fn(),
    getMetadataColumn: () => undefined,
    getMetadataColumns: () => [],
    registerAction: jest.fn(),
    getActions: () => [],
    registerIconFallbackTitleProvider: jest.fn(),
    getIconFallbackTitle: () => ''
  } satisfies ILaunchpadKernelTable;
  return {
    database,
    commands,
    registry: commands as unknown as CommandRegistry,
    settings,
    kernelTable
  };
}

function createDialogs(
  kernelRunningChanged: object = createSignal<
    Kernel.IManager,
    Kernel.IModel[]
  >()
): CustomSessionContextDialogs {
  const { database, registry, settings, kernelTable } = createOptions();
  return new CustomSessionContextDialogs({
    database,
    commands: registry,
    settingRegistry: {
      load: jest.fn(() => Promise.resolve(settings))
    } as unknown as ISettingRegistry,
    kernelManager: {
      running: () => [][Symbol.iterator](),
      runningChanged: kernelRunningChanged
    } as unknown as Kernel.IManager,
    kernelTable
  });
}

function createSessionContext(
  runningChanged: object = createSignal<Session.IManager, Session.IModel[]>()
) {
  return {
    isDisposed: false,
    hasNoKernel: false,
    kernelDisplayName: 'Python 3',
    name: 'Untitled.ipynb',
    type: 'notebook',
    kernelPreference: {},
    specsManager: { specs },
    sessionManager: {
      running: () => [][Symbol.iterator](),
      runningChanged
    },
    changeKernel: jest.fn(() => Promise.resolve()),
    shutdown: jest.fn(() => Promise.resolve())
  };
}

/**
 * Render a kernel selector outside of a dialog, as the dialog body is rendered.
 */
function createSelector(
  options: {
    type?: string;
    sessions?: Session.IModel[];
    kernels?: Kernel.IModel[];
  } = {}
) {
  const { type = 'notebook', sessions = [], kernels = [] } = options;
  const { database, commands, registry, settings, kernelTable } =
    createOptions();
  const acceptDialog = jest.fn();
  const dataChanged = createSignal<CustomSessionContextDialogs>();
  let currentSpecs = specs;
  const selector = new KernelSelector({
    data: () => ({
      specs: currentSpecs,
      sessions,
      kernels: kernels[Symbol.iterator](),
      preference: {}
    }),
    dataChanged,
    name: 'Untitled.ipynb',
    commands: registry,
    favoritesDatabase: database.favorites,
    lastUsedDatabase: database.lastUsed,
    kernelTable,
    settings,
    trans: nullTranslator.load('jupyterlab'),
    acceptDialog,
    type
  });
  Widget.attach(selector, document.body);
  const setSpecs = (next: KernelSpec.ISpecModels) => {
    currentSpecs = next;
    dataChanged.emit();
  };
  return { selector, commands, acceptDialog, dataChanged, setSpecs };
}

async function waitFor<T>(find: () => T | null | undefined): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt++) {
    MessageLoop.flush();
    const found = find();
    if (found) {
      return found;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the kernel selector to render');
}

function findRows(container: ParentNode, label: string): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.jp-TableKernelItem')
  ).filter(element => element.textContent?.includes(label));
}

function findRow(
  container: ParentNode,
  label: string
): HTMLElement | undefined {
  return findRows(container, label)[0];
}

/**
 * Press Enter on an element; returns whether the key was left uncanceled.
 */
function pressEnter(element: HTMLElement): boolean {
  element.focus();
  return element.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true
    })
  );
}

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe('KernelSelector', () => {
  it.each(['notebook', 'console'])(
    'starts the kernel picked for a %s',
    async type => {
      const { selector, acceptDialog } = createSelector({ type });
      try {
        (await waitFor(() => findRow(selector.node, 'ir'))).click();

        expect(acceptDialog).toHaveBeenCalledTimes(1);
        expect(selector.getValue()).toEqual({ name: 'ir' });
      } finally {
        selector.dispose();
      }
    }
  );

  it('connects to the running kernel picked', async () => {
    const kernel = { id: 'kernel-1', name: 'ir', execution_state: 'idle' };
    const { selector } = createSelector({
      sessions: [
        {
          id: 'session-1',
          name: 'Other.ipynb',
          path: 'Other.ipynb',
          type: 'notebook',
          kernel
        }
      ],
      kernels: [kernel]
    });
    try {
      // The first row starts a new kernel, the second lists the running one.
      const rows = await waitFor(() => {
        const found = findRows(selector.node, 'ir');
        return found.length === 2 ? found : null;
      });
      rows[1].click();

      expect(selector.getValue()).toEqual(kernel);
    } finally {
      selector.dispose();
    }
  });

  it('starts no kernel when no row was picked', async () => {
    const { selector } = createSelector();
    try {
      await waitFor(() => findRow(selector.node, 'ir'));

      expect(selector.getValue()).toBeNull();
    } finally {
      selector.dispose();
    }
  });

  // Since JupyterLab 4.6.6 (jupyterlab#20370) the dialog leaves Enter on a
  // kernel row to the row itself, so the row must select, not launch, it.
  it('selects the kernel when Enter reaches the row', async () => {
    const { selector, commands, acceptDialog } = createSelector();
    try {
      const row = await waitFor(() => findRow(selector.node, 'ir'));
      const uncanceled = pressEnter(row);
      row.blur();

      expect(commands.execute).not.toHaveBeenCalled();
      expect(acceptDialog).toHaveBeenCalledTimes(1);
      expect(selector.getValue()).toEqual({ name: 'ir' });
      // The dialog closes and returns the focus to the button that opened it,
      // which would otherwise be clicked by the same Enter.
      expect(uncanceled).toBe(false);
    } finally {
      selector.dispose();
    }
  });

  it('stops updating once it is detached', async () => {
    const update = jest.spyOn(KernelSelector.prototype, 'update');
    const { selector, dataChanged } = createSelector();
    try {
      await waitFor(() => findRow(selector.node, 'ir'));
      const calls = update.mock.calls.length;
      dataChanged.emit();
      expect(update).toHaveBeenCalledTimes(calls + 1);

      Widget.detach(selector);
      dataChanged.emit();
      expect(update).toHaveBeenCalledTimes(calls + 1);
    } finally {
      update.mockRestore();
      selector.dispose();
    }
  });

  // Before JupyterLab 4.6.6 the dialog accepts on Enter without the row seeing
  // it, so the selector falls back to the row that has keyboard focus.
  describe('focused row fallback', () => {
    it('returns the focused row', async () => {
      const { selector } = createSelector();
      try {
        const row = await waitFor(() => findRow(selector.node, 'ir'));
        row.focus();

        expect(selector.getValue()).toEqual({ name: 'ir' });
      } finally {
        selector.dispose();
      }
    });

    it('ignores a row after focus moves away from it', async () => {
      const { selector } = createSelector();
      try {
        const row = await waitFor(() => findRow(selector.node, 'ir'));
        row.focus();
        selector.node
          .querySelector<HTMLInputElement>('.jp-Launcher-searchBox input')!
          .focus();

        expect(selector.getValue()).toBeNull();
      } finally {
        selector.dispose();
      }
    });

    it('ignores a focused row that is no longer rendered', async () => {
      const { selector, setSpecs } = createSelector();
      try {
        const row = await waitFor(() => findRow(selector.node, 'ir'));
        row.focus();
        setSpecs({
          default: 'python3',
          kernelspecs: { python3: specs.kernelspecs.python3 }
        });
        await waitFor(() => !findRow(selector.node, 'ir'));

        expect(selector.getValue()).toBeNull();
      } finally {
        selector.dispose();
      }
    });

    it('prefers the clicked row over the focused row', async () => {
      const { selector } = createSelector();
      try {
        (await waitFor(() => findRow(selector.node, 'python3'))).click();
        findRow(selector.node, 'ir')!.focus();

        expect(selector.getValue()).toEqual({ name: 'python3' });
      } finally {
        selector.dispose();
      }
    });
  });
});

describe('CustomSessionContextDialogs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Dialog.flush();
  });

  // Uses the real JupyterLab Dialog: its keyboard handling decides whether
  // Enter on a kernel row ever reaches the row's own handler.
  it('starts the focused kernel on Enter instead of shutting down the current one', async () => {
    const sessionContext = createSessionContext();

    const done = createDialogs().selectKernel(
      sessionContext as unknown as ISessionContext
    );
    const row = await waitFor(() => {
      const dialog = document.querySelector('.jp-KernelSelector-Dialog');
      return dialog ? findRow(dialog, 'ir') : undefined;
    });

    pressEnter(row);
    await done;

    expect(sessionContext.shutdown).not.toHaveBeenCalled();
    expect(sessionContext.changeKernel).toHaveBeenCalledWith({ name: 'ir' });
  });

  it.each([
    ['closes', false],
    ['fails to open', true]
  ])(
    'disconnects from running changes once the dialog %s',
    async (_, fails) => {
      const launch = jest.spyOn(Dialog.prototype, 'launch');
      if (fails) {
        launch.mockRejectedValue(new Error('launch failed'));
      } else {
        launch.mockResolvedValue({
          button: Dialog.cancelButton(),
          value: null,
          isChecked: null
        });
      }
      const sessionRunningChanged = createSignalSpy();
      const kernelRunningChanged = createSignalSpy();

      const done = createDialogs(kernelRunningChanged).selectKernel(
        createSessionContext(
          sessionRunningChanged
        ) as unknown as ISessionContext
      );
      if (fails) {
        await expect(done).rejects.toThrow('launch failed');
      } else {
        await done;
      }

      for (const runningChanged of [
        sessionRunningChanged,
        kernelRunningChanged
      ]) {
        expect(runningChanged.connect).toHaveBeenCalledTimes(1);
        expect(runningChanged.disconnect).toHaveBeenCalledWith(
          runningChanged.connect.mock.calls[0][0]
        );
      }
    }
  );
});

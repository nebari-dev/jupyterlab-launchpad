// Uses the real JupyterLab Dialog: its keyboard handling decides whether
// Enter on a kernel row ever reaches the row's own handler.
jest.mock('../icons', () => ({
  codeServerIcon: {},
  nebiIcon: {},
  starIcon: { react: () => null },
  arrowUpDownIcon: { react: () => null },
  infoCircleIcon: { react: () => null },
  updateAvailableIcon: { react: () => null }
}));

import { Dialog } from '@jupyterlab/apputils';
import { nullTranslator } from '@jupyterlab/translation';
import { MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';
import { CustomSessionContextDialogs, KernelSelector } from '../dialogs';

const kernelspec = (name: string, display_name: string) => ({
  name,
  display_name,
  language: 'python',
  argv: [],
  resources: {}
});

const specs = {
  default: 'python3',
  kernelspecs: {
    python3: kernelspec('python3', 'Python 3'),
    ir: kernelspec('ir', 'R')
  }
};

function createOptions() {
  return {
    database: {
      favorites: {
        ready: Promise.resolve(),
        get: () => false,
        set: jest.fn(() => Promise.resolve()),
        changed: new Signal<any, void>({})
      },
      lastUsed: {
        ready: Promise.resolve(),
        get: () => null,
        recordAsUsed: jest.fn(() => Promise.resolve()),
        recordAsUsedNow: jest.fn(() => Promise.resolve()),
        changed: new Signal<any, void>({})
      }
    } as any,
    commands: {
      iconClass: () => '',
      icon: () => undefined,
      caption: () => '',
      label: (_: string, args: any) => args.kernelName,
      execute: jest.fn(() => Promise.resolve()),
      commandChanged: new Signal<any, any>({})
    } as any,
    settings: {
      composite: {},
      changed: new Signal<any, void>({}),
      set: jest.fn(() => Promise.resolve())
    } as any,
    kernelTable: {
      changed: new Signal<any, void>({}),
      getMetadataColumns: () => [],
      getActions: () => [],
      getColumnDefaultVisibility: () => true,
      getIconFallbackTitle: () => ''
    } as any
  };
}

function createDialogs(): CustomSessionContextDialogs {
  const { database, commands, settings, kernelTable } = createOptions();
  return new CustomSessionContextDialogs({
    database,
    commands,
    settingRegistry: {
      load: jest.fn(() => Promise.resolve(settings))
    } as any,
    kernelManager: {
      running: () => [][Symbol.iterator](),
      runningChanged: new Signal<any, void>({})
    } as any,
    kernelTable
  });
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

function findRow(
  container: ParentNode,
  label: string
): HTMLElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.jp-TableKernelItem')
  ).find(element => element.textContent?.includes(label));
}

function pressEnter(element: HTMLElement): void {
  element.focus();
  element.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true
    })
  );
}

describe('Select Kernel dialog keyboard selection', () => {
  beforeAll(() => {
    if (!(globalThis as any).ResizeObserver) {
      (globalThis as any).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  afterEach(() => {
    Dialog.flush();
  });

  it('starts the focused kernel on Enter instead of shutting down the current one', async () => {
    const sessionContext: any = {
      isDisposed: false,
      hasNoKernel: false,
      kernelDisplayName: 'Python 3',
      name: 'Untitled.ipynb',
      type: 'notebook',
      kernelPreference: {},
      specsManager: { specs },
      sessionManager: {
        running: () => [][Symbol.iterator](),
        runningChanged: new Signal<any, void>({})
      },
      changeKernel: jest.fn(() => Promise.resolve()),
      shutdown: jest.fn(() => Promise.resolve())
    };

    const done = createDialogs().selectKernel(sessionContext);
    const row = await waitFor(() => {
      const dialog = document.querySelector('.jp-KernelSelector-Dialog');
      return dialog ? findRow(dialog, 'ir') : undefined;
    });

    pressEnter(row);
    await done;

    expect(sessionContext.shutdown).not.toHaveBeenCalled();
    expect(sessionContext.changeKernel).toHaveBeenCalledWith({ name: 'ir' });
  });

  // Since JupyterLab 4.6.6 (jupyterlab#20370) the dialog leaves Enter on a
  // kernel row to the row itself, so the row must select, not launch, it.
  it('selects the kernel when Enter reaches the row', async () => {
    const { database, commands, settings, kernelTable } = createOptions();
    const acceptDialog = jest.fn();
    const selector = new KernelSelector({
      data: () => ({
        specs,
        sessions: [][Symbol.iterator](),
        kernels: [][Symbol.iterator](),
        preference: {}
      }),
      dataChanged: new Signal<any, void>({}),
      name: 'Untitled.ipynb',
      commands,
      favoritesDatabase: database.favorites,
      lastUsedDatabase: database.lastUsed,
      kernelTable,
      settings,
      trans: nullTranslator.load('jupyterlab'),
      acceptDialog,
      type: 'notebook'
    });
    Widget.attach(selector, document.body);

    try {
      const row = await waitFor(() => findRow(selector.node, 'ir'));
      pressEnter(row);
      row.blur();

      expect(commands.execute).not.toHaveBeenCalled();
      expect(acceptDialog).toHaveBeenCalledTimes(1);
      expect(selector.getValue()).toEqual({ name: 'ir' });
    } finally {
      selector.dispose();
    }
  });
});

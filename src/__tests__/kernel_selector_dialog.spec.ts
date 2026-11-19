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
      label: (_: string, args: any) =>
        args.kernelName ?? args.kernelPreference?.name,
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

/**
 * Render a kernel selector outside of a dialog, as the dialog body is rendered.
 */
function createSelector(type = 'notebook') {
  const { database, commands, settings, kernelTable } = createOptions();
  const acceptDialog = jest.fn();
  const dataChanged = new Signal<any, void>({});
  let currentSpecs: any = specs;
  const selector = new KernelSelector({
    data: () => ({
      specs: currentSpecs,
      sessions: [][Symbol.iterator](),
      kernels: [][Symbol.iterator](),
      preference: {}
    }),
    dataChanged,
    name: 'Untitled.ipynb',
    commands,
    favoritesDatabase: database.favorites,
    lastUsedDatabase: database.lastUsed,
    kernelTable,
    settings,
    trans: nullTranslator.load('jupyterlab'),
    acceptDialog,
    type
  });
  Widget.attach(selector, document.body);
  const setSpecs = (next: any) => {
    currentSpecs = next;
    dataChanged.emit();
  };
  return { selector, commands, acceptDialog, setSpecs };
}

beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe('Select Kernel dialog keyboard selection', () => {
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
});

describe('Console kernel selection', () => {
  it('starts the kernel picked for a console', async () => {
    const { selector, acceptDialog } = createSelector('console');
    try {
      (await waitFor(() => findRow(selector.node, 'ir'))).click();

      expect(acceptDialog).toHaveBeenCalledTimes(1);
      expect(selector.getValue()).toEqual({ name: 'ir' });
    } finally {
      selector.dispose();
    }
  });
});

// Before JupyterLab 4.6.6 the dialog accepts on Enter without the row seeing
// it, so the selector falls back to the row that has keyboard focus.
describe('Kernel selector focused row fallback', () => {
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

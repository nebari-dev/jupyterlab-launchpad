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
import { MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { CustomSessionContextDialogs } from '../dialogs';

const kernelspec = (name: string, display_name: string) => ({
  name,
  display_name,
  language: 'python',
  argv: [],
  resources: {}
});

function createDialogs(): CustomSessionContextDialogs {
  return new CustomSessionContextDialogs({
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
    settingRegistry: {
      load: jest.fn(() =>
        Promise.resolve({
          composite: {},
          changed: new Signal<any, void>({}),
          set: jest.fn(() => Promise.resolve())
        })
      )
    } as any,
    kernelManager: {
      running: () => [][Symbol.iterator](),
      runningChanged: new Signal<any, void>({})
    } as any,
    kernelTable: {
      changed: new Signal<any, void>({}),
      getMetadataColumns: () => [],
      getActions: () => [],
      getColumnDefaultVisibility: () => true,
      getIconFallbackTitle: () => ''
    } as any
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
      specsManager: {
        specs: {
          default: 'python3',
          kernelspecs: {
            python3: kernelspec('python3', 'Python 3'),
            ir: kernelspec('ir', 'R')
          }
        }
      },
      sessionManager: {
        running: () => [][Symbol.iterator](),
        runningChanged: new Signal<any, void>({})
      },
      changeKernel: jest.fn(() => Promise.resolve()),
      shutdown: jest.fn(() => Promise.resolve())
    };

    const done = createDialogs().selectKernel(sessionContext);
    const row = await waitFor(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.jp-KernelSelector-Dialog .jp-TableKernelItem'
        )
      ).find(element => element.textContent?.includes('ir'))
    );

    row.focus();
    row.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 13,
        bubbles: true,
        cancelable: true
      })
    );
    await done;

    expect(sessionContext.shutdown).not.toHaveBeenCalled();
    expect(sessionContext.changeKernel).toHaveBeenCalledWith({ name: 'ir' });
  });
});

import { JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ISignal, Signal } from '@lumino/signaling';
import {
  IKernelAction,
  IKernelActionOptions,
  IKernelIconFallbackTitleOptions,
  IKernelIconFallbackTitleProvider,
  IKernelMetadataColumn,
  ILaunchpadKernelTable
} from './types';

export class LaunchpadKernelTable implements ILaunchpadKernelTable {
  get changed(): ISignal<ILaunchpadKernelTable, void> {
    return this._changed;
  }

  registerMetadataColumn(column: IKernelMetadataColumn): void {
    if (!column.id) {
      throw new Error('Kernel metadata column id is required.');
    }

    this._metadataColumns.set(column.id, column);
    this._changed.emit();
  }

  getMetadataColumn(id: string): IKernelMetadataColumn | undefined {
    return this._metadataColumns.get(id);
  }

  registerAction(action: IKernelAction): void {
    if (!action.id) {
      throw new Error('Kernel action id is required.');
    }

    this._actions.set(action.id, action);
    this._changed.emit();
  }

  getActions(options: IKernelActionOptions): IKernelAction[] {
    return [...this._actions.values()]
      .filter(action => action.isAvailable?.(options) ?? true)
      .sort((a, b) => (a.rank ?? 100) - (b.rank ?? 100));
  }

  registerIconFallbackTitleProvider(
    provider: IKernelIconFallbackTitleProvider
  ): void {
    if (!provider.id) {
      throw new Error('Kernel icon fallback title provider id is required.');
    }

    this._iconFallbackTitleProviders.set(provider.id, provider);
    this._changed.emit();
  }

  getIconFallbackTitle(
    options: IKernelIconFallbackTitleOptions
  ): string | undefined {
    for (const provider of this._iconFallbackTitleProviders.values()) {
      const title = provider.title(options);
      if (title !== undefined) {
        return title;
      }
    }
    return undefined;
  }

  private _metadataColumns = new Map<string, IKernelMetadataColumn>();
  private _actions = new Map<string, IKernelAction>();
  private _iconFallbackTitleProviders = new Map<
    string,
    IKernelIconFallbackTitleProvider
  >();
  private _changed = new Signal<ILaunchpadKernelTable, void>(this);
}

export const kernelTablePlugin: JupyterFrontEndPlugin<ILaunchpadKernelTable> = {
  id: 'jupyterlab-launchpad:kernel-table',
  description: 'Kernel table presentation registry for launchpad',
  provides: ILaunchpadKernelTable,
  autoStart: true,
  activate: () => new LaunchpadKernelTable()
};

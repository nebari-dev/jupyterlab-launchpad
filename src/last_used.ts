import { ILauncher } from '@jupyterlab/launcher';
import { ItemDatabase } from './database';

export interface ILastUsedDatabase {
  get(item: ILauncher.IItemOptions): Date | null;
  recordAsUsedNow(item: ILauncher.IItemOptions): Promise<void>;
}

export class LastUsedDatabase
  extends ItemDatabase<string>
  implements ILastUsedDatabase
{
  protected _stateDBKey = 'new-launcher:last-used';

  get(item: ILauncher.IItemOptions) {
    const date = super._get(item);
    return date ? new Date(date) : null;
  }

  async recordAsUsedNow(item: ILauncher.IItemOptions) {
    this._set(item, new Date().toUTCString());
  }
}

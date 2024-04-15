import { ILauncher } from '@jupyterlab/launcher';

export interface ILastUsedDatabase {
  get(item: ILauncher.IItemOptions): Date | null;
  recordAsUsedNow(item: ILauncher.IItemOptions): void;
}

export class LastUsedDatabase {
  constructor() {
    // TODO: use settings registry, or state db, or server to persist this info
    this._db = new Map();
  }
  get(item: ILauncher.IItemOptions) {
    const date = this._db.get(this._itemKey(item));
    return date ? new Date(date) : null;
  }
  recordAsUsedNow(item: ILauncher.IItemOptions) {
    this._db.set(this._itemKey(item), new Date().toUTCString());
  }
  private _itemKey(item: ILauncher.IItemOptions): string {
    return item.command + '_' + JSON.stringify(item.args);
  }
  private _db: Map<string, string>;
}

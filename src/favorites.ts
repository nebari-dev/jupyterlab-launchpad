import { ILauncher } from '@jupyterlab/launcher';

export interface IFavoritesDatabase {
  get(item: ILauncher.IItemOptions): boolean | null;
  set(item: ILauncher.IItemOptions, isFavourite: boolean): void;
}

export class FavoritesDatabase implements IFavoritesDatabase {
  constructor() {
    // TODO: use settings registry, or state db, or server to persist this info
    this._db = new Map();
  }
  get(item: ILauncher.IItemOptions) {
    return this._db.get(this._itemKey(item)) ?? null;
  }
  set(item: ILauncher.IItemOptions, isFavourite: boolean) {
    this._db.set(this._itemKey(item), isFavourite);
  }
  private _itemKey(item: ILauncher.IItemOptions): string {
    return item.command + '_' + JSON.stringify(item.args);
  }
  private _db: Map<string, boolean>;
}

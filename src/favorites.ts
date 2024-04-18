import { ILauncher } from '@jupyterlab/launcher';
import { ItemDatabase } from './database';

export interface IFavoritesDatabase {
  get(item: ILauncher.IItemOptions): boolean | null;
  set(item: ILauncher.IItemOptions, isFavourite: boolean): Promise<void>;
}

export class FavoritesDatabase
  extends ItemDatabase<boolean>
  implements IFavoritesDatabase
{
  protected _stateDBKey = 'new-launcher:favorites';

  get(item: ILauncher.IItemOptions) {
    return super._get(item) ?? null;
  }

  async set(item: ILauncher.IItemOptions, isFavourite: boolean) {
    this._set(item, isFavourite);
  }
}

import { IStateDB } from '@jupyterlab/statedb';
import { ReadonlyPartialJSONValue, PromiseDelegate } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';
import { ILauncher } from '@jupyterlab/launcher';
import {
  ILastUsedDatabase,
  IFavoritesDatabase,
  ILauncherDatabase
} from './types';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

abstract class Database<V extends ReadonlyPartialJSONValue, K> {
  ready: Promise<void>;
  constructor(options: { stateDB: IStateDB; fetchInterval: number }) {
    this._stateDB = options.stateDB;
    const ready = new PromiseDelegate<void>();
    this.ready = ready.promise;
    this._updateDB().then(() => ready.resolve());
    window.setInterval(this._updateDB, options.fetchInterval);
  }
  protected _get(item: K) {
    if (!this._db) {
      console.error('Database is not ready!');
      return null;
    }
    return this._db[this._itemKey(item)];
  }
  protected async _set(item: K, value: V) {
    const db = await this._fetch();
    this._db = db;
    db[this._itemKey(item)] = value;
    await this._stateDB.save(this._stateDBKey, db);
  }
  private _updateDB = async () => {
    const db = await this._fetch();
    this._db = db;
  };
  private async _fetch(): Promise<Record<string, V>> {
    let db = (await this._stateDB.fetch(this._stateDBKey)) as
      | Record<string, V>
      | undefined;
    if (typeof db === 'undefined') {
      // retry once: sometimes state DB does not load up on first try
      db = (await this._stateDB.fetch(this._stateDBKey)) as
        | Record<string, V>
        | undefined;
    }
    if (typeof db === 'undefined') {
      return {};
    }
    return db;
  }
  protected abstract _itemKey(item: K): string;
  protected abstract _stateDBKey: string;
  private _db: Record<string, V> | null = null;
  private _stateDB: IStateDB;
}

export abstract class ItemDatabase<
  V extends ReadonlyPartialJSONValue
> extends Database<V, ILauncher.IItemOptions> {
  protected _itemKey(item: ILauncher.IItemOptions): string {
    return item.command + '_' + JSON.stringify(item.args);
  }
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
    this._changed.emit();
  }

  get changed() {
    return this._changed;
  }

  private _changed = new Signal<FavoritesDatabase, void>(this);
}

/**
 * Initialization data for the jupyterlab-new-launcher extension.
 */
export const databasePlugin: JupyterFrontEndPlugin<ILauncherDatabase> = {
  id: 'jupyterlab-new-launcher:database',
  description: 'A redesigned JupyterLab launcher databases',
  provides: ILauncherDatabase,
  autoStart: true,
  requires: [IStateDB],
  activate: (app: JupyterFrontEnd, stateDB: IStateDB) => {
    const databaseOptions = {
      stateDB,
      fetchInterval: 10000
    };
    return {
      lastUsed: new LastUsedDatabase(databaseOptions),
      favorites: new FavoritesDatabase(databaseOptions)
    };
  }
};

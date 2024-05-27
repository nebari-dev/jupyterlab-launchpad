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
import { requestAPI } from './handler';

type SimpleDB = Omit<IStateDB, 'list' | 'toJSON' | 'remove'>;

abstract class Database<V extends ReadonlyPartialJSONValue, K> {
  ready: Promise<void>;
  constructor(options: { stateDB: SimpleDB; fetchInterval: number }) {
    this._stateDB = options.stateDB;
    const ready = new PromiseDelegate<void>();
    this.ready = ready.promise;
    // delay until the child class is ready (so that _stateDBKey is there)
    window.setTimeout(() => this._updateDB().then(() => ready.resolve()), 0);
    window.setInterval(this._updateDB.bind(this), options.fetchInterval);
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
  private async _updateDB() {
    const db = await this._fetch();
    this._db = db;
  }
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
  private _stateDB: SimpleDB;
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
  protected readonly _stateDBKey = 'new-launcher:last-used';

  get(item: ILauncher.IItemOptions) {
    const date = super._get(item);
    return date ? new Date(date) : null;
  }

  async recordAsUsedNow(item: ILauncher.IItemOptions) {
    await this.recordAsUsed(item, new Date());
  }

  async recordAsUsed(item: ILauncher.IItemOptions, date: Date) {
    await this._set(item, date.toUTCString());
    this._changed.emit();
  }

  get changed() {
    return this._changed;
  }

  private _changed = new Signal<LastUsedDatabase, void>(this);
}

export class FavoritesDatabase
  extends ItemDatabase<boolean>
  implements IFavoritesDatabase
{
  protected readonly _stateDBKey = 'new-launcher:favorites';

  get(item: ILauncher.IItemOptions) {
    return super._get(item) ?? null;
  }

  async set(item: ILauncher.IItemOptions, isFavourite: boolean) {
    await this._set(item, isFavourite);
    this._changed.emit();
  }

  get changed() {
    return this._changed;
  }

  private _changed = new Signal<FavoritesDatabase, void>(this);
}

type DatabaseId = 'new-launcher:favorites' | 'new-launcher:last-used';

class SingletonStateDB<
  T extends ReadonlyPartialJSONValue = ReadonlyPartialJSONValue
> implements SimpleDB
{
  async fetch(id: DatabaseId): Promise<T | undefined> {
    return await requestAPI<T>(this._endpointsMap[id]);
  }

  async save(id: DatabaseId, value: T): Promise<any> {
    await requestAPI<T>(this._endpointsMap[id], {
      method: 'POST',
      body: JSON.stringify(value)
    });
  }

  private _endpointsMap = {
    'new-launcher:favorites': 'database/favorites',
    'new-launcher:last-used': 'database/last-used'
  };
}

/**
 * Initialization data for the jupyterlab-new-launcher extension.
 */
export const databasePlugin: JupyterFrontEndPlugin<ILauncherDatabase> = {
  id: 'jupyterlab-new-launcher:database',
  description: 'A redesigned JupyterLab launcher databases',
  provides: ILauncherDatabase,
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    const databaseOptions = {
      stateDB: new SingletonStateDB(),
      fetchInterval: 10000
    };
    return {
      lastUsed: new LastUsedDatabase(databaseOptions),
      favorites: new FavoritesDatabase(databaseOptions)
    };
  }
};

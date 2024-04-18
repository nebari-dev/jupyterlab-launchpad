import { IStateDB } from '@jupyterlab/statedb';
import { ReadonlyPartialJSONValue, PromiseDelegate } from '@lumino/coreutils';
import { ILauncher } from '@jupyterlab/launcher';

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

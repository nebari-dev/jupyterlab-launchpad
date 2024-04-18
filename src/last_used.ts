import { ILauncher } from '@jupyterlab/launcher';
import { IStateDB } from '@jupyterlab/statedb';

export interface ILastUsedDatabase {
  get(item: ILauncher.IItemOptions): Date | null;
  recordAsUsedNow(item: ILauncher.IItemOptions): Promise<void>;
}

type DatabaseLayout = Record<string, string>;

export class LastUsedDatabase implements ILastUsedDatabase {
  constructor(options: { stateDB: IStateDB; fetchInterval: number }) {
    this._stateDB = options.stateDB;
    this._updateDB();
    window.setInterval(this._updateDB, options.fetchInterval);
  }
  get(item: ILauncher.IItemOptions) {
    if (!this._db) {
      return null;
    }
    const date = this._db[this._itemKey(item)];
    return date ? new Date(date) : null;
  }
  async recordAsUsedNow(item: ILauncher.IItemOptions) {
    const db = await this._fetch();
    this._db = db;
    db[this._itemKey(item)] = new Date().toUTCString();
    await this._stateDB.save(this._stateDBKey, db);
  }
  private _updateDB = () => {
    this._fetch()
      .then(db => {
        this._db = db;
      })
      .catch(console.warn);
  };
  private async _fetch(): Promise<DatabaseLayout> {
    const db = (await this._stateDB.fetch(this._stateDBKey)) as
      | DatabaseLayout
      | undefined;
    if (typeof db === 'undefined') {
      return {};
    }
    return db;
  }
  private _itemKey(item: ILauncher.IItemOptions): string {
    return item.command + '_' + JSON.stringify(item.args);
  }
  private _db: DatabaseLayout | null = null;
  private _stateDB: IStateDB;
  private _stateDBKey = 'new-launcher:last-used';
}

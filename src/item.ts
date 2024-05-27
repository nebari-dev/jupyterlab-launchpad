// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { CommandRegistry } from '@lumino/commands';
import type { VirtualElement } from '@lumino/virtualdom';
import { ReadonlyJSONObject, JSONObject } from '@lumino/coreutils';
import { ILauncher } from '@jupyterlab/launcher';
import { Signal, ISignal } from '@lumino/signaling';
import { IItem, IFavoritesDatabase, ILastUsedDatabase } from './types';
import { codeServerIcon } from './icons';

export class Item implements IItem {
  // base ILauncher.IItemOptions
  command: string;
  args?: ReadonlyJSONObject;
  category?: string;
  rank?: number;
  kernelIconUrl?: string;
  metadata?: ReadonlyJSONObject;
  // custom additions
  label: string;
  caption: string;
  icon: VirtualElement.IRenderer | undefined;
  iconClass: string;

  constructor(
    private _options: {
      commands: CommandRegistry;
      item: ILauncher.IItemOptions;
      cwd: string;
      lastUsedDatabase: ILastUsedDatabase;
      favoritesDatabase: IFavoritesDatabase;
    }
  ) {
    const { item, commands, cwd } = _options;
    const args = { ...item.args, cwd };
    // base
    this.command = item.command;
    this.args = args;
    this.category = item.category;
    this.rank = item.rank;
    this.kernelIconUrl = item.kernelIconUrl;
    this.metadata = item.metadata ?? {};
    // custom
    this.iconClass = commands.iconClass(item.command, args);
    this.icon = commands.icon(item.command, args);
    this.caption = commands.caption(item.command, args);
    this.label = commands.label(item.command, args);
    // special handling for conda-store
    // https://www.nebari.dev/docs/faq/#why-is-there-duplication-in-names-of-environments
    const kernel = this.metadata['kernel'] as JSONObject | undefined;
    if (kernel) {
      const condaStoreMatch = (
        (kernel['conda_env_name'] as string | undefined) ?? ''
      ).match(/(?<namespace>.+)-(?<duplicate>\1)-(?<environment>.+)/);
      if (condaStoreMatch && this.metadata) {
        const groups = condaStoreMatch.groups!;
        this.label =
          (kernel['conda_language'] as string | undefined) ??
          groups.environment;
        delete kernel['conda_env_name'];
        this.metadata = {
          ...this.metadata,
          kernel: {
            Namespace: groups.namespace,
            conda_env_name: groups.environment,
            ...kernel
          }
        };
      }
    }
    // set the code-server icon to support dark theme properly
    if (
      this.command === 'server-proxy:open' &&
      this.kernelIconUrl?.endsWith('/vscode')
    ) {
      this.icon = codeServerIcon;
    }
  }
  get starred() {
    const { item, favoritesDatabase } = this._options;
    return favoritesDatabase.get(item) ?? false;
  }
  get lastUsed(): Date | null {
    const value = this._lastUsed;
    this._setRefreshClock(value);
    return value;
  }
  private get _lastUsed(): Date | null {
    const { item, lastUsedDatabase } = this._options;
    return lastUsedDatabase.get(item);
  }
  get refreshLastUsed(): ISignal<IItem, void> {
    return this._refreshLastUsed;
  }
  async execute() {
    const { item, commands, lastUsedDatabase } = this._options;
    await commands.execute(item.command, this.args);
    await lastUsedDatabase.recordAsUsedNow(item);
    this._refreshLastUsed.emit();
  }
  async markAsUsedNow() {
    const { item, lastUsedDatabase } = this._options;
    await lastUsedDatabase.recordAsUsedNow(item);
    this._refreshLastUsed.emit();
  }
  async toggleStar() {
    const { item, favoritesDatabase } = this._options;
    const wasStarred = favoritesDatabase.get(item);
    const newState = !wasStarred;
    return favoritesDatabase.set(item, newState);
  }
  private _setRefreshClock(value: Date | null) {
    if (this._refreshClock !== null) {
      window.clearTimeout(this._refreshClock);
      this._refreshClock = null;
    }
    if (!value) {
      return;
    }
    const delta = Date.now() - value.getTime();
    // Refresh every 10 seconds if last used less than a minute ago;
    // Otherwise refresh every 1 minute if last used less than 1 hour ago
    // Otherwise refresh every 1 hour.
    const second = 1000;
    const minute = 60 * second;
    const interval =
      delta < 1 * minute
        ? 10 * second
        : delta < 60 * minute
          ? 1 * minute
          : 60 * minute;
    this._refreshClock = window.setTimeout(() => {
      this._refreshLastUsed.emit();
      this._setRefreshClock(this._lastUsed);
    }, interval);
  }
  private _refreshLastUsed = new Signal<Item, void>(this);
  private _refreshClock: number | null = null;
}

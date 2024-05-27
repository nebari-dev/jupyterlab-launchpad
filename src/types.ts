// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { ILauncher } from '@jupyterlab/launcher';
import type { VirtualElement } from '@lumino/virtualdom';
import type { ISignal } from '@lumino/signaling';
import { Token } from '@lumino/coreutils';
import type { LabIcon } from '@jupyterlab/ui-components';

export const MAIN_PLUGIN_ID = 'jupyterlab-new-launcher:plugin';

export interface INewLauncher extends ILauncher {
  addSection(options: ISectionOptions): void;
}

export interface ISectionOptions {
  id: string;
  title: string;
  className: string;
  icon: LabIcon;
  render: () => React.ReactNode;
  rank: number;
}

/**
 * The command IDs used by the launcher plugin.
 */
export namespace CommandIDs {
  export const create = 'launcher:create';
  export const moveColumn = 'new-launcher:table-move-column';
  export const toggleColumn = 'new-launcher:table-toggle-column';
}

export interface ISettingsLayout {
  hiddenColumns: Record<string, 'visible' | 'hidden'>;
  columnOrder: string[];
  starredSection: boolean;
  collapsedSections: Record<string, 'collapsed' | 'expanded'>;
  searchAllSections: boolean;
  utilityCommands: string[];
}

export interface IItem extends ILauncher.IItemOptions {
  label: string;
  caption: string;
  icon: VirtualElement.IRenderer | undefined;
  iconClass: string;
  execute: () => Promise<void>;
  lastUsed: Date | null;
  starred: boolean;
  toggleStar: () => Promise<void>;
  refreshLastUsed: ISignal<IItem, void>;
  markAsUsedNow: () => Promise<void>;
}

export interface IKernelItem extends IItem {
  //kernel: string;
}

export interface ILastUsedDatabase {
  ready: Promise<void>;
  get(item: ILauncher.IItemOptions): Date | null;
  recordAsUsed(item: ILauncher.IItemOptions, date: Date): Promise<void>;
  recordAsUsedNow(item: ILauncher.IItemOptions): Promise<void>;
  changed: ISignal<ILastUsedDatabase, void>;
}

export interface IFavoritesDatabase {
  ready: Promise<void>;
  get(item: ILauncher.IItemOptions): boolean | null;
  set(item: ILauncher.IItemOptions, isFavourite: boolean): Promise<void>;
  changed: ISignal<IFavoritesDatabase, void>;
}

/**
 * Databases for new launcher.
 */
export const ILauncherDatabase = new Token<ILauncherDatabase>(
  'jupyterlab-new-launcher:ILauncherDatabase',
  'Databases for new launcher.'
);

/**
 *Databases for new launcher
 */
export interface ILauncherDatabase {
  lastUsed: ILastUsedDatabase;
  favorites: IFavoritesDatabase;
}

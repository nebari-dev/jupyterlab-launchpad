// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { CommandRegistry } from '@lumino/commands';
import type { VirtualElement } from '@lumino/virtualdom';
import { ReadonlyJSONObject } from '@lumino/coreutils';
import { Time } from '@jupyterlab/coreutils';
import { ILauncher, Launcher } from '@jupyterlab/launcher';
import { TranslationBundle } from '@jupyterlab/translation';
import {
  classes,
  FilterBox,
  LabIcon,
  caretRightIcon,
  Table,
  UseSignal
} from '@jupyterlab/ui-components';
import { Signal, ISignal } from '@lumino/signaling';
import * as React from 'react';
import { ILastUsedDatabase } from './last_used';
import { IFavoritesDatabase } from './favorites';
import { starIcon } from './icons';

const STAR_BUTTON_CLASS = 'jp-starIconButton';
const KERNEL_ITEM_CLASS = 'jp-TableKernelItem';

function TypeCard(props: {
  trans: TranslationBundle;
  item: IItem;
}): React.ReactElement {
  const { item } = props;
  return (
    <div
      onClick={() => item.execute()}
      className="jp-Launcher-TypeCard jp-LauncherCard"
      title={item.caption}
      tabIndex={0}
    >
      <div className="jp-LauncherCard-icon">
        <LabIcon.resolveReact
          icon={item.icon}
          iconClass={classes(item.iconClass, 'jp-Icon-cover')}
          stylesheet="launcherCard"
        />
      </div>
      <div className="jp-LauncherCard-label">
        <p>{item.label}</p>
      </div>
    </div>
  );
}

interface IItem extends ILauncher.IItemOptions {
  label: string;
  caption: string;
  icon: VirtualElement.IRenderer | undefined;
  iconClass: string;
  execute: () => Promise<void>;
  lastUsed: Date | null;
  starred: boolean;
  toggleStar: () => void;
  refreshLastUsed: ISignal<IItem, void>;
}

interface IKernelItem extends IItem {
  //kernel: string;
}

function CollapsibleSection(
  props: React.PropsWithChildren<{
    title: string;
    className: string;
    open: boolean;
  }>
) {
  const [open, setOpen] = React.useState<boolean>(props.open);

  const handleToggle = (event: { currentTarget: { open: boolean } }) =>
    setOpen(event.currentTarget.open);

  return (
    <details
      onToggle={handleToggle}
      className={classes(props.className, 'jp-CollapsibleSection')}
      open={open}
    >
      <summary>
        <div
          className="jp-CollapsibleSection-CollapserIconWrapper"
          aria-hidden="true"
        >
          <caretRightIcon.react className="jp-CollapsibleSection-CollapserIcon" />
        </div>
        <h3 className="jp-CollapsibleSection-Title">{props.title}</h3>
      </summary>
      <div className="jp-Launcher-CardGroup jp-Launcher-cardContainer">
        {props.children}
      </div>
    </details>
  );
}

function columnLabelFromKey(key: string): string {
  if (key.length === 0) {
    return '(empty)';
  }
  return key[0].toUpperCase() + key.substring(1);
}

function LauncherBody(props: {
  trans: TranslationBundle;
  cwd: string;
  typeItems: IItem[];
  notebookItems: IKernelItem[];
}): React.ReactElement {
  const { trans, cwd, typeItems } = props;
  const [query, updateQuery] = React.useState<string>('');
  const KernelTable = Table<IKernelItem>;

  const metadataAvailable = new Set<string>();
  for (const item of props.notebookItems) {
    const kernelMetadata = item.metadata?.kernel;
    if (!kernelMetadata) {
      continue;
    }
    for (const key of Object.keys(kernelMetadata)) {
      metadataAvailable.add(key);
    }
  }

  const extraColumns: Table.IColumn<IKernelItem>[] = [...metadataAvailable].map(
    metadataKey => {
      return {
        id: metadataKey,
        label: columnLabelFromKey(metadataKey),
        renderCell: (item: IKernelItem) => {
          const kernelMeta = item.metadata?.kernel as
            | ReadonlyJSONObject
            | undefined;
          if (!kernelMeta) {
            return '-';
          }
          const value = kernelMeta[metadataKey];
          return JSON.stringify(value);
        },
        sort: (a: IKernelItem, b: IKernelItem) => {
          const aKernelMeta = a.metadata?.kernel as
            | ReadonlyJSONObject
            | undefined;
          const bKernelMeta = b.metadata?.kernel as
            | ReadonlyJSONObject
            | undefined;
          const aValue = aKernelMeta ? aKernelMeta[metadataKey] : undefined;
          const bValue = bKernelMeta ? bKernelMeta[metadataKey] : undefined;
          if (aValue === bValue) {
            return 0;
          }
          if (!aValue) {
            return 1;
          }
          if (!bValue) {
            return -1;
          }
          if (typeof aValue === 'string' && typeof bValue === 'string') {
            return aValue.localeCompare(bValue);
          }
          return aValue > bValue ? 1 : -1;
        }
      };
    }
  );

  return (
    <div className="jp-LauncherBody">
      <h2 className="jp-LauncherBody-Title">
        {trans.__('Launch New Session')}
      </h2>
      <div className="jp-Launcher-cwd">
        <h3>{cwd}</h3>
      </div>
      <div className="jp-Launcher-searchBox">
        <FilterBox
          placeholder={trans.__('Filter')}
          updateFilter={(fn, query) => {
            updateQuery(query ?? '');
          }}
          initialQuery={''}
          useFuzzyFilter={false}
        />
      </div>
      <CollapsibleSection
        className="jp-Launcher-openByType"
        title={trans.__('Open New by Type')}
        open={true} // TODO: store this in layout/state higher up
      >
        {typeItems
          .filter(
            item =>
              !query ||
              item.label.toLowerCase().indexOf(query.toLowerCase()) !== -1
          )
          .map(item => (
            <TypeCard item={item} trans={trans} />
          ))}
      </CollapsibleSection>
      <CollapsibleSection
        className="jp-Launcher-openByKernel"
        title={trans.__('Open New by Kernel')}
        open={true} // TODO: store this in layout/state higher up
      >
        <KernelTable
          rows={props.notebookItems
            .filter(
              kernel =>
                kernel.label.toLowerCase().indexOf(query.toLowerCase()) !== -1
            )
            .map(data => {
              return {
                data: data,
                key: data.command + JSON.stringify(data.args)
              };
            })}
          blankIndicator={() => {
            return <div>{trans.__('No entries')}</div>;
          }}
          sortKey={'kernel'}
          onRowClick={event => {
            const target = event.target as HTMLElement;
            const row = target.closest('tr');
            if (!row) {
              return;
            }
            const cell = target.closest('td');
            const starButton = cell?.querySelector(`.${STAR_BUTTON_CLASS}`);
            if (starButton) {
              return (starButton as HTMLElement).click();
            }
            const element = row.querySelector(`.${KERNEL_ITEM_CLASS}`)!;
            (element as HTMLElement).click();
          }}
          columns={[
            {
              id: 'icon',
              label: trans.__('Icon'),
              renderCell: (row: IKernelItem) => (
                <div
                  className="jp-LauncherCard-icon"
                  onClick={() => row.execute()}
                >
                  {row.kernelIconUrl ? (
                    <img
                      src={row.kernelIconUrl}
                      className="jp-Launcher-kernelIcon"
                      alt={row.label}
                    />
                  ) : (
                    <div className="jp-LauncherCard-noKernelIcon">
                      {row.label[0].toUpperCase()}
                    </div>
                  )}
                </div>
              ),
              sort: (a: IKernelItem, b: IKernelItem) =>
                a.command.localeCompare(b.command)
            },
            {
              id: 'kernel',
              label: trans.__('Kernel'),
              renderCell: (row: IKernelItem) => (
                <span
                  className={KERNEL_ITEM_CLASS}
                  onClick={event => {
                    row.execute();
                    event.stopPropagation();
                  }}
                  onKeyDown={event => {
                    // TODO memoize func defs for perf
                    if (event.key === 'Enter') {
                      row.execute();
                    }
                  }}
                  tabIndex={0}
                >
                  {row.label}
                </span>
              ),
              sort: (a: IKernelItem, b: IKernelItem) =>
                a.label.localeCompare(b.label)
            },
            ...extraColumns,
            {
              id: 'last-used',
              label: trans.__('Last Used'),
              renderCell: (row: IKernelItem) => {
                return (
                  <UseSignal signal={row.refreshLastUsed}>
                    {() => {
                      return row.lastUsed ? (
                        <span title={Time.format(row.lastUsed)}>
                          {Time.formatHuman(row.lastUsed)}
                        </span>
                      ) : (
                        trans.__('Never')
                      );
                    }}
                  </UseSignal>
                );
              },
              sort: (a: IKernelItem, b: IKernelItem) => {
                if (a.lastUsed === b.lastUsed) {
                  return 0;
                }
                if (!a.lastUsed) {
                  return 1;
                }
                if (!b.lastUsed) {
                  return -1;
                }
                return a.lastUsed > b.lastUsed ? 1 : -1;
              }
            },
            {
              id: 'star',
              label: '',
              renderCell: (row: IKernelItem) => {
                const [, forceUpdate] = React.useReducer(x => x + 1, 0);

                const starred = row.starred;
                const title = starred
                  ? trans.__('Click to add this kernel to favourites')
                  : trans.__('Click to remove the kernel from favourites');
                return (
                  <button
                    className={
                      starred
                        ? `${STAR_BUTTON_CLASS} jp-mod-starred`
                        : STAR_BUTTON_CLASS
                    }
                    title={title}
                    onClick={event => {
                      row.toggleStar();
                      forceUpdate();
                      event.stopPropagation();
                    }}
                  >
                    <starIcon.react className="jp-starIcon" />
                  </button>
                );
              },
              sort: (a: IKernelItem, b: IKernelItem) =>
                Number(a.starred) - Number(b.starred)
            }
          ]}
        />
      </CollapsibleSection>
    </div>
  );
}

export namespace NewLauncher {
  export interface IOptions extends ILauncher.IOptions {
    lastUsedDatabase: ILastUsedDatabase;
    favoritesDatabase: IFavoritesDatabase;
  }
}

class Item implements IItem {
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
  starred: boolean;

  constructor(
    private _options: {
      commands: CommandRegistry;
      item: ILauncher.IItemOptions;
      cwd: string;
      lastUsedDatabase: ILastUsedDatabase;
      favoritesDatabase: IFavoritesDatabase;
    }
  ) {
    const { item, commands, lastUsedDatabase, favoritesDatabase, cwd } =
      _options;
    const args = { ...item.args, cwd };
    // base
    this.command = item.command;
    this.args = args;
    this.category = item.category;
    this.rank = item.rank;
    this.kernelIconUrl = item.kernelIconUrl;
    this.metadata = item.metadata;
    // custom
    this.iconClass = commands.iconClass(item.command, args);
    this.icon = commands.icon(item.command, args);
    this.caption = commands.caption(item.command, args);
    this.label = commands.label(item.command, args);
    this.lastUsed = lastUsedDatabase.get(item);
    this.starred = favoritesDatabase.get(item) ?? false;
  }
  get lastUsed(): Date | null {
    return this._lastUsed;
  }
  set lastUsed(value: Date | null) {
    this._lastUsed = value;
    this._setRefreshClock();
  }
  get refreshLastUsed(): ISignal<IItem, void> {
    return this._refreshLastUsed;
  }
  async execute() {
    const { item, commands, lastUsedDatabase } = this._options;
    await commands.execute(item.command, this.args);
    await lastUsedDatabase.recordAsUsedNow(item);
    this.lastUsed = lastUsedDatabase.get(item);
    this._refreshLastUsed.emit();
  }
  toggleStar() {
    const { item, favoritesDatabase } = this._options;
    const wasStarred = favoritesDatabase.get(item);
    const newState = !wasStarred;
    this.starred = newState;
    favoritesDatabase.set(item, newState);
  }
  private _setRefreshClock() {
    const value = this._lastUsed;
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
      this._setRefreshClock();
    }, interval);
  }
  private _refreshLastUsed = new Signal<Item, void>(this);
  private _refreshClock: number | null = null;
  private _lastUsed: Date | null = null;
}

export class NewLauncher extends Launcher {
  constructor(options: NewLauncher.IOptions) {
    super(options);
    this.commands = options.commands;
    this.trans = this.translator.load('jupyterlab-new-launcher');
    this._lastUsedDatabase = options.lastUsedDatabase;
    this._favoritesDatabase = options.favoritesDatabase;
  }
  private _lastUsedDatabase: ILastUsedDatabase;
  private _favoritesDatabase: IFavoritesDatabase;
  trans: TranslationBundle;

  renderCommand = (item: ILauncher.IItemOptions): IItem => {
    return new Item({
      item,
      cwd: this.cwd,
      commands: this.commands,
      lastUsedDatabase: this._lastUsedDatabase,
      favoritesDatabase: this._favoritesDatabase
    });
  };

  renderKernelCommand = (item: ILauncher.IItemOptions): IItem => {
    // note: do not use spread syntax here or object attributes will get frozen
    return this.renderCommand(item);
  };

  /**
   * Render the launcher to virtual DOM nodes.
   */
  protected render(): React.ReactElement<any> | null {
    // Bail if there is no model.
    if (!this.model) {
      return null;
    }

    const trans = this.trans;
    const items = [...this.model.items()];

    const notebookCategory = trans.__('Notebook');
    const consoleCategory = trans.__('Console');
    const kernelCategories = [notebookCategory, consoleCategory];

    // TODO: maybe better to filter out everything from default lab and re-populate the kernel categories manually to get more metadata?
    const nonKernelItems = items.filter(
      item => !item.category || !kernelCategories.includes(item.category)
    );
    const rankOverrides = {
      'terminal:create-new': 3, // TODO: replace with terminal which asks for environment choice?
      'fileeditor:create-new': 6,
      'fileeditor:create-new-markdown-file': 5
    };
    for (const item of nonKernelItems) {
      if (item.command in rankOverrides) {
        item.rank = rankOverrides[item.command as keyof typeof rankOverrides];
      }
    }
    const typeCommands = [
      {
        command: 'notebook:create-new',
        rank: 1
      },
      {
        command: 'console:create',
        rank: 4
      },
      ...nonKernelItems
    ].sort((a, b) => (a?.rank ?? 0) - (b?.rank ?? 0));

    const notebookItems = items
      .filter(item => item.category && item.category === notebookCategory)
      .map(this.renderKernelCommand);

    const typeItems: IItem[] = typeCommands.map(this.renderCommand);

    return (
      <LauncherBody
        trans={this.trans}
        cwd={this.cwd}
        typeItems={typeItems}
        notebookItems={notebookItems}
      />
    );
  }
  protected commands: CommandRegistry;
}

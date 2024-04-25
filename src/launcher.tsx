// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { CommandRegistry } from '@lumino/commands';
import { ReadonlyJSONObject } from '@lumino/coreutils';
import { Time } from '@jupyterlab/coreutils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ILauncher, Launcher } from '@jupyterlab/launcher';
import { TranslationBundle } from '@jupyterlab/translation';
import {
  classes,
  FilterBox,
  LabIcon,
  caretRightIcon,
  Table,
  UseSignal,
  MenuSvg,
  notebookIcon,
  consoleIcon
} from '@jupyterlab/ui-components';
import * as React from 'react';
import {
  ISettingsLayout,
  CommandIDs,
  IItem,
  IKernelItem,
  ILastUsedDatabase,
  IFavoritesDatabase
} from './types';
import { starIcon, fileIcon } from './icons';
import { Item } from './item';

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
        />
      </div>
      <div className="jp-LauncherCard-label">
        <p>{item.label}</p>
      </div>
    </div>
  );
}

function CollapsibleSection(
  props: React.PropsWithChildren<{
    title: string;
    className: string;
    icon: LabIcon;
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
        <props.icon.react
          tag="span"
          className="jp-CollapsibleSection-CategoryIcon"
        />
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
  switch (key) {
    // Added by nb_conda_kernels <= 2.5.0
    case 'conda_env_name':
      return 'Environment';
    case 'conda_env_path':
      return 'Environment path';
    // Will be added once https://github.com/anaconda/nb_conda_kernels/pull/262/ is released
    case 'conda_language':
      return 'Language';
    case 'conda_raw_kernel_name':
      return 'Kernel';
    case 'conda_is_base_environment':
      return 'Base?';
    case 'conda_is_currently_running':
      return 'Running?';
  }
  return key[0].toUpperCase() + key.substring(1);
}

function LauncherBody(props: {
  trans: TranslationBundle;
  cwd: string;
  typeItems: IItem[];
  notebookItems: IKernelItem[];
  consoleItems: IKernelItem[];
  otherItems: IItem[];
  commands: CommandRegistry;
  settings: ISettingRegistry.ISettings;
}): React.ReactElement {
  const { trans, cwd, typeItems, otherItems } = props;
  const [query, updateQuery] = React.useState<string>('');

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

  return (
    <div className="jp-LauncherBody">
      <div className="jp-NewLauncher-TopBar">
        <div className="jp-Launcher-cwd">
          <h3>
            {trans.__('Current folder:')} <code>{cwd ? cwd : '/'}</code>
          </h3>
        </div>
        <div className="jp-NewLauncher-OtherItems">
          {otherItems.map(item => (
            <TypeCard item={item} trans={trans} />
          ))}
        </div>
      </div>
      <div className="jp-Launcher-searchBox">
        <FilterBox
          placeholder={trans.__('Filter')}
          updateFilter={(_, query) => {
            updateQuery(query ?? '');
          }}
          initialQuery={''}
          useFuzzyFilter={false}
        />
      </div>
      <CollapsibleSection
        className="jp-Launcher-openByType"
        title={trans.__('Create Empty')}
        icon={fileIcon}
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
        title={trans.__('Launch Notebook')}
        icon={notebookIcon}
        open={true} // TODO: store this in layout/state higher up
      >
        <KernelTable
          items={props.notebookItems}
          commands={props.commands}
          showSearchBox={false}
          query={query}
          settings={props.settings}
          trans={trans}
          onClick={item => item.execute()}
        />
      </CollapsibleSection>
      <CollapsibleSection
        className="jp-Launcher-openByKernel"
        title={trans.__('Launch Console')}
        icon={consoleIcon}
        open={false}
      >
        <KernelTable
          items={props.consoleItems}
          commands={props.commands}
          showSearchBox={false}
          query={query}
          settings={props.settings}
          trans={trans}
          onClick={item => item.execute()}
        />
      </CollapsibleSection>
    </div>
  );
}

export function KernelTable(props: {
  trans: TranslationBundle;
  items: IKernelItem[];
  commands: CommandRegistry;
  settings: ISettingRegistry.ISettings;
  showSearchBox: boolean;
  query: string;
  onClick: (item: IKernelItem) => void;
  hideColumns?: string[];
}) {
  const { trans } = props;
  let query: string;
  let updateQuery: (value: string) => void;
  if (props.showSearchBox) {
    const [_query, _updateQuery] = React.useState<string>('');
    query = _query;
    updateQuery = _updateQuery;
  } else {
    query = props.query;
  }

  // Hoisted to avoid "Rendered fewer hooks than expected" error on toggling the Star column
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  const metadataAvailable = new Set<string>();
  for (const item of props.items) {
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
          if (typeof value === 'string') {
            return value;
          }
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

  const availableColumns: Table.IColumn<IKernelItem>[] = [
    {
      id: 'icon',
      label: trans.__('Icon'),
      renderCell: (row: IKernelItem) => (
        <div
          className="jp-LauncherCard-icon"
          onClick={() => props.onClick(row)}
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
            props.onClick(row);
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
      sort: (a: IKernelItem, b: IKernelItem) => a.label.localeCompare(b.label)
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
  ];
  const forceHiddenColumns = props.hideColumns ?? [];
  const columns = availableColumns.filter(
    column => !forceHiddenColumns.includes(column.id)
  );

  const [hiddenColumns, setHiddenColumns] = React.useState<
    ISettingsLayout['hiddenColumns']
  >(
    (props.settings.composite
      .hiddenColumns as ISettingsLayout['hiddenColumns']) ?? {}
  );
  const initialColumnOrder = columns.map(c => c.id);
  const [columnOrder, setColumnOrder] = React.useState<
    ISettingsLayout['columnOrder']
  >(
    (props.settings.composite.columnOrder as ISettingsLayout['columnOrder']) ??
      initialColumnOrder
  );
  const KernelItemTable = Table<IKernelItem>;

  const onSettings = () => {
    const newHiddenColumns =
      (props.settings.composite
        .hiddenColumns as ISettingsLayout['hiddenColumns']) ?? {};
    if (hiddenColumns !== newHiddenColumns) {
      setHiddenColumns(newHiddenColumns);
    }
    const newColumnOrder =
      (props.settings.composite
        .columnOrder as ISettingsLayout['columnOrder']) ?? initialColumnOrder;
    if (columnOrder !== newColumnOrder) {
      setColumnOrder(newColumnOrder);
    }
  };

  React.useEffect(() => {
    props.settings.changed.connect(onSettings);
    return () => {
      props.settings.changed.disconnect(onSettings);
    };
  });

  return (
    <div className="jp-NewLauncher-table">
      {props.showSearchBox ? (
        <div className="jp-Launcher-searchBox">
          <FilterBox
            placeholder={trans.__('Filter')}
            updateFilter={(_, query) => {
              updateQuery(query ?? '');
            }}
            initialQuery={''}
            useFuzzyFilter={false}
          />
        </div>
      ) : null}
      <div
        className="jp-NewLauncher-table-scroller"
        onContextMenu={(event: React.MouseEvent) => {
          event.preventDefault();
          const contextMenu = new MenuSvg({ commands: props.commands });
          const columnsSubMenu = new MenuSvg({ commands: props.commands });
          for (const column of columns) {
            columnsSubMenu.addItem({
              command: CommandIDs.toggleColumn,
              args: { id: column.id, label: column.label }
            });
          }
          columnsSubMenu.title.label = trans.__('Visible Columns');
          contextMenu.addItem({
            type: 'submenu',
            submenu: columnsSubMenu
          });
          const id = (
            (event.target as HTMLElement).closest('th[data-id]') as HTMLElement
          )?.dataset['id'];
          if (id) {
            contextMenu.addItem({
              command: CommandIDs.moveColumn,
              args: { direction: 'left', order: columnOrder, id }
            });
            contextMenu.addItem({
              command: CommandIDs.moveColumn,
              args: { direction: 'right', order: columnOrder, id }
            });
          }
          contextMenu.open(event.clientX, event.clientY);
        }}
      >
        <KernelItemTable
          rows={props.items
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
          columns={columns
            .filter(column => !hiddenColumns[column.id])
            .map(column => {
              return {
                ...column,
                rank: columnOrder.indexOf(column.id) ?? 10
              };
            })
            .sort((a, b) => {
              return a.rank - b.rank;
            })}
        />
      </div>
    </div>
  );
}

export namespace NewLauncher {
  export interface IOptions extends ILauncher.IOptions {
    lastUsedDatabase: ILastUsedDatabase;
    favoritesDatabase: IFavoritesDatabase;
    settings: ISettingRegistry.ISettings;
  }
}

export class NewLauncher extends Launcher {
  constructor(options: NewLauncher.IOptions) {
    super(options);
    this.commands = options.commands;
    this.trans = this.translator.load('jupyterlab-new-launcher');
    this._lastUsedDatabase = options.lastUsedDatabase;
    this._favoritesDatabase = options.favoritesDatabase;
    this._settings = options.settings;
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

    const otherCommands = ['inspector:open'];

    const otherItems = items
      .filter(item => otherCommands.includes(item.command))
      .map(this.renderCommand);

    // TODO: maybe better to filter out everything from default lab and re-populate the kernel categories manually to get more metadata?
    const nonKernelItems = items.filter(
      item =>
        (!item.category || !kernelCategories.includes(item.category)) &&
        !otherCommands.includes(item.command)
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

    const consoleItems = items
      .filter(item => item.category && item.category === consoleCategory)
      .map(this.renderKernelCommand);

    // TODO: only create items once or if changed; dispose of them too
    const typeItems: IItem[] = typeCommands.map(this.renderCommand);

    return (
      <LauncherBody
        trans={this.trans}
        cwd={this.cwd}
        commands={this.commands}
        typeItems={typeItems}
        notebookItems={notebookItems}
        consoleItems={consoleItems}
        otherItems={otherItems}
        settings={this._settings}
      />
    );
  }
  protected commands: CommandRegistry;
  private _settings: ISettingRegistry.ISettings;
}

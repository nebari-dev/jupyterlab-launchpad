// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { CommandRegistry } from '@lumino/commands';
import { ReadonlyJSONObject } from '@lumino/coreutils';
import type { ISignal } from '@lumino/signaling';
import { Time } from '@jupyterlab/coreutils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { TranslationBundle } from '@jupyterlab/translation';
import { FilterBox, UseSignal, MenuSvg } from '@jupyterlab/ui-components';
import { Table } from './base-table';
import * as React from 'react';
import {
  ISettingsLayout,
  IFavoritesDatabase,
  ILastUsedDatabase,
  CommandIDs,
  IKernelItem
} from '../types';
import { starIcon } from '../icons';

const STAR_BUTTON_CLASS = 'jp-starIconButton';
const KERNEL_ITEM_CLASS = 'jp-TableKernelItem';

function columnLabelFromKey(key: string): string {
  if (key.length === 0) {
    return '(empty)';
  }
  switch (key) {
    // Added by nb_conda_kernels
    case 'conda_env_name':
      return 'Environment';
    case 'conda_env_path':
      return 'Environment path';
    // Added by nb_conda_kernels >= 2.5.1
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

function EllipsedCell(props: React.PropsWithChildren<{ title?: string }>) {
  const [innerTitle, setInnerTitle] = React.useState<string | undefined>(
    undefined
  );
  const elementRef = React.useRef<HTMLDivElement>(null);
  return (
    <div className="jp-ellipsis-wrapper" title={props.title}>
      <div
        className="jp-ellipsis"
        title={innerTitle}
        ref={elementRef}
        onMouseEnter={() => {
          if (props.title) {
            // do nothing if there is a parent title
            return;
          }
          const el = elementRef.current;
          // if the ellipsis is active, add a title so that user can see the full text on hover
          if (el && el.scrollWidth > el.clientWidth) {
            setInnerTitle(el.innerText);
          } else {
            setInnerTitle(undefined);
          }
        }}
      >
        {props.children}
      </div>
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
  showWidgetType?: boolean;
  favouritesChanged: ISignal<IFavoritesDatabase, void>;
  lastUsedChanged: ISignal<ILastUsedDatabase, void>;
}) {
  const { trans } = props;
  let query: string;
  let updateQuery: (value: string) => void;
  // Note: state cannot be defined in conditionals, or React will error out when toggling it.
  const [_query, _updateQuery] = React.useState<string>('');
  if (props.showSearchBox) {
    query = _query;
    updateQuery = _updateQuery;
  } else {
    query = props.query;
  }

  // Hoisted to avoid "Rendered fewer hooks than expected" error on toggling the Star column
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    props.favouritesChanged.connect(forceUpdate);
    return () => {
      props.favouritesChanged.disconnect(forceUpdate);
    };
  });
  React.useEffect(() => {
    props.lastUsedChanged.connect(forceUpdate);
    return () => {
      props.lastUsedChanged.disconnect(forceUpdate);
    };
  });

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
          const render = () => {
            if (!kernelMeta) {
              return '-';
            }
            const value = kernelMeta[metadataKey];
            if (typeof value === 'string') {
              return value;
            }
            return JSON.stringify(value);
          };
          return <EllipsedCell>{render()}</EllipsedCell>;
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

  if (props.showWidgetType) {
    extraColumns.push({
      id: 'widget-type',
      label: trans.__('Type'),
      renderCell: (row: IKernelItem) => {
        return row.command.split(':')[0];
      },
      sort: (a: IKernelItem, b: IKernelItem) =>
        a.command.localeCompare(b.command)
    });
  }

  const availableColumns: Table.IColumn<IKernelItem>[] = [
    {
      id: 'kernel',
      label: trans.__('Kernel'),
      renderCell: (row: IKernelItem) => (
        <EllipsedCell>
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
            <span
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
            </span>
            <span className="jp-TableKernelItem-label">{row.label}</span>
          </span>
        </EllipsedCell>
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
              return (
                <EllipsedCell
                  title={
                    row.lastUsed
                      ? Time.format(row.lastUsed)
                      : trans.__(
                          'No information about last use of this kernel is available in the layout database'
                        )
                  }
                >
                  {row.lastUsed
                    ? Time.formatHuman(row.lastUsed)
                    : trans.__('Never')}
                </EllipsedCell>
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
          ? trans.__('Click to remove the kernel from favourites')
          : trans.__('Click to add this kernel to favourites');
        return (
          <button
            className={
              starred
                ? `${STAR_BUTTON_CLASS} jp-mod-starred`
                : STAR_BUTTON_CLASS
            }
            title={title}
            onClick={async event => {
              event.stopPropagation();
              await row.toggleStar();
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
            placeholder={trans.__('Filter kernels')}
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
          contextMenu.addClass('jp-NewLauncher-contextMenu');
          const columnsSubMenu = new MenuSvg({ commands: props.commands });
          columnsSubMenu.addClass('jp-NewLauncher-contextMenu-visibleColumns');
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
            .filter(kernel => {
              const lowerCaseQuery = query.toLowerCase();
              // search in label
              if (kernel.label.toLowerCase().includes(lowerCaseQuery)) {
                return true;
              }
              // search in columns generated out of metadata
              const kernelMeta = kernel.metadata?.kernel as
                | ReadonlyJSONObject
                | undefined;
              if (!kernelMeta) {
                return;
              }
              for (const metadataKey of metadataAvailable) {
                const value = kernelMeta[metadataKey];
                if (typeof value === 'string') {
                  if (value.toLowerCase().includes(lowerCaseQuery)) {
                    return true;
                  }
                }
              }
              return false;
            })
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
            .filter(column => hiddenColumns[column.id] !== 'hidden')
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

// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { CommandRegistry } from '@lumino/commands';
import type {
  ReadonlyJSONObject,
  ReadonlyPartialJSONObject
} from '@lumino/coreutils';
import type { ISignal } from '@lumino/signaling';
import { Time } from '@jupyterlab/coreutils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { TranslationBundle } from '@jupyterlab/translation';
import {
  FilterBox,
  UseSignal,
  MenuSvg,
  searchIcon
} from '@jupyterlab/ui-components';
import { Table } from './base-table';
import { LaunchpadTooltip } from './tooltip';
import * as React from 'react';
import {
  ISettingsLayout,
  IFavoritesDatabase,
  ILastUsedDatabase,
  CommandIDs,
  IKernelItem,
  IKernelAction,
  ILaunchpadKernelTable
} from '../types';
import { starIcon } from '../icons';

const STAR_BUTTON_CLASS = 'jp-starIconButton';
const KERNEL_ITEM_CLASS = 'jp-TableKernelItem';
const COLUMN_MIN_WIDTHS: Record<string, number> = {
  star: 36,
  kernel: 130,
  nebi_version: 80,
  'widget-type': 96,
  conda_env_name: 150,
  Namespace: 140,
  pixi_environment: 130,
  nebi_workspace: 180,
  nebi_status: 56,
  nebi_state: 56,
  nebi_location: 120,
  nebi_source: 120,
  nebi_local_version: 80,
  nebi_remote_version: 80,
  actions: 116,
  'last-used': 70
};

interface IVisibleKernelAction {
  action: IKernelAction;
  args: ReadonlyPartialJSONObject;
  caption: string;
}

function columnLabelFromKey(
  key: string,
  kernelTable: ILaunchpadKernelTable
): string {
  if (key.length === 0) {
    return '(empty)';
  }
  const metadataColumn = kernelTable.getMetadataColumn(key);
  if (metadataColumn?.label) {
    return metadataColumn.label;
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

function metadataValueToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    return value
      .map(item => metadataValueToString(item))
      .filter(Boolean)
      .join(', ');
  }
  return JSON.stringify(value);
}

function renderMetadataValue(
  metadataKey: string,
  value: unknown,
  item: IKernelItem,
  metadata: ReadonlyJSONObject | undefined,
  trans: TranslationBundle,
  kernelTable: ILaunchpadKernelTable
): React.ReactNode {
  const metadataColumn = kernelTable.getMetadataColumn(metadataKey);
  const rendered = metadataColumn?.render?.({
    item,
    metadataKey,
    value,
    metadata,
    trans
  });
  if (rendered !== undefined) {
    return rendered;
  }
  const text = metadataValueToString(value);
  return text || '-';
}

function compareMetadataValues(aValue: unknown, bValue: unknown): number {
  if (aValue === bValue) {
    return 0;
  }
  if (aValue === null || aValue === undefined || aValue === '') {
    return 1;
  }
  if (bValue === null || bValue === undefined || bValue === '') {
    return -1;
  }
  if (typeof aValue === 'number' && typeof bValue === 'number') {
    return aValue - bValue;
  }
  if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
    return Number(aValue) - Number(bValue);
  }
  return metadataValueToString(aValue).localeCompare(
    metadataValueToString(bValue)
  );
}

function visibleKernelActions(
  item: IKernelItem,
  metadata: ReadonlyJSONObject | undefined,
  trans: TranslationBundle,
  kernelTable: ILaunchpadKernelTable,
  commands: CommandRegistry
): IVisibleKernelAction[] {
  const actions: IVisibleKernelAction[] = [];
  for (const action of kernelTable.getActions({ item, metadata, trans })) {
    const args = action.args?.({ item, metadata, trans }) ?? {};
    if (
      commands.hasCommand(action.command) &&
      commands.isVisible(action.command, args) &&
      commands.isEnabled(action.command, args)
    ) {
      actions.push({
        action,
        args,
        caption: commands.caption(action.command, args)
      });
    }
  }
  return actions;
}

function EllipsedCell(
  props: React.PropsWithChildren<{
    tooltip?: string;
    tooltipElementSelector?: string;
    tooltipOnOverflow?: boolean;
  }>
) {
  const elementRef = React.useRef<HTMLDivElement>(null);
  const resolveTooltip = React.useCallback(() => {
    if (!props.tooltipOnOverflow) {
      return props.tooltip;
    }
    const element = elementRef.current;
    const tooltipElement = props.tooltipElementSelector
      ? element?.querySelector<HTMLElement>(props.tooltipElementSelector)
      : element;
    if (
      tooltipElement &&
      tooltipElement.scrollWidth > tooltipElement.clientWidth
    ) {
      return props.tooltip ?? tooltipElement.innerText;
    }
    return undefined;
  }, [props.tooltip, props.tooltipElementSelector, props.tooltipOnOverflow]);

  const content = (
    <div className="jp-ellipsis" ref={elementRef}>
      {props.children}
    </div>
  );

  if (!props.tooltip && !props.tooltipOnOverflow) {
    return content;
  }

  return (
    <LaunchpadTooltip
      className="jp-ellipsis-tooltip"
      focusable={false}
      label={props.tooltip}
      resolveLabel={resolveTooltip}
    >
      {content}
    </LaunchpadTooltip>
  );
}

function KernelActionButton(props: {
  action: IKernelAction;
  args: ReadonlyPartialJSONObject;
  caption: string;
  commands: CommandRegistry;
}) {
  const { action, args, caption, commands } = props;
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  const label =
    pending && action.pendingLabel ? action.pendingLabel : action.label;
  const CompactIcon = action.compactIcon?.react;

  React.useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const ariaLabel = pending ? label : action.title ?? (caption || action.label);

  return (
    <button
      className={
        pending
          ? 'jp-KernelActionButton jp-mod-loading'
          : 'jp-KernelActionButton'
      }
      data-action={action.id}
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      onClick={async event => {
        event.stopPropagation();
        if (pending) {
          return;
        }
        if (action.pendingLabel) {
          setPending(true);
        }
        try {
          await commands.execute(action.command, args);
        } finally {
          if (action.pendingLabel && mounted.current) {
            setPending(false);
          }
        }
      }}
    >
      {pending ? (
        <span className="jp-KernelActionButton-spinner" aria-hidden="true" />
      ) : null}
      {CompactIcon ? (
        <CompactIcon
          className="jp-KernelActionButton-compactIcon"
          tag="span"
          aria-hidden="true"
        />
      ) : null}
      <span className="jp-KernelActionButton-label">{label}</span>
    </button>
  );
}

export function KernelTable(props: {
  trans: TranslationBundle;
  items: IKernelItem[];
  commands: CommandRegistry;
  settings: ISettingRegistry.ISettings;
  showSearchBox: boolean;
  searchPlaceholder?: string;
  blankMessage?: string;
  query: string;
  onClick: (item: IKernelItem) => void;
  hideColumns?: string[];
  showWidgetType?: boolean;
  favouritesChanged: ISignal<IFavoritesDatabase, void>;
  lastUsedChanged: ISignal<ILastUsedDatabase, void>;
  kernelTable: ILaunchpadKernelTable;
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
  React.useEffect(() => {
    props.kernelTable.changed.connect(forceUpdate);
    return () => {
      props.kernelTable.changed.disconnect(forceUpdate);
    };
  }, [props.kernelTable]);
  React.useEffect(() => {
    const updateCommands = () => {
      forceUpdate();
    };
    props.commands.commandChanged.connect(updateCommands);
    return () => {
      props.commands.commandChanged.disconnect(updateCommands);
    };
  }, [props.commands]);

  const metadataAvailable = new Set<string>();
  // Some registered columns render from related metadata instead of a matching
  // raw key, so seed default-visible columns before scanning row metadata.
  for (const column of props.kernelTable.getMetadataColumns()) {
    if (column.isVisibleByDefault) {
      metadataAvailable.add(column.id);
    }
  }

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
        label: columnLabelFromKey(metadataKey, props.kernelTable),
        renderCell: (item: IKernelItem) => {
          const kernelMeta = item.metadata?.kernel as
            | ReadonlyJSONObject
            | undefined;
          const value = kernelMeta ? kernelMeta[metadataKey] : undefined;
          return (
            <EllipsedCell>
              {renderMetadataValue(
                metadataKey,
                value,
                item,
                kernelMeta,
                trans,
                props.kernelTable
              )}
            </EllipsedCell>
          );
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
          return compareMetadataValues(aValue, bValue);
        },
        minWidth: COLUMN_MIN_WIDTHS[metadataKey]
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
        a.command.localeCompare(b.command),
      minWidth: COLUMN_MIN_WIDTHS['widget-type']
    });
  }

  const starColumn: Table.IColumn<IKernelItem> = {
    id: 'star',
    label: '',
    minWidth: COLUMN_MIN_WIDTHS.star,
    renderCell: (row: IKernelItem) => {
      const starred = row.starred;
      const title = starred
        ? trans.__('Click to remove the kernel from favourites')
        : trans.__('Click to add this kernel to favourites');
      return (
        <button
          className={
            starred ? `${STAR_BUTTON_CLASS} jp-mod-starred` : STAR_BUTTON_CLASS
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
  };

  const actionColumn: Table.IColumn<IKernelItem> = {
    id: 'actions',
    label: trans.__('Actions'),
    minWidth: COLUMN_MIN_WIDTHS.actions,
    renderCell: (row: IKernelItem) => {
      const metadata = row.metadata?.kernel as ReadonlyJSONObject | undefined;
      const actions = visibleKernelActions(
        row,
        metadata,
        trans,
        props.kernelTable,
        props.commands
      );

      if (actions.length === 0) {
        return null;
      }

      return (
        <div
          className={
            actions.length > 1
              ? 'jp-KernelActions jp-mod-multipleActions'
              : 'jp-KernelActions'
          }
        >
          {actions.map(({ action, args, caption }) => (
            <KernelActionButton
              key={action.id}
              action={action}
              args={args}
              caption={caption}
              commands={props.commands}
            />
          ))}
        </div>
      );
    },
    sort: () => 0
  };

  const availableColumns: Table.IColumn<IKernelItem>[] = [
    starColumn,
    {
      id: 'kernel',
      label: trans.__('Kernel'),
      minWidth: COLUMN_MIN_WIDTHS.kernel,
      renderCell: (row: IKernelItem) => {
        const metadata = row.metadata?.kernel as ReadonlyJSONObject | undefined;
        return (
          <EllipsedCell
            tooltip={row.label}
            tooltipElementSelector=".jp-TableKernelItem-label"
            tooltipOnOverflow={true}
          >
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
                  <div
                    className="jp-LauncherCard-noKernelIcon"
                    title={props.kernelTable.getIconFallbackTitle({
                      item: row,
                      metadata,
                      trans
                    })}
                  >
                    {row.label[0].toUpperCase()}
                  </div>
                )}
              </span>
              <span className="jp-TableKernelItem-label">{row.label}</span>
            </span>
          </EllipsedCell>
        );
      },
      sort: (a: IKernelItem, b: IKernelItem) => a.label.localeCompare(b.label)
    },
    ...extraColumns,
    actionColumn,
    {
      id: 'last-used',
      label: trans.__('Last used'),
      minWidth: COLUMN_MIN_WIDTHS['last-used'],
      renderCell: (row: IKernelItem) => {
        return (
          <UseSignal signal={row.refreshLastUsed}>
            {() => {
              return (
                <EllipsedCell>
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
        return a.lastUsed > b.lastUsed ? -1 : 1;
      }
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
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [hasMoreRowsBelow, setHasMoreRowsBelow] = React.useState(false);
  const [isCompactTable, setIsCompactTable] = React.useState(false);
  const KernelItemTable = Table<IKernelItem>;

  // Build the sortable rows from the active search query, matching both labels
  // and available metadata values.
  const lowerCaseQuery = query.toLowerCase();
  const tableRows = props.items
    .filter(kernel => {
      // search in label
      if (kernel.label.toLowerCase().includes(lowerCaseQuery)) {
        return true;
      }
      // search in columns generated out of metadata
      const kernelMeta = kernel.metadata?.kernel as
        | ReadonlyJSONObject
        | undefined;
      if (!kernelMeta) {
        return false;
      }
      for (const metadataKey of metadataAvailable) {
        const value = kernelMeta[metadataKey];
        const text = metadataValueToString(value);
        if (text && text.toLowerCase().includes(lowerCaseQuery)) {
          return true;
        }
      }
      return false;
    })
    .map(data => {
      return {
        data: data,
        key: data.command + JSON.stringify(data.args)
      };
    });
  const visibleColumns = columns
    .filter(column => hiddenColumns[column.id] !== 'hidden')
    .map(column => {
      const rank = columnOrder.indexOf(column.id);
      return {
        ...column,
        rank: rank === -1 ? 100 : rank
      };
    })
    .sort((a, b) => {
      return a.rank - b.rank;
    });

  // Track whether the table has hidden rows below the viewport so CSS can show
  // the bottom fade only when more content is available.
  const updateScrollState = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      setHasMoreRowsBelow(false);
      return;
    }

    const nextHasMoreRowsBelow =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1;
    setHasMoreRowsBelow(current =>
      current === nextHasMoreRowsBelow ? current : nextHasMoreRowsBelow
    );
    const nextIsCompactTable = scroller.clientWidth <= 850;
    setIsCompactTable(current =>
      current === nextIsCompactTable ? current : nextIsCompactTable
    );
  }, []);

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
  React.useEffect(() => {
    updateScrollState();
  });
  React.useEffect(() => {
    updateScrollState();
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateScrollState);
    resizeObserver?.observe(scroller);

    const table = scroller.querySelector('table');
    if (table) {
      resizeObserver?.observe(table);
    }

    window.addEventListener('resize', updateScrollState);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState]);

  return (
    <div
      className={`jp-NewLauncher-table${
        isCompactTable ? ' jp-mod-compactTable' : ''
      }`}
    >
      {props.showSearchBox ? (
        <div className="jp-Launcher-searchBox">
          <searchIcon.react
            className="jp-Launcher-searchIcon"
            tag="span"
            aria-hidden="true"
          />
          <FilterBox
            placeholder={props.searchPlaceholder ?? trans.__('Search kernels')}
            updateFilter={(_, query) => {
              updateQuery(query ?? '');
            }}
            initialQuery={''}
            showIcon={false}
            useFuzzyFilter={false}
          />
        </div>
      ) : null}
      <div
        className={`jp-NewLauncher-table-scrollerWrapper${
          hasMoreRowsBelow ? ' jp-mod-hasMoreBelow' : ''
        }`}
      >
        <div
          ref={scrollerRef}
          className="jp-NewLauncher-table-scroller"
          onScroll={updateScrollState}
          onContextMenu={(event: React.MouseEvent) => {
            event.preventDefault();
            const contextMenu = new MenuSvg({ commands: props.commands });
            contextMenu.addClass('jp-NewLauncher-contextMenu');
            const columnsSubMenu = new MenuSvg({ commands: props.commands });
            columnsSubMenu.addClass(
              'jp-NewLauncher-contextMenu-visibleColumns'
            );
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
              (event.target as HTMLElement).closest(
                'th[data-id]'
              ) as HTMLElement
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
            rows={tableRows}
            blankIndicator={() => {
              return <div>{props.blankMessage ?? trans.__('No entries')}</div>;
            }}
            sortLabel={(label, nextDirection) =>
              trans.__(
                'Sort %1 %2',
                label,
                nextDirection === 'ascending'
                  ? trans.__('ascending')
                  : trans.__('descending')
              )
            }
            sortKey="kernel"
            onRowClick={event => {
              const target = event.target as HTMLElement;
              const element = target.closest('tr');
              if (!element) {
                return;
              }
              const cell = target.closest('td');
              const starButton = cell?.querySelector(`.${STAR_BUTTON_CLASS}`);
              if (starButton) {
                return (starButton as HTMLElement).click();
              }
              const row = tableRows.find(
                row => row.key === element.dataset.key
              );
              if (row) {
                props.onClick(row.data);
              }
            }}
            columns={visibleColumns}
          />
        </div>
      </div>
    </div>
  );
}

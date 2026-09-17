/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import React, { ReactElement, ReactNode, useState } from 'react';
import { moveDownIcon, moveUpIcon } from '@jupyterlab/ui-components';
import { arrowUpDownIcon } from '../icons';

export const TABLE_CLASS = 'jp-sortable-table';
const SORT_ICON_BUTTON_WIDTH = 24;
const SORT_ICON_GAP = 8;

/**
 * A namespace for Table.
 */
export namespace Table {
  /**
   * The state which will be restored from layout tracker.
   */
  export interface ISortState {
    sortKey?: string | null;
    sortDirection: -1 | 1;
  }
  /**
   * The initialization options for the table.
   */
  export interface IOptions<T> extends Partial<ISortState> {
    rows: IRow<T>[];
    columns: IColumn<T>[];
    onRowClick?: React.MouseEventHandler<HTMLTableRowElement>;
    blankIndicator: () => ReactNode;
    sortLabel?: (
      label: string,
      nextDirection: 'ascending' | 'descending'
    ) => string;
  }
  /**
   * Table row with data to display.
   */
  export interface IRow<T> {
    data: T;
    key: string;
  }
  /**
   * Column definition.
   */
  export interface IColumn<T> {
    id: string;
    label: string;
    renderCell(data: T): ReactNode;
    sort(a: T, b: T): number | undefined;
    isAvailable?(): boolean;
    isHidden?: boolean;
    minWidth?: number;
  }
}

/**
 * Sortable table component for small datasets.
 *
 * For large datasets use `DataGrid` from `@lumino/datagrid`.
 */
export function Table<T>(props: Table.IOptions<T>) {
  const [sortState, setSortState] = useState<Table.ISortState>({
    sortKey: props.sortKey,
    sortDirection: props.sortDirection || 1
  });

  const sort = (key: string) => {
    if (key === sortState.sortKey) {
      setSortState({
        sortKey: key,
        sortDirection: (sortState.sortDirection * -1) as -1 | 1
      });
    } else {
      setSortState({ sortKey: key, sortDirection: 1 });
    }
  };

  let rows = props.rows;
  const sortedColumn = props.columns.filter(
    column => column.id === sortState.sortKey
  )[0];

  if (sortedColumn) {
    const sorter = sortedColumn.sort.bind(sortedColumn);
    rows = props.rows.sort(
      (a, b) => (sorter(a.data, b.data) ?? 0) * sortState.sortDirection
    );
  }

  const visibleColumns = props.columns.filter(
    column =>
      (column.isAvailable ? column.isAvailable() : true) && !column.isHidden
  );

  const [isColumnResized, setColumnResized] = React.useState<
    Record<string, boolean>
  >({});

  const elements = rows.map(row => {
    const cells = visibleColumns.map(column => (
      <td
        key={column.id + '-' + row.key}
        className={isColumnResized[column.id] ? 'jp-mod-col-resized' : ''}
        data-id={column.id}
      >
        {column.renderCell(row.data)}
      </td>
    ));

    return (
      <tr
        key={row.key}
        data-key={row.key}
        onClick={props.onRowClick}
        className={'jp-sortable-table-tr'}
      >
        {cells}
      </tr>
    );
  });

  if (elements.length === 0) {
    elements.push(
      <tr key="blank" className="jp-sortable-table-tr jp-mod-empty">
        <td colSpan={Math.max(visibleColumns.length, 1)}>
          {props.blankIndicator()}
        </td>
      </tr>
    );
  }

  const columnsHeaders = visibleColumns.map(column => (
    <SortableTH
      label={column.label}
      id={column.id}
      state={sortState}
      key={column.id}
      onSort={() => {
        sort(column.id);
      }}
      onResize={() => {
        setColumnResized({
          ...isColumnResized,
          [column.id]: true
        });
      }}
      minWidth={column.minWidth}
      sortLabel={props.sortLabel}
    />
  ));

  return (
    <table className={TABLE_CLASS}>
      <thead>
        <tr className={'jp-sortable-table-tr'}>{columnsHeaders}</tr>
      </thead>
      <tbody>{elements}</tbody>
    </table>
  );
}

function SortableTH(props: {
  id: string;
  label: string;
  state: Table.ISortState;
  onSort: () => void;
  onResize: () => void;
  minWidth?: number;
  sortLabel?: (
    label: string,
    nextDirection: 'ascending' | 'descending'
  ) => string;
}): ReactElement {
  const isSortKey = props.id === props.state.sortKey;
  const sortDirection = isSortKey
    ? props.state.sortDirection === 1
      ? 'ascending'
      : 'descending'
    : 'none';
  const sortLabel = props.label || props.id;
  const nextSortDirection =
    isSortKey && props.state.sortDirection === 1 ? 'descending' : 'ascending';
  const sortButtonLabel =
    props.sortLabel?.(sortLabel, nextSortDirection) ??
    `Sort ${sortLabel} ${nextSortDirection}`;
  const [columnWidth, setColumnWidth] = React.useState<number | null>(null);

  const thRef = React.useRef<HTMLTableCellElement | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const labelRef = React.useRef<HTMLLabelElement | null>(null);
  const [resizeOngoing, setResizeOngoing] = React.useState<boolean>(false);
  const [isSortIconOnly, setSortIconOnly] = React.useState<boolean>(false);
  const [thLeft, setThLeft] = useState<number | null>(null);

  requestAnimationFrame(() => {
    if (thRef.current) {
      const { left } = thRef.current.getBoundingClientRect();
      setThLeft(left);
    }
  });

  React.useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (resizeOngoing) {
        let left: number;
        if (thLeft === null) {
          if (!thRef.current) {
            throw Error('Cannot resize: no reference to the current table');
          }
          console.warn('Resize cache for column was not available');
          left = thRef.current.getBoundingClientRect().left;
        } else {
          left = thLeft;
        }
        setColumnWidth(event.clientX - left);
        props.onResize();
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (resizeOngoing) {
        document.body.classList.remove(RESIZE_ACTIVE);
        setResizeOngoing(false);
        // do not sort when finishing resize
        event.stopImmediatePropagation();
      }
    };
    document.body.addEventListener('pointermove', onPointerMove);
    document.body.addEventListener('pointerup', onPointerUp);
    return () => {
      document.body.removeEventListener('pointermove', onPointerMove);
      document.body.removeEventListener('pointerup', onPointerUp);
    };
  });

  const updateSortHeaderLayout = React.useCallback(() => {
    const wrapper = wrapperRef.current;
    const label = labelRef.current;
    if (!wrapper || !label || !props.label || isSortKey) {
      setSortIconOnly(false);
      return;
    }

    const requiredWidth =
      label.scrollWidth + SORT_ICON_GAP + SORT_ICON_BUTTON_WIDTH;
    const nextIsSortIconOnly = requiredWidth > wrapper.clientWidth;
    setSortIconOnly(current =>
      current === nextIsSortIconOnly ? current : nextIsSortIconOnly
    );
  }, [isSortKey, props.label]);

  React.useEffect(() => {
    updateSortHeaderLayout();
    const wrapper = wrapperRef.current;
    const th = thRef.current;
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateSortHeaderLayout);

    if (wrapper) {
      resizeObserver?.observe(wrapper);
    }
    if (th) {
      resizeObserver?.observe(th);
    }
    window.addEventListener('resize', updateSortHeaderLayout);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateSortHeaderLayout);
    };
  }, [updateSortHeaderLayout]);

  const classes: string[] = [];
  if (isSortKey) {
    classes.push('jp-sorted-header');
  }
  if (!props.label) {
    classes.push('jp-mod-empty-label');
  }
  if (isSortIconOnly) {
    classes.push('jp-mod-sort-icon-only');
  }
  if (resizeOngoing) {
    classes.push('jp-header-resizing');
  }
  const RESIZE_HANDLE = 'jp-sortable-table-resize-handle';
  const RESIZE_ACTIVE = 'jp-mod-resize-table';

  return (
    <th
      key={props.id}
      ref={thRef}
      onClick={() => props.onSort()}
      className={classes.join(' ')}
      data-id={props.id}
      aria-sort={
        isSortKey
          ? props.state.sortDirection === 1
            ? 'ascending'
            : 'descending'
          : 'none'
      }
      style={{
        minWidth: props.minWidth ? `${props.minWidth}px` : undefined,
        width:
          columnWidth !== null
            ? `${Math.max(props.minWidth ?? 50, columnWidth)}px`
            : undefined
      }}
      onPointerDown={event => {
        if (
          event.target instanceof HTMLElement &&
          event.target.className === RESIZE_HANDLE
        ) {
          document.body.classList.add(RESIZE_ACTIVE);
          setResizeOngoing(true);
        }
      }}
    >
      <div className="jp-sortable-table-th-wrapper" ref={wrapperRef}>
        <label ref={labelRef}>{props.label}</label>
        <button
          type="button"
          className="jp-sort-iconButton"
          title={sortButtonLabel}
          aria-label={sortButtonLabel}
          data-sort-direction={sortDirection}
          onClick={event => {
            event.stopPropagation();
            props.onSort();
          }}
        >
          <SortIndicator direction={sortDirection} />
        </button>
      </div>
      <div className={RESIZE_HANDLE}></div>
    </th>
  );
}

function SortIndicator(props: {
  direction: 'none' | 'ascending' | 'descending';
}): ReactElement {
  if (props.direction === 'ascending') {
    return <moveUpIcon.react className="jp-sort-icon" tag="span" />;
  }

  if (props.direction === 'descending') {
    return <moveDownIcon.react className="jp-sort-icon" tag="span" />;
  }

  return <arrowUpDownIcon.react className="jp-sort-icon" tag="span" />;
}

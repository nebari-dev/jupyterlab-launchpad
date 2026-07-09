// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.

import { ReadonlyJSONObject, Token } from '@lumino/coreutils';

/**
 * Data-driven column descriptors.
 *
 * The launcher table already turns every kernel-metadata key into a column
 * (see `columnLabelFromKey` in `components/table.tsx`). Today the *label*,
 * *render style* and *hidden-by-default* behaviour of those columns live in a
 * hard-coded `switch` inside the launcher, so every metadata provider
 * (`nb_conda_kernels`, `nb_nebi_kernels`, ...) has to patch launcher core to
 * make its columns look right.
 *
 * A column *descriptor* lets a provider describe its own columns as **data**,
 * emitted alongside the values it already produces. The launcher stays
 * domain-agnostic: it renders whatever descriptors it is handed.
 *
 * There are two ways a descriptor can reach the launcher, neither of which
 * requires shipping another compiled labextension:
 *
 * 1. **In the kernelspec metadata** under the reserved
 *    {@link COLUMN_DESCRIPTORS_KEY}. This is the "config extends the app"
 *    route: a server-side `KernelSpecManager` selected via
 *    `c.ServerApp.kernel_spec_manager_class` (a dotted import path, exactly
 *    like a Ragna assistant or a JupyterHub authenticator) emits the
 *    descriptors as part of the metadata it already stamps onto each kernel.
 *
 * 2. **Programmatically** through {@link ILauncherColumnRegistry}, for the
 *    rare case where an in-process JupyterLab plugin wants to contribute a
 *    column without a server round-trip.
 */

/**
 * Reserved kernel-metadata key carrying a `{ [columnKey]: IColumnDescriptor }`
 * map. Excluded from becoming a column itself.
 */
export const COLUMN_DESCRIPTORS_KEY = '__launchpad_columns__';

/**
 * How the launcher should render a column's cell.
 */
export type ColumnRenderType =
  | 'text'
  | 'badge'
  | 'version'
  | 'boolean'
  | 'action';

/**
 * A single badge style, keyed by the (stringified) cell value.
 */
export interface IBadgeStyle {
  /** Text shown in the badge (defaults to the raw value). */
  label?: string;
  /**
   * Semantic tone. Maps to a CSS class `jp-Launchpad-badge-<tone>` so themes
   * stay in control of the actual colour. An icon is paired with the tone so
   * information is never conveyed by colour alone (accessibility).
   */
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

/**
 * A row action, dispatched as a JupyterLab command with the row's kernel
 * metadata passed as arguments. The command itself is owned by whoever
 * contributed the descriptor (e.g. a `nb_nebi_kernels` plugin registering
 * `launchpad:nebi-pull`), so the launcher never learns any provider verbs.
 */
export interface IColumnAction {
  /** Command id to execute. */
  commandId: string;
  /** Button label. */
  label?: string;
}

/**
 * Declarative description of one launcher column.
 */
export interface IColumnDescriptor {
  /** Metadata key this descriptor decorates. */
  key: string;
  /** Human-readable column header. */
  label?: string;
  /** Cell render strategy. Defaults to `text`. */
  renderType?: ColumnRenderType;
  /** Hide from the table by default (user can still reveal via settings). */
  hidden?: boolean;
  /** Longer description, surfaced as a header tooltip. */
  description?: string;
  /** For `renderType: 'badge'`, value -> style. */
  badges?: { [value: string]: IBadgeStyle };
  /** For `renderType: 'action'`, the command to run. */
  action?: IColumnAction;
  /** Metadata key to read a per-row tooltip from. */
  tooltipKey?: string;
}

/**
 * Collect descriptors emitted in kernel metadata across the given items.
 * First writer wins, so providers should keep a stable descriptor per key.
 */
export function collectColumnDescriptors(
  items: ReadonlyArray<{ metadata?: ReadonlyJSONObject }>
): Map<string, IColumnDescriptor> {
  const descriptors = new Map<string, IColumnDescriptor>();
  for (const item of items) {
    const kernelMeta = item.metadata?.kernel as ReadonlyJSONObject | undefined;
    const raw = kernelMeta?.[COLUMN_DESCRIPTORS_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    for (const [key, value] of Object.entries(raw as ReadonlyJSONObject)) {
      if (!value || typeof value !== 'object' || descriptors.has(key)) {
        continue;
      }
      descriptors.set(key, { key, ...(value as object) } as IColumnDescriptor);
    }
  }
  return descriptors;
}

/**
 * Optional in-process registry, for plugins that would rather register a
 * column descriptor directly than round-trip through kernel metadata.
 */
export interface ILauncherColumnRegistry {
  registerDescriptor(descriptor: IColumnDescriptor): void;
  descriptors(): ReadonlyArray<IColumnDescriptor>;
}

export const ILauncherColumnRegistry = new Token<ILauncherColumnRegistry>(
  'jupyterlab-launchpad:ILauncherColumnRegistry',
  'A registry of data-driven launcher column descriptors.'
);

/**
 * Default {@link ILauncherColumnRegistry} implementation.
 */
export class LauncherColumnRegistry implements ILauncherColumnRegistry {
  registerDescriptor(descriptor: IColumnDescriptor): void {
    this._descriptors.set(descriptor.key, descriptor);
  }
  descriptors(): ReadonlyArray<IColumnDescriptor> {
    return [...this._descriptors.values()];
  }
  private _descriptors = new Map<string, IColumnDescriptor>();
}

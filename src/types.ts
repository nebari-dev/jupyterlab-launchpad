// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.

/**
 * The command IDs used by the launcher plugin.
 */
export namespace CommandIDs {
  export const create = 'launcher:create';
  export const moveColumn = 'new-launcher:table-move-column';
  export const toggleColumn = 'new-launcher:table-toggle-column';
}

export interface ISettingsLayout {
  hiddenColumns: Record<string, boolean>;
  columnOrder: string[];
}

// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import { ReadonlyJSONObject } from '@lumino/coreutils';
import * as React from 'react';

const NEBI_STATE_LABELS: Record<string, string> = {
  'remote-not-pulled': 'Remote (not pulled)',
  'local-not-installed': 'Local (not installed)',
  'local-missing-deps': 'Local (missing deps)',
  outdated: 'Outdated',
  ready: 'Ready'
};

const NEBI_STATE_SORT_RANK: Record<string, number> = {
  'remote-not-pulled': 0,
  'local-not-installed': 1,
  'local-missing-deps': 2,
  outdated: 3,
  ready: 4
};

const NEBI_METADATA_LABELS: Record<string, string> = {
  nebi_state: 'State',
  nebi_missing_dependencies: 'Missing dependencies',
  nebi_local_version: 'Local version',
  nebi_remote_version: 'Remote version',
  nebi_outdated: 'Outdated?',
  nebi_not_ready_reason: 'Not ready reason',
  nebi_logo_reason: 'Logo reason',
  nebi_discovery_hash: 'Discovery hash',
  nebi_discovered_at: 'Discovered at',
  nebi_workspace: 'Workspace',
  nebi_workspace_path: 'Workspace path',
  nebi_source: 'Source'
};

export function nebiColumnLabelFromKey(key: string): string | undefined {
  return NEBI_METADATA_LABELS[key];
}

export function renderNebiMetadataValue(
  metadataKey: string,
  value: unknown
): React.ReactNode | undefined {
  if (metadataKey === 'nebi_state') {
    const state = typeof value === 'string' ? value : '';
    const label = NEBI_STATE_LABELS[state] ?? state;
    return state ? (
      <span className={`jp-NebiStateBadge jp-NebiState-${state}`}>{label}</span>
    ) : (
      '-'
    );
  }
  if (metadataKey === 'nebi_outdated' && typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return undefined;
}

export function compareNebiMetadataValues(
  metadataKey: string,
  aValue: unknown,
  bValue: unknown
): number | undefined {
  if (
    metadataKey === 'nebi_state' &&
    typeof aValue === 'string' &&
    typeof bValue === 'string'
  ) {
    return (
      (NEBI_STATE_SORT_RANK[aValue] ?? Number.MAX_SAFE_INTEGER) -
      (NEBI_STATE_SORT_RANK[bValue] ?? Number.MAX_SAFE_INTEGER)
    );
  }
  return undefined;
}

export function nebiLogoReason(
  kernelMeta: ReadonlyJSONObject | undefined
): string | undefined {
  const reason = kernelMeta?.['nebi_logo_reason'];
  if (typeof reason === 'string' && reason.length > 0) {
    return reason;
  }
  return undefined;
}

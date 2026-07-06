// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import { JupyterFrontEndPlugin } from '@jupyterlab/application';
import {
  checkIcon,
  downloadIcon,
  errorIcon,
  refreshIcon
} from '@jupyterlab/ui-components';
import type { LabIcon } from '@jupyterlab/ui-components';
import type { ReadonlyJSONObject } from '@lumino/coreutils';
import * as React from 'react';
import {
  CommandIDs,
  IKernelAction,
  IKernelActionOptions,
  IKernelMetadataColumn,
  ILaunchpadKernelTable
} from '../types';

const NEBI_STATUS_LABELS: Record<string, string> = {
  'not-pulled': 'Not pulled',
  'not-installed': 'Not installed',
  'missing-deps': 'Missing deps',
  outdated: 'Outdated',
  ready: 'Ready'
};

const NEBI_STATUS_CLASSES: Record<string, string> = {
  'not-pulled': 'jp-NebiStatus-not-pulled',
  'not-installed': 'jp-NebiStatus-not-installed',
  'missing-deps': 'jp-NebiStatus-missing-deps',
  outdated: 'jp-NebiStatus-outdated',
  ready: 'jp-NebiStatus-ready'
};

const NEBI_STATUS_ICONS: Record<string, LabIcon> = {
  'not-pulled': downloadIcon,
  'not-installed': errorIcon,
  'missing-deps': errorIcon,
  outdated: refreshIcon,
  ready: checkIcon
};

const NEBI_LOCATION_LABELS: Record<string, string> = {
  local: 'Local',
  remote: 'Remote'
};

const NEBI_REDUNDANT_REASONS = new Set([
  'environment-not-installed',
  'kernel-not-installed',
  'local-version-behind-remote',
  'missing-dependencies',
  'workspace-not-pulled'
]);

const NEBI_METADATA_LABELS: Record<string, string> = {
  nebi_state: 'Status',
  nebi_status: 'Status',
  nebi_location: 'Location',
  nebi_missing_dependencies: 'Missing dependencies',
  nebi_local_version: 'Local version',
  nebi_remote_version: 'Remote version',
  nebi_outdated: 'Outdated?',
  nebi_not_ready_reason: 'Not ready reason',
  nebi_logo_reason: 'Logo reason',
  nebi_discovery_hash: 'Discovery hash',
  nebi_discovered_at: 'Discovered at',
  nebi_kernel_spec: 'Kernel spec',
  nebi_kernel_state: 'Kernel state',
  nebi_workspace: 'Workspace',
  nebi_workspace_path: 'Workspace path',
  nebi_source: 'Location',
  pixi_environment: 'Environment'
};

function normalizeStatus(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  switch (value) {
    case 'remote-not-pulled':
      return 'not-pulled';
    case 'local-not-installed':
      return 'not-installed';
    case 'local-missing-deps':
      return 'missing-deps';
    default:
      return value;
  }
}

function statusFromMetadata(
  metadata: ReadonlyJSONObject | undefined,
  fallback?: unknown
): string | undefined {
  return (
    normalizeStatus(metadata?.['nebi_status']) ?? normalizeStatus(fallback)
  );
}

function locationFromMetadata(
  metadata: ReadonlyJSONObject | undefined,
  fallback?: unknown
): string | undefined {
  const explicitLocation = metadata?.['nebi_location'];
  if (typeof explicitLocation === 'string' && explicitLocation.length > 0) {
    return explicitLocation;
  }

  const source = metadata?.['nebi_source'];
  if (typeof source === 'string' && source.length > 0) {
    return source;
  }

  if (typeof fallback !== 'string') {
    return undefined;
  }

  if (fallback.startsWith('remote-')) {
    return 'remote';
  }
  if (
    fallback.startsWith('local-') ||
    fallback === 'ready' ||
    fallback === 'outdated'
  ) {
    return 'local';
  }

  return undefined;
}

function renderNebiIndicator(
  label: string,
  className: string,
  icon: LabIcon
): React.ReactNode {
  return (
    <span className={`jp-NebiIndicator ${className}`}>
      <icon.react
        className="jp-NebiIndicator-icon"
        tag="span"
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}

function renderStatus(value: string): React.ReactNode {
  const label = NEBI_STATUS_LABELS[value] ?? value;
  const className = NEBI_STATUS_CLASSES[value] ?? 'jp-NebiStatus-unknown';
  const icon = NEBI_STATUS_ICONS[value] ?? errorIcon;
  return renderNebiIndicator(label, className, icon);
}

function renderLocation(value: string): React.ReactNode {
  const label = NEBI_LOCATION_LABELS[value] ?? value;
  return <span className="jp-NebiLocation">{label}</span>;
}

function missingDependenciesTitle(
  metadata: ReadonlyJSONObject | undefined
): string | undefined {
  const value = metadata?.['nebi_missing_dependencies'];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const dependencies = value.filter(
    item => typeof item === 'string' && item.length > 0
  );
  if (dependencies.length === 0) {
    return undefined;
  }

  return `Missing: ${dependencies.join(', ')}`;
}

function isLatestVersion(
  id: string,
  value: unknown,
  metadata: ReadonlyJSONObject | undefined
): boolean {
  if (typeof value !== 'string' || value.length === 0 || !metadata) {
    return false;
  }

  const localVersion = metadata['nebi_local_version'];
  const remoteVersion = metadata['nebi_remote_version'];
  const outdated = metadata['nebi_outdated'];

  if (id === 'nebi_remote_version') {
    return (
      value === remoteVersion &&
      (outdated === true || typeof localVersion !== 'string')
    );
  }

  if (id === 'nebi_local_version') {
    return (
      value === localVersion &&
      outdated === false &&
      (typeof remoteVersion !== 'string' || localVersion === remoteVersion)
    );
  }

  return false;
}

function nebiStatusTitle(
  value: unknown,
  metadata: ReadonlyJSONObject | undefined
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  const missingDependencies = missingDependenciesTitle(metadata);
  if (missingDependencies) {
    return missingDependencies;
  }

  const reason = metadata?.['nebi_not_ready_reason'];
  if (typeof reason === 'string' && reason.length > 0) {
    return NEBI_REDUNDANT_REASONS.has(reason) ? '' : reason;
  }

  return '';
}

const nebiColumns: IKernelMetadataColumn[] = Object.entries(
  NEBI_METADATA_LABELS
).map(([id, label]) => ({
  id,
  label,
  title: ({ value, metadata }) => {
    if (id === 'nebi_state' || id === 'nebi_status') {
      return nebiStatusTitle(statusFromMetadata(metadata, value), metadata);
    }

    if (id === 'nebi_missing_dependencies') {
      return missingDependenciesTitle(metadata);
    }

    return undefined;
  },
  render: ({ value, metadata }) => {
    if (id === 'nebi_state' || id === 'nebi_status') {
      const status = statusFromMetadata(metadata, value);
      if (!status) {
        return '-';
      }

      return renderStatus(status);
    }

    if (id === 'nebi_source' || id === 'nebi_location') {
      const location = locationFromMetadata(metadata, value);
      if (!location) {
        return '-';
      }

      return renderLocation(location);
    }

    if (
      (id === 'nebi_local_version' || id === 'nebi_remote_version') &&
      isLatestVersion(id, value, metadata)
    ) {
      const version = value as string;
      return (
        <span
          className="jp-NebiVersion jp-mod-latest"
          title="Latest version"
          aria-label={`${version} latest version`}
        >
          <span className="jp-NebiVersionLatest">latest</span>
          <span>{version}</span>
        </span>
      );
    }

    if (
      (id === 'nebi_local_version' || id === 'nebi_remote_version') &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      return (
        <span className="jp-NebiVersion">
          <span>{value}</span>
        </span>
      );
    }

    if (id === 'nebi_missing_dependencies' && Array.isArray(value)) {
      if (value.length === 0) {
        return '-';
      }

      return value
        .filter(item => typeof item === 'string' && item.length > 0)
        .join(', ');
    }

    if (id === 'nebi_outdated' && typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    return undefined;
  }
}));

function actionArgs({ metadata }: IKernelActionOptions) {
  return {
    workspace: metadata?.['nebi_workspace'],
    workspacePath: metadata?.['nebi_workspace_path'],
    remoteVersion: metadata?.['nebi_remote_version'],
    environment: metadata?.['pixi_environment'],
    missingDependencies: metadata?.['nebi_missing_dependencies']
  };
}

const nebiActions: IKernelAction[] = [
  {
    id: 'nebi-pull',
    label: 'Pull',
    command: CommandIDs.nebiPull,
    title: 'Pull this Nebi workspace',
    rank: 0,
    isAvailable: options =>
      statusFromMetadata(options.metadata, options.metadata?.['nebi_state']) ===
        'not-pulled' &&
      typeof options.metadata?.['nebi_workspace'] === 'string' &&
      options.metadata['nebi_workspace'].length > 0,
    args: actionArgs
  },
  {
    id: 'nebi-install-dependencies',
    label: 'Install deps',
    command: CommandIDs.nebiInstallDependencies,
    title: 'Install missing dependencies',
    rank: 1,
    isAvailable: options =>
      statusFromMetadata(options.metadata, options.metadata?.['nebi_state']) ===
        'missing-deps' &&
      typeof options.metadata?.['nebi_workspace_path'] === 'string' &&
      options.metadata['nebi_workspace_path'].length > 0,
    args: actionArgs
  },
  {
    id: 'nebi-edit-config',
    label: 'Edit config',
    command: CommandIDs.nebiEditConfig,
    title: 'Edit Nebi workspace configuration',
    rank: 2,
    isAvailable: options =>
      typeof options.metadata?.['nebi_workspace_path'] === 'string' &&
      options.metadata['nebi_workspace_path'].length > 0,
    args: actionArgs
  }
];

export const nebiKernelTablePlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-launchpad:nebi',
  description: 'Nebi kernel metadata presentation for launchpad',
  autoStart: true,
  requires: [ILaunchpadKernelTable],
  activate: (_app, kernelTable: ILaunchpadKernelTable) => {
    for (const column of nebiColumns) {
      kernelTable.registerMetadataColumn(column);
    }
    for (const action of nebiActions) {
      kernelTable.registerAction(action);
    }
  }
};

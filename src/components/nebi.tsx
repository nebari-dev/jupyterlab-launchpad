// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Notification, showErrorMessage } from '@jupyterlab/apputils';
import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import { ITranslator } from '@jupyterlab/translation';
import type {
  ReadonlyJSONObject,
  ReadonlyPartialJSONObject
} from '@lumino/coreutils';
import * as React from 'react';
import { requestAPI } from '../handler';
import { infoCircleIcon } from '../icons';
import { addKernelRefreshMessageListener } from '../kernel-refresh-messages';
import { refreshKernelSpecs } from '../kernel-refresh';
import { LaunchpadTooltip } from './tooltip';
import {
  IKernelAction,
  IKernelActionOptions,
  IKernelIconFallbackTitleProvider,
  IKernelMetadataColumn,
  ILaunchpadKernelTable
} from '../types';

export namespace NebiCommandIDs {
  export const pull = 'launchpad:nebi-pull';
  export const installDependencies = 'launchpad:nebi-install-dependencies';
  export const editConfig = 'launchpad:nebi-edit-config';
}

export const NEBI_JOB_COMPLETED_MESSAGE = 'nebi:job-completed';

interface INebiActionCapabilities {
  nebi: boolean;
  pixi: boolean;
}

interface INebiStatusPresentation {
  label: string;
  className: string;
  showInfoIcon?: boolean;
}

interface IServerProxyInfo {
  server_processes?: Array<{
    name?: string;
    launcher_entry?: {
      path_info?: string;
    };
  }>;
}

const NEBI_SERVER_PROXY_COMMAND = 'server-proxy:open';
const NEBI_SERVER_PROXY_ID = 'server-proxy:nebi';
const NEBI_WORKSPACE_OVERVIEW_PROXY_PATH = 'nebi/workspaces';

const NEBI_STATUS_PRESENTATION: Record<string, INebiStatusPresentation> = {
  'not-pulled': {
    label: 'Not pulled',
    className: 'jp-NebiStatus-not-pulled',
    showInfoIcon: true
  },
  'not-installed': {
    label: 'Not installed',
    className: 'jp-NebiStatus-not-installed',
    showInfoIcon: true
  },
  'missing-deps': {
    label: 'Missing dependencies',
    className: 'jp-NebiStatus-missing-deps',
    showInfoIcon: true
  },
  failed: {
    label: 'Failed',
    className: 'jp-NebiStatus-failed',
    showInfoIcon: true
  },
  outdated: {
    label: 'Outdated',
    className: 'jp-NebiStatus-outdated',
    showInfoIcon: true
  },
  ready: {
    label: 'Ready',
    className: 'jp-NebiStatus-ready'
  }
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
  nebi_version: 'Version',
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
    normalizeStatus(metadata?.['nebi_status']) ??
    normalizeStatus(metadata?.['nebi_state']) ??
    normalizeStatus(fallback)
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
  status: string,
  showInfoIcon?: boolean,
  title?: string
): React.ReactNode {
  const tooltip = title || undefined;
  return (
    <span
      className={`jp-NebiIndicator ${className}`}
      data-status={status}
      aria-label={tooltip ? `${label}: ${tooltip}` : label}
    >
      <span className="jp-NebiIndicator-label">{label}</span>
      {showInfoIcon && tooltip ? (
        <LaunchpadTooltip label={tooltip}>
          <infoCircleIcon.react
            className="jp-NebiIndicator-icon"
            tag="span"
            aria-hidden="true"
          />
        </LaunchpadTooltip>
      ) : showInfoIcon ? (
        <infoCircleIcon.react
          className="jp-NebiIndicator-icon"
          tag="span"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

function renderStatus(
  value: string,
  metadata: ReadonlyJSONObject | undefined
): React.ReactNode {
  const presentation = NEBI_STATUS_PRESENTATION[value] ?? {
    label: value,
    className: 'jp-NebiStatus-unknown'
  };
  const title = nebiStatusTitle(value, metadata);
  return renderNebiIndicator(
    presentation.label,
    presentation.className,
    value,
    presentation.showInfoIcon,
    title
  );
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

  return `This environment is missing ${dependencies.length === 1 ? 'a dependency' : 'dependencies'} required to start. Use Attempt fix to install them.`;
}

function isLatestVersion(
  id: string,
  value: unknown,
  metadata: ReadonlyJSONObject | undefined
): value is string {
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

function localVersionFromMetadata(
  metadata: ReadonlyJSONObject | undefined,
  fallback?: unknown
): string | undefined {
  if (typeof fallback === 'string' && fallback.length > 0) {
    return fallback;
  }

  const localVersion = metadata?.['nebi_local_version'];
  return typeof localVersion === 'string' && localVersion.length > 0
    ? localVersion
    : undefined;
}

function renderNebiVersion(
  version: string,
  options: { remoteVersion?: unknown; updateAvailable?: boolean } = {}
): React.ReactNode {
  if (!options.updateAvailable) {
    return (
      <span className="jp-NebiVersion" aria-label={version}>
        <span>{version}</span>
      </span>
    );
  }

  return (
    <span
      className="jp-NebiVersion"
      title={
        typeof options.remoteVersion === 'string'
          ? `Remote version ${options.remoteVersion} is available`
          : 'Update available'
      }
      aria-label={`${version} update available`}
    >
      <span>{version}</span>
      <span className="jp-NebiVersionSeparator" aria-hidden="true">
        ·
      </span>
      <span className="jp-NebiVersionUpdate">update available</span>
    </span>
  );
}

function nebiStatusTitle(
  value: unknown,
  metadata: ReadonlyJSONObject | undefined
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  switch (value) {
    case 'not-installed':
      return "Packages haven't been set up yet";
    case 'missing-deps':
      return 'Can’t launch in Jupyter';
    case 'failed':
      return 'This workspace is broken';
  }

  const reason = metadata?.['nebi_not_ready_reason'];
  if (typeof reason === 'string' && reason.length > 0) {
    if (!NEBI_REDUNDANT_REASONS.has(reason)) {
      return reason;
    }
  }

  switch (value) {
    case 'not-pulled':
      return 'This workspace has not been pulled locally. Use Pull to download it.';
    case 'outdated':
      return 'A newer remote version is available.';
  }

  return '';
}

const nebiColumns: IKernelMetadataColumn[] = Object.entries(
  NEBI_METADATA_LABELS
).map(([id, label]) => ({
  id,
  label,
  isVisibleByDefault: id === 'nebi_version' || id === 'nebi_status',
  title: ({ value, metadata }) => {
    if (id === 'nebi_state' || id === 'nebi_status') {
      return null;
    }

    if (id === 'nebi_missing_dependencies') {
      return missingDependenciesTitle(metadata);
    }

    return undefined;
  },
  render: ({ value, metadata }) => {
    if (id === 'nebi_version') {
      const version = localVersionFromMetadata(metadata, value);
      if (!version) {
        return '-';
      }

      const remoteVersion = metadata?.['nebi_remote_version'];
      if (metadata?.['nebi_outdated'] === true) {
        return renderNebiVersion(version, {
          remoteVersion,
          updateAvailable: true
        });
      }

      return renderNebiVersion(version);
    }

    if (id === 'nebi_state' || id === 'nebi_status') {
      const status = statusFromMetadata(metadata, value);
      if (!status) {
        return '-';
      }

      return renderStatus(status, metadata);
    }

    if (id === 'nebi_source' || id === 'nebi_location') {
      const location = locationFromMetadata(metadata, value);
      if (!location) {
        return '-';
      }

      return renderLocation(location);
    }

    if (
      id === 'nebi_local_version' &&
      metadata?.['nebi_outdated'] === true &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      const version = value;
      const remoteVersion = metadata?.['nebi_remote_version'];
      return renderNebiVersion(version, {
        remoteVersion,
        updateAvailable: true
      });
    }

    if (
      (id === 'nebi_local_version' || id === 'nebi_remote_version') &&
      isLatestVersion(id, value, metadata)
    ) {
      const version = value;
      return renderNebiVersion(version);
    }

    if (
      (id === 'nebi_local_version' || id === 'nebi_remote_version') &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      return renderNebiVersion(value);
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
    pendingLabel: 'Pulling',
    command: NebiCommandIDs.pull,
    title: 'Pull this Nebi workspace',
    rank: 0,
    isAvailable: options =>
      statusFromMetadata(options.metadata) === 'not-pulled' &&
      typeof options.metadata?.['nebi_workspace'] === 'string' &&
      options.metadata['nebi_workspace'].length > 0,
    args: actionArgs
  },
  {
    id: 'nebi-install-environment',
    label: 'Install',
    pendingLabel: 'Installing',
    command: NebiCommandIDs.installDependencies,
    title: 'Install environment',
    rank: 1,
    isAvailable: options =>
      statusFromMetadata(options.metadata) === 'not-installed' &&
      typeof options.metadata?.['nebi_workspace_path'] === 'string' &&
      options.metadata['nebi_workspace_path'].length > 0,
    args: actionArgs
  },
  {
    id: 'nebi-install-dependencies',
    label: 'Attempt fix',
    pendingLabel: 'Attempting fix',
    command: NebiCommandIDs.installDependencies,
    title: 'Install missing dependencies',
    rank: 1,
    isAvailable: options =>
      statusFromMetadata(options.metadata) === 'missing-deps' &&
      typeof options.metadata?.['nebi_workspace_path'] === 'string' &&
      options.metadata['nebi_workspace_path'].length > 0,
    args: actionArgs
  },
  {
    id: 'nebi-edit-config',
    label: 'Open in Nebi',
    command: NebiCommandIDs.editConfig,
    title: 'Open Nebi workspace overview',
    rank: 2,
    isAvailable: options => {
      const status = statusFromMetadata(options.metadata);
      return status === 'missing-deps' || status === 'failed';
    },
    args: actionArgs
  }
];

const nebiIconFallbackTitleProvider: IKernelIconFallbackTitleProvider = {
  id: 'nebi-logo-reason',
  title: ({ metadata }) => {
    const logoReason = metadata?.['nebi_logo_reason'];
    return typeof logoReason === 'string' && logoReason.length > 0
      ? logoReason
      : undefined;
  }
};

function stringArg(args: ReadonlyPartialJSONObject, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

function commandBody(args: ReadonlyPartialJSONObject): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(args),
    headers: {
      'Content-Type': 'application/json'
    }
  };
}

function notifyAction<T>(
  operation: Promise<T>,
  messages: { pending: string; success: string; error: string }
): Promise<T> {
  Notification.promise(
    operation.then(() => null),
    {
      pending: {
        message: messages.pending,
        options: { autoClose: false }
      },
      success: {
        message: () => messages.success,
        options: { autoClose: 3000 }
      },
      error: {
        message: () => messages.error,
        options: { autoClose: false }
      }
    }
  );
  return operation;
}

function hasMissingDependencies(args: ReadonlyPartialJSONObject): boolean {
  const value = args['missingDependencies'];
  return Array.isArray(value) && value.length > 0;
}

async function getNebiServerProxyPath(): Promise<string | null> {
  try {
    const settings = ServerConnection.makeSettings();
    // Ask Jupyter Server Proxy which Nebi entry is registered so the launcher
    // only shows Open in Nebi when the proxy exists and uses its configured path.
    const requestUrl = URLExt.join(
      settings.baseUrl,
      'server-proxy',
      'servers-info'
    );
    const response = await ServerConnection.makeRequest(
      requestUrl,
      {},
      settings
    );
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as IServerProxyInfo;
    const server = data.server_processes?.find(item => item.name === 'nebi');
    if (!server) {
      return null;
    }

    const path = server.launcher_entry?.path_info;
    return typeof path === 'string' && path.length > 0
      ? path.replace(/^\/+/, '')
      : NEBI_WORKSPACE_OVERVIEW_PROXY_PATH;
  } catch {
    return null;
  }
}

function registerNebiActionCommands(
  app: JupyterFrontEnd,
  trans: ReturnType<ITranslator['load']>
): void {
  const { commands } = app;
  let capabilities: INebiActionCapabilities = {
    nebi: false,
    pixi: false
  };
  let nebiServerProxyPath: string | null = null;
  const refreshActionCommands = () => {
    commands.notifyCommandChanged(NebiCommandIDs.pull);
    commands.notifyCommandChanged(NebiCommandIDs.installDependencies);
    commands.notifyCommandChanged(NebiCommandIDs.editConfig);
  };

  void requestAPI<INebiActionCapabilities>('nebi/capabilities')
    .then(value => {
      capabilities = value;
      refreshActionCommands();
    })
    .catch(error => {
      console.warn('Could not load Nebi action capabilities', error);
      refreshActionCommands();
    });
  void getNebiServerProxyPath().then(value => {
    nebiServerProxyPath = value;
    refreshActionCommands();
  });

  const canPull = (args: ReadonlyPartialJSONObject) =>
    capabilities.nebi && stringArg(args, 'workspace').length > 0;
  const canInstallDependencies = (args: ReadonlyPartialJSONObject) =>
    capabilities.pixi && stringArg(args, 'workspacePath').length > 0;
  const canOpenNebi = () =>
    capabilities.nebi &&
    nebiServerProxyPath !== null &&
    commands.hasCommand(NEBI_SERVER_PROXY_COMMAND);

  commands.addCommand(NebiCommandIDs.pull, {
    label: trans.__('Pull'),
    caption: () =>
      capabilities.nebi
        ? trans.__('Pull this Nebi workspace')
        : trans.__('Nebi CLI is not available on this Jupyter server'),
    isVisible: canPull,
    isEnabled: canPull,
    execute: async args => {
      if (!capabilities.nebi) {
        return;
      }
      try {
        await notifyAction(
          requestAPI('nebi/pull', commandBody(args)).then(() =>
            refreshKernelSpecs(app)
          ),
          {
            pending: trans.__('Pulling workspace...'),
            success: trans.__('Workspace Pulled'),
            error: trans.__('Could not pull workspace')
          }
        );
      } catch (error) {
        console.error(error);
        await showErrorMessage(
          trans.__('Could not pull Nebi workspace'),
          error as Error
        );
      }
    }
  });

  commands.addCommand(NebiCommandIDs.installDependencies, {
    label: trans.__('Attempt fix'),
    caption: () =>
      capabilities.pixi
        ? trans.__('Install missing dependencies')
        : trans.__('Pixi is not available on this Jupyter server'),
    isVisible: canInstallDependencies,
    isEnabled: canInstallDependencies,
    execute: async args => {
      if (!capabilities.pixi) {
        return;
      }
      const installingDependencies = hasMissingDependencies(args);
      try {
        await notifyAction(
          requestAPI('nebi/install-dependencies', commandBody(args)).then(() =>
            refreshKernelSpecs(app)
          ),
          {
            pending: installingDependencies
              ? trans.__('Installing dependencies...')
              : trans.__('Installing environment...'),
            success: installingDependencies
              ? trans.__('Dependencies installed')
              : trans.__('Environment installed'),
            error: installingDependencies
              ? trans.__('Could not install dependencies')
              : trans.__('Could not install environment')
          }
        );
      } catch (error) {
        console.error(error);
        await showErrorMessage(
          installingDependencies
            ? trans.__('Could not install Nebi dependencies')
            : trans.__('Could not install Nebi environment'),
          error as Error
        );
      }
    }
  });

  commands.addCommand(NebiCommandIDs.editConfig, {
    label: trans.__('Open in Nebi'),
    caption: trans.__('Open Nebi workspace overview'),
    isVisible: canOpenNebi,
    isEnabled: canOpenNebi,
    execute: async () => {
      if (nebiServerProxyPath === null) {
        return;
      }
      try {
        await commands.execute(NEBI_SERVER_PROXY_COMMAND, {
          id: NEBI_SERVER_PROXY_ID,
          title: 'Nebi',
          url: URLExt.join(
            app.serviceManager.serverSettings.baseUrl,
            nebiServerProxyPath
          ),
          newBrowserTab: false
        });
      } catch (error) {
        console.error(error);
        await showErrorMessage(trans.__('Could not open Nebi'), error as Error);
      }
    }
  });
}

export const nebiKernelTablePlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-launchpad:nebi',
  description: 'Nebi kernel metadata presentation for launchpad',
  autoStart: true,
  requires: [ITranslator, ILaunchpadKernelTable],
  activate: (
    app,
    translator: ITranslator,
    kernelTable: ILaunchpadKernelTable
  ) => {
    const trans = translator.load('jupyterlab-launchpad');
    // Registered for the lifetime of the Nebi plugin.
    addKernelRefreshMessageListener(app, [NEBI_JOB_COMPLETED_MESSAGE]);
    registerNebiActionCommands(app, trans);
    kernelTable.registerIconFallbackTitleProvider(
      nebiIconFallbackTitleProvider
    );
    for (const column of nebiColumns) {
      kernelTable.registerMetadataColumn(column);
    }
    for (const action of nebiActions) {
      kernelTable.registerAction(action);
    }
  }
};

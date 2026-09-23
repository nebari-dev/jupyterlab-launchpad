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
import { checkIcon } from '@jupyterlab/ui-components';
import type { LabIcon } from '@jupyterlab/ui-components';
import type {
  ReadonlyJSONObject,
  ReadonlyPartialJSONObject
} from '@lumino/coreutils';
import * as React from 'react';
import { requestAPI } from '../handler';
import { infoCircleIcon, nebiIcon, updateAvailableIcon } from '../icons';
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
  export const openOverview = 'launchpad:nebi-open-overview';
}

export const NEBI_JOB_COMPLETED_MESSAGE = 'nebi:job-completed';

interface INebiActionCapabilities {
  nebi: boolean;
  pixi: boolean;
}

interface INebiStatusPresentation {
  label: string;
  className: string;
  compactIcon?: LabIcon;
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
    className: 'jp-NebiStatus-ready',
    compactIcon: checkIcon
  }
};

const NEBI_STATUS_SORT_RANK: Record<string, number> = {
  ready: 0,
  outdated: 1,
  'missing-deps': 2,
  'not-installed': 3,
  'not-pulled': 4,
  failed: 5
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

function statusSortRank(
  metadata: ReadonlyJSONObject | undefined,
  fallback?: unknown
): number {
  const status = statusFromMetadata(metadata, fallback);
  return status ? NEBI_STATUS_SORT_RANK[status] ?? Number.MAX_SAFE_INTEGER : 6;
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
  title?: string,
  compactIcon = infoCircleIcon
): React.ReactNode {
  const tooltip = title || undefined;
  const CompactIcon = compactIcon.react;
  return (
    <span
      className={`jp-NebiIndicator ${className}`}
      data-status={status}
      aria-label={tooltip ? `${label}: ${tooltip}` : label}
    >
      <LaunchpadTooltip
        className="jp-NebiIndicator-compactTooltip"
        label={label}
      >
        <CompactIcon
          className="jp-NebiIndicator-compactIcon"
          tag="span"
          aria-hidden="true"
        />
      </LaunchpadTooltip>
      <span className="jp-NebiIndicator-label">{label}</span>
      {showInfoIcon && tooltip ? (
        <LaunchpadTooltip
          className="jp-NebiIndicator-infoTooltip"
          label={tooltip}
        >
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
  metadata: ReadonlyJSONObject | undefined,
  trans: ReturnType<ITranslator['load']>
): React.ReactNode {
  const presentation = NEBI_STATUS_PRESENTATION[value] ?? {
    label: value,
    className: 'jp-NebiStatus-unknown'
  };
  const title = nebiStatusTitle(value, metadata, trans);
  return renderNebiIndicator(
    NEBI_STATUS_PRESENTATION[value]
      ? trans.__(presentation.label)
      : presentation.label,
    presentation.className,
    value,
    presentation.showInfoIcon,
    title,
    presentation.compactIcon
  );
}

function renderLocation(
  value: string,
  trans: ReturnType<ITranslator['load']>
): React.ReactNode {
  const label = NEBI_LOCATION_LABELS[value] ?? value;
  return (
    <span className="jp-NebiLocation">
      {NEBI_LOCATION_LABELS[value] ? trans.__(label) : label}
    </span>
  );
}

function missingDependenciesTitle(
  metadata: ReadonlyJSONObject | undefined,
  trans: ReturnType<ITranslator['load']>
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

  return dependencies.length === 1
    ? trans.__(
        'This environment is missing a dependency required to start. Use Attempt fix to install it.'
      )
    : trans.__(
        'This environment is missing dependencies required to start. Use Attempt fix to install them.'
      );
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
  options: { updateAvailable?: boolean } = {},
  trans?: ReturnType<ITranslator['load']>
): React.ReactNode {
  const updateTitle = trans?.__('Update available') ?? 'Update available';

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
      aria-label={
        trans?.__('%1 update available', version) ??
        `${version} update available`
      }
    >
      <span>{version}</span>
      <span className="jp-NebiVersionSeparator" aria-hidden="true">
        ·
      </span>
      <LaunchpadTooltip
        className="jp-NebiVersionUpdateTextTooltip"
        label={updateTitle}
      >
        <span className="jp-NebiVersionUpdate">
          {trans?.__('update available') ?? 'update available'}
        </span>
      </LaunchpadTooltip>
      <LaunchpadTooltip
        className="jp-NebiVersionUpdateIconTooltip"
        label={updateTitle}
      >
        <updateAvailableIcon.react
          className="jp-NebiVersionUpdateIcon"
          tag="span"
          aria-hidden="true"
        />
      </LaunchpadTooltip>
    </span>
  );
}

function nebiStatusTitle(
  value: unknown,
  metadata: ReadonlyJSONObject | undefined,
  trans: ReturnType<ITranslator['load']>
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  switch (value) {
    case 'not-installed':
      return trans.__("Packages haven't been set up yet");
    case 'missing-deps':
      return trans.__('Can’t launch in Jupyter');
    case 'failed':
      return trans.__('This workspace is broken');
  }

  const reason = metadata?.['nebi_not_ready_reason'];
  if (typeof reason === 'string' && reason.length > 0) {
    if (!NEBI_REDUNDANT_REASONS.has(reason)) {
      return reason;
    }
  }

  switch (value) {
    case 'not-pulled':
      return trans.__(
        'This workspace has not been pulled locally. Use Pull to download it.'
      );
    case 'outdated':
      return trans.__('A newer remote version is available.');
  }

  return '';
}

function createNebiColumns(
  trans: ReturnType<ITranslator['load']>
): IKernelMetadataColumn[] {
  return [
    {
      // Launchpad display column derived from nb-nebi-kernels' local version.
      // Ordinary kernels supply the explicit value "Built in" in Item.
      id: 'nebi_version',
      label: trans.__('Version'),
      isVisibleByDefault: true,
      sort: (a, b) => {
        const aVersion = localVersionFromMetadata(a.metadata, a.value);
        const bVersion = localVersionFromMetadata(b.metadata, b.value);
        if (!aVersion || !bVersion) {
          return Number(!aVersion) - Number(!bVersion);
        }
        return aVersion.localeCompare(bVersion);
      },
      render: ({ value, metadata }) => {
        const version = localVersionFromMetadata(metadata, value);
        return version
          ? renderNebiVersion(
              version,
              { updateAvailable: metadata?.['nebi_outdated'] === true },
              trans
            )
          : '-';
      }
    },
    {
      id: 'nebi_state',
      label: trans.__('Status'),
      title: () => null,
      sort: (a, b) =>
        statusSortRank(a.metadata, a.value) -
        statusSortRank(b.metadata, b.value),
      render: ({ value, metadata }) => {
        const status = statusFromMetadata(metadata, value);
        return status ? renderStatus(status, metadata, trans) : '-';
      }
    },
    {
      // Launchpad display column: accepts nebi_status and falls back to the
      // nebi_state field emitted by nb-nebi-kernels. Item supplies "ready"
      // for ordinary kernels.
      id: 'nebi_status',
      label: trans.__('Status'),
      isVisibleByDefault: true,
      title: () => null,
      sort: (a, b) =>
        statusSortRank(a.metadata, a.value) -
        statusSortRank(b.metadata, b.value),
      render: ({ value, metadata }) => {
        const status = statusFromMetadata(metadata, value);
        return status ? renderStatus(status, metadata, trans) : '-';
      }
    },
    {
      id: 'nebi_location',
      label: trans.__('Location'),
      render: ({ value, metadata }) => {
        const location = locationFromMetadata(metadata, value);
        return location ? renderLocation(location, trans) : '-';
      }
    },
    {
      id: 'nebi_missing_dependencies',
      label: trans.__('Missing dependencies'),
      title: ({ metadata }) => missingDependenciesTitle(metadata, trans),
      render: ({ value }) => {
        if (!Array.isArray(value)) {
          return undefined;
        }
        return value.length === 0
          ? '-'
          : value
              .filter(item => typeof item === 'string' && item.length > 0)
              .join(', ');
      }
    },
    {
      id: 'nebi_local_version',
      label: trans.__('Local version'),
      render: ({ value, metadata }) =>
        typeof value === 'string' && value.length > 0
          ? renderNebiVersion(
              value,
              { updateAvailable: metadata?.['nebi_outdated'] === true },
              trans
            )
          : undefined
    },
    {
      id: 'nebi_remote_version',
      label: trans.__('Remote version'),
      render: ({ value }) =>
        typeof value === 'string' && value.length > 0
          ? renderNebiVersion(value)
          : undefined
    },
    {
      id: 'nebi_outdated',
      label: trans.__('Outdated?'),
      render: ({ value }) =>
        typeof value === 'boolean'
          ? value
            ? trans.__('Yes')
            : trans.__('No')
          : undefined
    },
    {
      id: 'nebi_not_ready_reason',
      label: trans.__('Not ready reason')
    },
    {
      id: 'nebi_logo_reason',
      label: trans.__('Logo reason')
    },
    {
      id: 'nebi_discovery_hash',
      label: trans.__('Discovery hash')
    },
    {
      id: 'nebi_discovered_at',
      label: trans.__('Discovered at')
    },
    {
      id: 'nebi_kernel_spec',
      label: trans.__('Kernel spec')
    },
    {
      id: 'nebi_kernel_state',
      label: trans.__('Kernel state')
    },
    {
      id: 'nebi_workspace',
      label: trans.__('Workspace')
    },
    {
      id: 'nebi_workspace_path',
      label: trans.__('Workspace path')
    },
    {
      id: 'nebi_source',
      label: trans.__('Location'),
      render: ({ value, metadata }) => {
        const location = locationFromMetadata(metadata, value);
        return location ? renderLocation(location, trans) : '-';
      }
    },
    {
      id: 'pixi_environment',
      label: trans.__('Environment')
    }
  ];
}

function actionArgs({ metadata }: IKernelActionOptions) {
  return {
    workspace: metadata?.['nebi_workspace'],
    workspacePath: metadata?.['nebi_workspace_path'],
    remoteVersion: metadata?.['nebi_remote_version'],
    environment: metadata?.['pixi_environment'],
    missingDependencies: metadata?.['nebi_missing_dependencies']
  };
}

function createNebiActions(
  trans: ReturnType<ITranslator['load']>
): IKernelAction[] {
  return [
    {
      id: 'nebi-pull',
      label: trans.__('Pull'),
      pendingLabel: trans.__('Pulling'),
      command: NebiCommandIDs.pull,
      title: trans.__('Pull this Nebi workspace'),
      rank: 0,
      isAvailable: options =>
        statusFromMetadata(options.metadata) === 'not-pulled' &&
        typeof options.metadata?.['nebi_workspace'] === 'string' &&
        options.metadata['nebi_workspace'].length > 0,
      args: actionArgs
    },
    {
      id: 'nebi-install-environment',
      label: trans.__('Install'),
      pendingLabel: trans.__('Installing'),
      command: NebiCommandIDs.installDependencies,
      title: trans.__('Install environment'),
      rank: 1,
      isAvailable: options =>
        statusFromMetadata(options.metadata) === 'not-installed' &&
        typeof options.metadata?.['nebi_workspace_path'] === 'string' &&
        options.metadata['nebi_workspace_path'].length > 0,
      args: actionArgs
    },
    {
      id: 'nebi-install-dependencies',
      label: trans.__('Attempt fix'),
      pendingLabel: trans.__('Attempting fix'),
      command: NebiCommandIDs.installDependencies,
      title: trans.__('Install missing dependencies'),
      rank: 1,
      isAvailable: options =>
        statusFromMetadata(options.metadata) === 'missing-deps' &&
        typeof options.metadata?.['nebi_workspace_path'] === 'string' &&
        options.metadata['nebi_workspace_path'].length > 0,
      args: actionArgs
    },
    {
      id: 'nebi-open-overview',
      label: trans.__('Open in Nebi'),
      compactIcon: nebiIcon,
      command: NebiCommandIDs.openOverview,
      title: trans.__('Open Nebi workspace overview'),
      rank: 2,
      isAvailable: options => {
        const status = statusFromMetadata(options.metadata);
        return status === 'missing-deps' || status === 'failed';
      },
      args: actionArgs
    }
  ];
}

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
    commands.notifyCommandChanged(NebiCommandIDs.openOverview);
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
      }
    }
  });

  commands.addCommand(NebiCommandIDs.openOverview, {
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
    for (const column of createNebiColumns(trans)) {
      kernelTable.registerMetadataColumn(column);
    }
    for (const action of createNebiActions(trans)) {
      kernelTable.registerAction(action);
    }
  }
};

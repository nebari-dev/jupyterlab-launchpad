import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import type { TranslationBundle } from '@jupyterlab/translation';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import type {
  INebiJob,
  INebiServerVersion,
  INebiWorkspace
} from './nebi-types';

/** Use Nebi's named Jupyter Server Proxy entry with Jupyter's base URL. */
export async function requestNebi<T>(
  path: string,
  trans: TranslationBundle,
  init: RequestInit = {}
): Promise<T> {
  const settings = ServerConnection.makeSettings();
  const response = await ServerConnection.makeRequest(
    URLExt.join(settings.baseUrl, 'nebi', 'api/v1', path),
    init,
    settings
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(
      data?.error ||
        data?.message ||
        trans.__('Nebi request failed (HTTP %1)', response.status)
    );
  }
  return response.json();
}

/** Resolve a registered local workspace before starting an environment job. */
export async function getNebiWorkspace(
  args: ReadonlyPartialJSONObject,
  trans: TranslationBundle
): Promise<INebiWorkspace> {
  if (args['environment'] && args['environment'] !== 'default') {
    throw new Error(trans.__('Nebi only supports the default environment.'));
  }
  const version = await requestNebi<INebiServerVersion>('version', trans);
  if (version.mode !== 'local') {
    throw new Error(trans.__('This action requires Nebi in local mode.'));
  }
  const workspaces = await requestNebi<INebiWorkspace[] | null>(
    'workspaces',
    trans
  );
  const workspace = workspaces?.find(
    item => item.path && item.path === args['workspacePath']
  );
  if (!workspace?.id) {
    throw new Error(
      trans.__(
        'Workspace not found in Nebi. Register it first: run "nebi init" in this folder, then try again.'
      )
    );
  }
  return workspace;
}

/**
 * Submit once and poll the accepted job. Nebi owns its execution; closing or
 * reloading the page stops polling and reopening it does not resume polling.
 */
export async function runNebiJob(
  path: string,
  trans: TranslationBundle,
  init: RequestInit = {}
): Promise<string> {
  let job = await requestNebi<INebiJob>(path, trans, {
    ...init,
    method: 'POST'
  });
  if (!job.id) {
    throw new Error(
      trans.__(
        'Nebi returned no job ID. Check the workspace in Nebi before retrying.'
      )
    );
  }
  const jobId = job.id;
  while (job.status === 'pending' || job.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 2000));
    job = await requestNebi<INebiJob>(
      `jobs/${encodeURIComponent(jobId)}`,
      trans
    );
  }
  if (job.status !== 'completed') {
    throw new Error(
      job.error ||
        trans.__('Nebi job did not complete. Check the workspace in Nebi.')
    );
  }
  return jobId;
}

import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import type { TranslationBundle } from '@jupyterlab/translation';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';

/**
 * Fields consumed from Nebi's Job response. The backend also defines cancelled.
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/frontend/src/types/models.ts#L69-L80
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/internal/models/job.go#L27-L47
 */
interface INebiJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

/**
 * Fields consumed from Nebi's Workspace response.
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/frontend/src/types/models.ts#L26-L42
 */
interface INebiWorkspace {
  id: string;
  path?: string;
}

/**
 * Fields consumed from Nebi's GET /version response.
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/internal/api/handlers/version.go#L110-L133
 */
interface INebiServerVersion {
  mode: string;
}

/** Use Nebi's named Jupyter Server Proxy entry with Jupyter's base URL. */
async function requestNebi<T>(
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

/**
 * Nebi owns the accepted job. Closing or reloading the browser page stops polling;
 * reopening the page does not resume it automatically.
 */
export async function installNebiEnvironment(
  args: ReadonlyPartialJSONObject,
  trans: TranslationBundle
): Promise<void> {
  if (args['environment'] && args['environment'] !== 'default') {
    throw new Error(trans.__('Nebi only supports the default environment.'));
  }
  const version = await requestNebi<INebiServerVersion>('version', trans);
  if (version.mode !== 'local') {
    throw new Error(
      trans.__('Environment installation requires Nebi in local mode.')
    );
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
        'Workspace not found in Nebi. Register it in Nebi before installing: run "nebi init" in this folder, then try again.'
      )
    );
  }
  let job = await requestNebi<INebiJob>(
    `workspaces/${encodeURIComponent(workspace.id)}/install`,
    trans,
    { method: 'POST' }
  );
  if (!job.id) {
    throw new Error(
      trans.__(
        'Nebi returned no job ID. Check the workspace in Nebi before retrying.'
      )
    );
  }
  const jobId = job.id;
  while (job.status === 'pending' || job.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 500));
    job = await requestNebi<INebiJob>(
      `jobs/${encodeURIComponent(jobId)}`,
      trans
    );
  }
  if (job.status !== 'completed') {
    throw new Error(
      job.error ||
        trans.__(
          'Nebi install job did not complete. Check the workspace in Nebi.'
        )
    );
  }
}

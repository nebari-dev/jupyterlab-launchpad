import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
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
        `Nebi request failed (HTTP ${response.status})`
    );
  }
  return response.json();
}

/**
 * Nebi owns the accepted job. Closing or reloading the browser page stops polling;
 * reopening the page does not resume it automatically.
 */
export async function installNebiEnvironment(
  args: ReadonlyPartialJSONObject
): Promise<void> {
  if (args['environment'] && args['environment'] !== 'default') {
    throw new Error('Nebi only supports the default environment.');
  }
  const version = await requestNebi<INebiServerVersion>('version');
  if (version.mode !== 'local') {
    throw new Error('Environment installation requires Nebi in local mode.');
  }
  const workspaces = await requestNebi<INebiWorkspace[] | null>('workspaces');
  const workspace = workspaces?.find(
    item => item.path && item.path === args['workspacePath']
  );
  if (!workspace?.id) {
    throw new Error(
      'Workspace not found in Nebi. Register it in Nebi before installing.'
    );
  }
  let job = await requestNebi<INebiJob>(
    `workspaces/${encodeURIComponent(workspace.id)}/install`,
    { method: 'POST' }
  );
  if (!job.id) {
    throw new Error(
      'Nebi returned no job ID. Check the workspace in Nebi before retrying.'
    );
  }
  const jobId = job.id;
  while (job.status === 'pending' || job.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 500));
    job = await requestNebi<INebiJob>(`jobs/${encodeURIComponent(jobId)}`);
  }
  if (job.status !== 'completed') {
    throw new Error(
      job.error ||
        'Nebi install job did not complete. Check the workspace in Nebi.'
    );
  }
}

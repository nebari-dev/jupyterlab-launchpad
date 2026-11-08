import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';

interface IJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

interface IVersion {
  version_number: number;
  job_id?: string;
}

/** Use the named Jupyter Server Proxy entry, including Jupyter's base URL. */
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
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.error ||
        data?.message ||
        `Nebi request failed (HTTP ${response.status})`
    );
  }
  return response.json();
}

function packages(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      item =>
        typeof item !== 'string' || !item.trim() || item.trim().startsWith('-')
    )
  ) {
    throw new Error('Invalid missing dependency specifications.');
  }
  return value;
}

/** Nebi owns the accepted job; closing the page only stops status polling. */
export async function repairNebiEnvironment(
  args: ReadonlyPartialJSONObject,
  kernelDependencies: string[]
): Promise<void> {
  if (args['environment'] && args['environment'] !== 'default') {
    throw new Error('Nebi only supports the default environment.');
  }
  const dependencies = [...packages(args['missingDependencies'] ?? [])];
  if (
    args['repair'] === true &&
    args['notReadyReason'] === 'kernel-not-installed'
  ) {
    const override = packages(args['kernelDependencies'] ?? []);
    dependencies.push(
      ...packages(override.length ? override : kernelDependencies)
    );
  }
  if (!dependencies.length) {
    throw new Error(
      'No automatic repair is available. Open this environment in Nebi.'
    );
  }
  const version = await requestNebi<{ mode: string }>('version');
  if (version.mode !== 'local') {
    throw new Error('Attempt fix requires Nebi in local mode.');
  }
  const workspaces = await requestNebi<Array<{
    id: string;
    path?: string;
  }> | null>('workspaces');
  const workspace = workspaces?.find(
    item => item.path && item.path === args['workspacePath']
  );
  if (!workspace?.id) {
    throw new Error(
      'Workspace not found in Nebi. Register it in Nebi before repairing.'
    );
  }
  const path = `workspaces/${encodeURIComponent(workspace.id)}`;
  let job = await requestNebi<IJob>(`${path}/packages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packages: [...new Set(dependencies)] })
  });
  if (!job.id) {
    throw new Error(
      'Nebi returned no job ID. Check the workspace in Nebi before retrying.'
    );
  }
  const jobId = job.id;
  while (job.status === 'pending' || job.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 500));
    job = await requestNebi<IJob>(`jobs/${encodeURIComponent(jobId)}`);
  }
  if (job.status !== 'completed') {
    throw new Error(
      job.error ||
        'Nebi package job did not complete. Check the workspace in Nebi.'
    );
  }
  const versions = await requestNebi<IVersion[] | null>(`${path}/versions`);
  const latest = versions?.reduce<IVersion | undefined>(
    (newest, item) =>
      !newest || item.version_number > newest.version_number ? item : newest,
    undefined
  );
  if (latest?.job_id !== jobId) {
    throw new Error(
      'Could not verify the repair version. Check the job and versions in Nebi before retrying.'
    );
  }
}

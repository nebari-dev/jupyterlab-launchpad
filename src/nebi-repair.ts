import type { TranslationBundle } from '@jupyterlab/translation';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { getNebiWorkspace, requestNebi, runNebiJob } from './nebi-api';
import type { INebiWorkspaceVersion } from './nebi-types';

function packages(value: unknown, trans: TranslationBundle): string[] {
  if (
    !Array.isArray(value) ||
    value.some(item => typeof item !== 'string' || !item.trim())
  ) {
    throw new Error(trans.__('Invalid missing dependency specifications.'));
  }
  return value;
}

/** Nebi owns the accepted job; closing the page only stops status polling. */
export async function repairNebiEnvironment(
  args: ReadonlyPartialJSONObject,
  kernelDependencies: string[],
  trans: TranslationBundle
): Promise<void> {
  const dependencies = [...packages(args['missingDependencies'] ?? [], trans)];
  if (
    args['repair'] === true &&
    args['notReadyReason'] === 'kernel-not-installed'
  ) {
    const override = packages(args['kernelDependencies'] ?? [], trans);
    dependencies.push(
      ...packages(override.length ? override : kernelDependencies, trans)
    );
  }
  if (!dependencies.length) {
    throw new Error(
      trans.__(
        'No automatic repair is available. Open this environment in Nebi.'
      )
    );
  }
  const workspace = await getNebiWorkspace(args, trans);
  const path = `workspaces/${encodeURIComponent(workspace.id)}`;
  const jobId = await runNebiJob(`${path}/packages`, trans, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packages: [...new Set(dependencies)] })
  });
  const versions = await requestNebi<INebiWorkspaceVersion[] | null>(
    `${path}/versions`,
    trans
  );
  const latest = versions?.reduce<INebiWorkspaceVersion | undefined>(
    (newest, item) =>
      !newest || item.version_number > newest.version_number ? item : newest,
    undefined
  );
  if (latest?.job_id !== jobId) {
    throw new Error(
      trans.__(
        'Could not verify the repair version. Check the job and versions in Nebi before retrying.'
      )
    );
  }
}

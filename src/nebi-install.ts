import type { TranslationBundle } from '@jupyterlab/translation';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { getNebiWorkspace, runNebiJob } from './nebi-api';

/**
 * Nebi owns the accepted job. Closing or reloading the browser page stops polling;
 * reopening the page does not resume it automatically.
 */
export async function installNebiEnvironment(
  args: ReadonlyPartialJSONObject,
  trans: TranslationBundle
): Promise<void> {
  const workspace = await getNebiWorkspace(args, trans);
  await runNebiJob(
    `workspaces/${encodeURIComponent(workspace.id)}/install`,
    trans
  );
}

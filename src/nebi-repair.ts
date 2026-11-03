import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { requestAPI } from './handler';

interface IRepairOperation {
  id: string;
  status: 'running' | 'needs_attention' | 'completed' | 'failed';
  error?: string;
}

export class NebiRepairAttentionError extends Error {}

/** The server owns every repair step; closing the page does not cancel it. */
export async function repairNebiEnvironment(
  args: ReadonlyPartialJSONObject
): Promise<void> {
  let operation = await requestAPI<IRepairOperation>('nebi/repair', {
    method: 'POST',
    body: JSON.stringify(args)
  });
  while (operation.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 500));
    operation = await requestAPI<IRepairOperation>(
      `nebi/repair/${encodeURIComponent(operation.id)}`
    );
  }
  if (operation.status === 'needs_attention') {
    throw new NebiRepairAttentionError(
      operation.error || 'Check the job in Nebi, then retry.'
    );
  }
  if (operation.status !== 'completed') {
    throw new Error(
      operation.error || 'Repair failed. Review the workspace in Nebi.'
    );
  }
}

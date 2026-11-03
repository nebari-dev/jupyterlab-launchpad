jest.mock('../handler', () => ({ requestAPI: jest.fn() }));

import { requestAPI } from '../handler';
import {
  NebiRepairAttentionError,
  repairNebiEnvironment
} from '../nebi-repair';

const args = { workspacePath: '/tmp/demo', repair: true };

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('submits once and polls the server-owned operation until complete', async () => {
  (requestAPI as jest.Mock)
    .mockResolvedValueOnce({ id: 'operation', status: 'running' })
    .mockResolvedValueOnce({ id: 'operation', status: 'running' })
    .mockResolvedValueOnce({ id: 'operation', status: 'completed' });
  const repair = repairNebiEnvironment(args);
  await jest.runAllTimersAsync();
  await repair;
  expect(requestAPI).toHaveBeenNthCalledWith(1, 'nebi/repair', {
    method: 'POST',
    body: JSON.stringify(args)
  });
  expect((requestAPI as jest.Mock).mock.calls.slice(1)).toEqual([
    ['nebi/repair/operation'],
    ['nebi/repair/operation']
  ]);
});

it('reports a failed verification even if the underlying Nebi job completed', async () => {
  (requestAPI as jest.Mock)
    .mockResolvedValueOnce({ id: 'operation', status: 'running' })
    .mockResolvedValueOnce({
      id: 'operation',
      status: 'failed',
      error: 'Repair version was not saved'
    });
  const repair = expect(repairNebiEnvironment(args)).rejects.toThrow(
    'Repair version was not saved'
  );
  await jest.runAllTimersAsync();
  await repair;
});

it('does not cancel or resubmit the operation when the connection is lost', async () => {
  (requestAPI as jest.Mock)
    .mockResolvedValueOnce({ id: 'operation', status: 'running' })
    .mockRejectedValueOnce(new Error('Disconnected'));
  const repair = expect(repairNebiEnvironment(args)).rejects.toThrow(
    'Disconnected'
  );
  await jest.runAllTimersAsync();
  await repair;
  expect(requestAPI).toHaveBeenCalledTimes(2);
  expect((requestAPI as jest.Mock).mock.calls[1]).toEqual([
    'nebi/repair/operation'
  ]);
});

it('surfaces attention-needed guidance without submitting another repair', async () => {
  (requestAPI as jest.Mock)
    .mockResolvedValueOnce({ id: 'operation', status: 'running' })
    .mockResolvedValueOnce({
      id: 'operation',
      status: 'needs_attention',
      error: 'Check the job in Nebi, then click Attempt fix again.'
    });
  const repair = repairNebiEnvironment(args).catch((error: unknown) => error);
  await jest.runAllTimersAsync();
  const error = await repair;
  expect(error).toBeInstanceOf(NebiRepairAttentionError);
  expect(error).toHaveProperty(
    'message',
    expect.stringContaining('Check the job in Nebi')
  );
  expect(requestAPI).toHaveBeenCalledTimes(2);
});

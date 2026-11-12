jest.mock('@jupyterlab/services', () => ({
  ServerConnection: {
    makeSettings: jest.fn(() => ({
      baseUrl: 'https://example.com/user/demo/'
    })),
    makeRequest: jest.fn()
  }
}));

import { ServerConnection } from '@jupyterlab/services';
import { nullTranslator } from '@jupyterlab/translation';
import { getNebiWorkspace, requestNebi, runNebiJob } from '../nebi-api';

const trans = nullTranslator.load('jupyterlab-launchpad');
const request = ServerConnection.makeRequest as jest.Mock;
const url = 'https://example.com/user/demo/nebi/api/v1/';

function respond(data: unknown, status = 200) {
  request.mockResolvedValueOnce({
    ok: status < 400,
    status,
    json: async () => data
  });
}

function translateMessages() {
  const translate = trans.__.bind(trans);
  jest
    .spyOn(trans, '__')
    .mockImplementation((...values) => `translated: ${translate(...values)}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  request.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('requestNebi', () => {
  it.each([
    { error: 'Original Nebi error' },
    { message: 'Original Nebi error' }
  ])('preserves the API error %j when translation is active', async data => {
    translateMessages();
    respond(data, 403);
    await expect(requestNebi('version', trans)).rejects.toThrow(
      /^Original Nebi error$/
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'translates the HTTP fallback for a non-JSON response: %s',
    async nonJSON => {
      translateMessages();
      request.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          if (nonJSON) {
            throw new SyntaxError('Not JSON');
          }
          return null;
        }
      });
      await expect(requestNebi('version', trans)).rejects.toThrow(
        'translated: Nebi request failed (HTTP 503)'
      );
    }
  );
});

describe('getNebiWorkspace', () => {
  const args = { workspacePath: '/tmp/demo', environment: 'default' };

  it('matches the exact registered path through Jupyter’s base URL', async () => {
    const workspace = { id: 'workspace/id', path: args.workspacePath };
    respond({ mode: 'local' });
    respond([{ id: 'other', path: '/tmp/demo-other' }, workspace]);
    await expect(getNebiWorkspace(args, trans)).resolves.toEqual(workspace);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      url + 'version',
      url + 'workspaces'
    ]);
  });

  it('rejects a named environment before making requests', async () => {
    await expect(
      getNebiWorkspace({ ...args, environment: 'analysis' }, trans)
    ).rejects.toThrow('only supports the default environment');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects team mode before looking up workspaces', async () => {
    respond({ mode: 'team' });
    await expect(getNebiWorkspace(args, trans)).rejects.toThrow('local mode');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    [],
    [{ id: 'other', path: '/tmp/demo-other' }],
    [{ path: '/tmp/demo' }]
  ])(
    'rejects an unregistered workspace and explains how to register it: %j',
    async workspaces => {
      respond({ mode: 'local' });
      respond(workspaces);
      await expect(getNebiWorkspace(args, trans)).rejects.toThrow(
        'run "nebi init"'
      );
      expect(request).toHaveBeenCalledTimes(2);
    }
  );
});

describe('runNebiJob', () => {
  const path = 'workspaces/workspace%2Fid/install';

  it('submits once and polls the original job ID every two seconds', async () => {
    respond({ id: 'job/id', status: 'pending' }, 202);
    respond({ id: 'ignored', status: 'running' });
    respond({ id: 'job/id', status: 'completed' });
    const done = runNebiJob(path, trans);
    await jest.advanceTimersByTimeAsync(1999);
    expect(request).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2001);
    await expect(done).resolves.toBe('job/id');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      url + path,
      url + 'jobs/job%2Fid',
      url + 'jobs/job%2Fid'
    ]);
    expect(request.mock.calls[0][1]).toEqual({ method: 'POST' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['failed', 'cancelled'])(
    'preserves the job error for %s when translation is active',
    async status => {
      translateMessages();
      respond({
        id: 'job',
        status,
        error: 'Solver failed\nConflicting packages'
      });
      await expect(runNebiJob(path, trans)).rejects.toThrow(
        /^Solver failed\nConflicting packages$/
      );
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it('translates the fallback when a failed job has no error', async () => {
    translateMessages();
    respond({ id: 'job', status: 'failed' });
    await expect(runNebiJob(path, trans)).rejects.toThrow(
      'translated: Nebi job did not complete.'
    );
  });

  it('rejects a missing job ID without polling', async () => {
    translateMessages();
    respond({ status: 'pending' }, 202);
    await expect(runNebiJob(path, trans)).rejects.toThrow(
      'translated: Nebi returned no job ID.'
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves submission errors without starting polling', async () => {
    respond({ error: 'Nebi rejected the request' }, 409);
    await expect(runNebiJob(path, trans)).rejects.toThrow(
      /^Nebi rejected the request$/
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['api', 'network'])(
    'explains a polling %s failure without resubmitting the job',
    async source => {
      translateMessages();
      respond({ id: 'job/id', status: 'running' }, 202);
      if (source === 'api') {
        respond({ error: 'Nebi rejected the request' }, 503);
      } else {
        request.mockRejectedValueOnce(new Error('Disconnected'));
      }
      const done = runNebiJob(path, trans);
      const failure = expect(done).rejects.toThrow(
        'translated: Could not check Nebi job job/id. It may still be running. Check Nebi before retrying.'
      );
      await jest.runAllTimersAsync();
      await failure;
      await expect(done).rejects.toThrow(
        source === 'api' ? 'Nebi rejected the request' : 'Disconnected'
      );
      expect(
        request.mock.calls.filter(([, init]) => init.method === 'POST')
      ).toHaveLength(1);
      expect(request).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(0);
    }
  );
});

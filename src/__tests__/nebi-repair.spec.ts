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
import { repairNebiEnvironment } from '../nebi-repair';

const trans = nullTranslator.load('jupyterlab-launchpad');
const request = ServerConnection.makeRequest as jest.Mock;
const args = {
  workspacePath: '/tmp/demo',
  repair: true,
  missingDependencies: ['numpy']
};
const url = 'https://example.com/user/demo/nebi/api/v1/';
const respond = (data: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => data
});

function setup(
  job: { id: string; status: string; error?: string } = {
    id: 'job/id',
    status: 'completed'
  },
  versions: unknown = [{ version_number: 2, job_id: 'job/id' }]
) {
  request
    .mockResolvedValueOnce(respond({ mode: 'local' }))
    .mockResolvedValueOnce(respond([{ id: 'workspace/id', path: '/tmp/demo' }]))
    .mockResolvedValueOnce(respond(job))
    .mockResolvedValueOnce(respond(versions));
}

beforeEach(() => {
  jest.resetAllMocks();
  (ServerConnection.makeSettings as jest.Mock).mockReturnValue({
    baseUrl: 'https://example.com/user/demo/'
  });
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('submits packages through the proxy once, polls, and verifies the newest version', async () => {
  request
    .mockResolvedValueOnce(respond({ mode: 'local' }))
    .mockResolvedValueOnce(respond([{ id: 'workspace/id', path: '/tmp/demo' }]))
    .mockResolvedValueOnce(respond({ id: 'job/id', status: 'pending' }))
    .mockResolvedValueOnce(respond({ id: 'job/id', status: 'running' }))
    .mockResolvedValueOnce(respond({ id: 'job/id', status: 'completed' }))
    .mockResolvedValueOnce(
      respond([
        { version_number: 2, job_id: 'job/id' },
        { version_number: 1, job_id: 'old' }
      ])
    );
  const done = repairNebiEnvironment(args, ['ipykernel'], trans);
  await jest.advanceTimersByTimeAsync(1999);
  expect(request).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(2001);
  await done;
  expect(request.mock.calls.map(([path]) => path)).toEqual([
    url + 'version',
    url + 'workspaces',
    url + 'workspaces/workspace%2Fid/packages',
    url + 'jobs/job%2Fid',
    url + 'jobs/job%2Fid',
    url + 'workspaces/workspace%2Fid/versions'
  ]);
  expect(request.mock.calls[2][1]).toEqual({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"packages":["numpy"]}'
  });
});

it.each([
  [[], ['ipykernel'], ['numpy', 'ipykernel']],
  [['r-irkernel'], ['ipykernel'], ['numpy', 'r-irkernel']],
  [[], [], ['numpy']],
  [['numpy'], ['ipykernel'], ['numpy']]
])(
  'uses kernel overrides or server defaults alongside missing dependencies',
  async (override, defaults, expected) => {
    setup();
    await repairNebiEnvironment(
      {
        ...args,
        notReadyReason: 'kernel-not-installed',
        kernelDependencies: override
      },
      defaults,
      trans
    );
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
      packages: expected
    });
  }
);

it.each([
  [],
  null,
  [{ version_number: 1 }],
  [
    { version_number: 1, job_id: 'job/id' },
    { version_number: 2, job_id: 'other' }
  ]
])(
  'rejects a completed job without its latest saved version',
  async versions => {
    setup(undefined, versions);
    await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
      'Could not verify the repair version'
    );
  }
);

it.each(['failed', 'cancelled'])(
  'reports the job error for %s',
  async status => {
    setup({
      id: 'job',
      status,
      error: 'Solver failed\nConflicting packages'
    });
    await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
      'Solver failed\nConflicting packages'
    );
    expect(request).toHaveBeenCalledTimes(3);
  }
);

it('leaves package specification validation to Nebi and reports its error', async () => {
  const error = 'Invalid package specification: --help';
  setup({ id: 'job/id', status: 'failed', error });
  await expect(
    repairNebiEnvironment(
      { ...args, missingDependencies: ['--help'] },
      [],
      trans
    )
  ).rejects.toThrow(error);
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
    packages: ['--help']
  });
});

it('does not resubmit after losing the connection while polling', async () => {
  request
    .mockResolvedValueOnce(respond({ mode: 'local' }))
    .mockResolvedValueOnce(respond([{ id: 'workspace', path: '/tmp/demo' }]))
    .mockResolvedValueOnce(respond({ id: 'job', status: 'running' }))
    .mockRejectedValueOnce(new Error('Disconnected'));
  const done = expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
    'Disconnected'
  );
  await jest.runAllTimersAsync();
  await done;
  expect(
    request.mock.calls.filter(([, init]) => init.method === 'POST')
  ).toHaveLength(1);
});

it('shows API errors without submitting a package job', async () => {
  request.mockResolvedValueOnce(
    respond({ error: 'Not authorized' }, false, 403)
  );
  await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
    'Not authorized'
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([null, [], [{ id: 'other', path: '/tmp/other' }]])(
  'rejects an unregistered workspace',
  async workspaces => {
    request
      .mockResolvedValueOnce(respond({ mode: 'local' }))
      .mockResolvedValueOnce(respond(workspaces));
    await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
      'Workspace not found'
    );
    expect(request).toHaveBeenCalledTimes(2);
  }
);

it('rejects team mode', async () => {
  request.mockResolvedValueOnce(respond({ mode: 'team' }));
  await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
    'local mode'
  );
});

it.each([
  { ...args, environment: 'other' },
  { ...args, missingDependencies: [''] },
  { ...args, missingDependencies: [] }
])('rejects unsupported repairs before making requests', async invalid => {
  await expect(repairNebiEnvironment(invalid, [], trans)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it('rejects a missing job ID without polling or verifying a version', async () => {
  setup({ id: '', status: 'pending' });
  await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
    'no job ID'
  );
  expect(request).toHaveBeenCalledTimes(3);
  expect(jest.getTimerCount()).toBe(0);
});

it('translates the HTTP fallback when Nebi returns a non-JSON error', async () => {
  const translate = trans.__.bind(trans);
  jest
    .spyOn(trans, '__')
    .mockImplementation((...values) => `translated: ${translate(...values)}`);
  request.mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => {
      throw new SyntaxError('Not JSON');
    }
  });
  await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
    'translated: Nebi request failed (HTTP 503)'
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it('translates repair validation and saved-version errors', async () => {
  const translate = trans.__.bind(trans);
  jest
    .spyOn(trans, '__')
    .mockImplementation((...values) => `translated: ${translate(...values)}`);
  await expect(
    repairNebiEnvironment({ ...args, missingDependencies: [] }, [], trans)
  ).rejects.toThrow('translated: No automatic repair is available.');
  expect(request).not.toHaveBeenCalled();

  setup(undefined, []);
  await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
    'translated: Could not verify the repair version.'
  );
});

it('shows the original job error when translation is active', async () => {
  const translate = trans.__.bind(trans);
  jest
    .spyOn(trans, '__')
    .mockImplementation((...values) => `translated: ${translate(...values)}`);
  setup({ id: 'job', status: 'failed', error: 'Original Nebi error' });
  await expect(repairNebiEnvironment(args, [], trans)).rejects.toThrow(
    /^Original Nebi error$/
  );
});

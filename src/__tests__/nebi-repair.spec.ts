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
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('submits packages and verifies the newest saved version belongs to its job', async () => {
  setup(undefined, [
    { version_number: 2, job_id: 'job/id' },
    { version_number: 1, job_id: 'old' }
  ]);
  await repairNebiEnvironment(args, ['ipykernel'], trans);
  expect(request.mock.calls.map(([path]) => path)).toEqual([
    url + 'version',
    url + 'workspaces',
    url + 'workspaces/workspace%2Fid/packages',
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

it.each([
  { ...args, missingDependencies: [''] },
  { ...args, missingDependencies: [] }
])('rejects unsupported repairs before making requests', async invalid => {
  await expect(repairNebiEnvironment(invalid, [], trans)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
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

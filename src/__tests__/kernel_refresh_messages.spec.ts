jest.mock('../handler', () => ({
  refreshKernelsWithInvalidation: jest.fn(() => Promise.resolve())
}));

import { refreshKernelsWithInvalidation } from '../handler';
import { addKernelRefreshMessageListener } from '../kernel-refresh-messages';

const MESSAGE_TYPE = 'provider:job-completed';

function createApp() {
  return {
    serviceManager: {
      kernelspecs: {
        refreshSpecs: jest.fn(() => Promise.resolve())
      }
    }
  };
}

async function flushPromises(turns = 2): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

describe('kernel refresh messages', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.mocked(refreshKernelsWithInvalidation).mockResolvedValue(undefined);
  });

  it('refreshes kernels when a configured message comes from the same origin', async () => {
    const app = createApp();
    const removeListener = addKernelRefreshMessageListener(app as never, [
      MESSAGE_TYPE
    ]);

    try {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: {
            type: MESSAGE_TYPE,
            jobType: 'env_install',
            workspace: 'ws-1'
          }
        })
      );

      await flushPromises(6);

      expect(refreshKernelsWithInvalidation).toHaveBeenCalledTimes(1);
      expect(app.serviceManager.kernelspecs.refreshSpecs).toHaveBeenCalledTimes(
        1
      );
    } finally {
      removeListener();
    }
  });

  it('ignores unconfigured and cross-origin messages', async () => {
    const app = createApp();
    const removeListener = addKernelRefreshMessageListener(app as never, [
      MESSAGE_TYPE
    ]);

    try {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: 'something-else' }
        })
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://example.com',
          data: { type: MESSAGE_TYPE }
        })
      );

      await flushPromises();

      expect(refreshKernelsWithInvalidation).not.toHaveBeenCalled();
      expect(
        app.serviceManager.kernelspecs.refreshSpecs
      ).not.toHaveBeenCalled();
    } finally {
      removeListener();
    }
  });

  it('coalesces refreshes while one is already running', async () => {
    const app = createApp();
    let resolveRefresh: () => void;
    const firstRefresh = new Promise<void>(resolve => {
      resolveRefresh = resolve;
    });
    jest
      .mocked(refreshKernelsWithInvalidation)
      .mockReturnValueOnce(firstRefresh);
    const removeListener = addKernelRefreshMessageListener(app as never, [
      MESSAGE_TYPE
    ]);

    try {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: MESSAGE_TYPE }
        })
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: MESSAGE_TYPE }
        })
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: MESSAGE_TYPE }
        })
      );

      expect(refreshKernelsWithInvalidation).toHaveBeenCalledTimes(1);

      resolveRefresh!();
      await flushPromises(6);

      expect(refreshKernelsWithInvalidation).toHaveBeenCalledTimes(2);
      expect(app.serviceManager.kernelspecs.refreshSpecs).toHaveBeenCalledTimes(
        2
      );
    } finally {
      removeListener();
    }
  });

  it('logs refresh failures without skipping the client refresh', async () => {
    const error = new Error('boom');
    jest.mocked(refreshKernelsWithInvalidation).mockRejectedValueOnce(error);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const app = createApp();
    const removeListener = addKernelRefreshMessageListener(app as never, [
      MESSAGE_TYPE
    ]);

    try {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: MESSAGE_TYPE }
        })
      );

      await flushPromises();

      expect(app.serviceManager.kernelspecs.refreshSpecs).toHaveBeenCalledTimes(
        1
      );
      expect(consoleError).toHaveBeenCalledWith(
        'Could not refresh kernels after completion message',
        error
      );
    } finally {
      removeListener();
      consoleError.mockRestore();
    }
  });
});

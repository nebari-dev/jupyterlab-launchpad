jest.mock('../handler', () => ({
  refreshKernelsWithInvalidation: jest.fn(() => Promise.resolve())
}));

import { refreshKernelsWithInvalidation } from '../handler';
import {
  addKernelRefreshMessageListener,
  KERNEL_REFRESH_MESSAGE_TYPES
} from '../kernel-refresh-messages';

function createApp() {
  return {
    serviceManager: {
      kernelspecs: {
        refreshSpecs: jest.fn(() => Promise.resolve())
      }
    }
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('kernel refresh messages', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes kernels when a configured message comes from the same origin', async () => {
    const app = createApp();
    const removeListener = addKernelRefreshMessageListener(app as never);

    try {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: {
            type: KERNEL_REFRESH_MESSAGE_TYPES[0],
            jobType: 'env_install',
            workspace: 'ws-1'
          }
        })
      );

      await flushPromises();

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
    const removeListener = addKernelRefreshMessageListener(app as never);

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
          data: { type: KERNEL_REFRESH_MESSAGE_TYPES[0] }
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
});

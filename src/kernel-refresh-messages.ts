import type { JupyterFrontEnd } from '@jupyterlab/application';
import { refreshKernelSpecs } from './kernel-refresh';

function getMessageType(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const type = (data as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

export function addKernelRefreshMessageListener(
  app: JupyterFrontEnd,
  messageTypes: readonly string[],
  shouldRefreshOnVisible?: () => boolean
): () => void {
  const acceptedMessageTypes = new Set(messageTypes);
  let inFlight: Promise<void> | null = null;
  let pending = false;

  const run = () => {
    if (inFlight) {
      pending = true;
      return;
    }

    inFlight = refreshKernelSpecs(app)
      .catch(error => {
        console.error(
          'Could not refresh kernels after a Nebi workspace change',
          error
        );
      })
      .finally(() => {
        inFlight = null;
        if (pending) {
          pending = false;
          run();
        }
      });
  };

  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const type = getMessageType(event.data);
    if (!type || !acceptedMessageTypes.has(type)) {
      return;
    }

    run();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && shouldRefreshOnVisible?.()) {
      run();
    }
  };

  window.addEventListener('message', listener);
  if (shouldRefreshOnVisible) {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return () => {
    window.removeEventListener('message', listener);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

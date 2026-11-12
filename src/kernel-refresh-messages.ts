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
  messageTypes: readonly string[]
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
          'Could not refresh kernels after completion message',
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

  window.addEventListener('message', listener);
  return () => {
    window.removeEventListener('message', listener);
  };
}

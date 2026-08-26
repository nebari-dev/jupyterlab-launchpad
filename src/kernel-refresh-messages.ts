import type { JupyterFrontEnd } from '@jupyterlab/application';
import { refreshKernelSpecs } from './kernel-refresh';

export const KERNEL_REFRESH_MESSAGE_TYPES = ['nebi:job-completed'] as const;

function getMessageType(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const type = (data as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

export function addKernelRefreshMessageListener(
  app: JupyterFrontEnd,
  messageTypes: readonly string[] = KERNEL_REFRESH_MESSAGE_TYPES
): () => void {
  const acceptedMessageTypes = new Set(messageTypes);

  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const type = getMessageType(event.data);
    if (!type || !acceptedMessageTypes.has(type)) {
      return;
    }

    void refreshKernelSpecs(app).catch(error => {
      console.error(
        'Could not refresh kernels after completion message',
        error
      );
    });
  };

  window.addEventListener('message', listener);
  return () => {
    window.removeEventListener('message', listener);
  };
}

import type { JupyterFrontEnd } from '@jupyterlab/application';
import { refreshKernelsWithInvalidation } from './handler';

export async function refreshKernelSpecs(app: JupyterFrontEnd): Promise<void> {
  let invalidationError: unknown;
  try {
    await refreshKernelsWithInvalidation();
  } catch (error) {
    invalidationError = error;
  }

  await app.serviceManager.kernelspecs.refreshSpecs();

  if (invalidationError) {
    throw invalidationError;
  }
}

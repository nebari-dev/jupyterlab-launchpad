import type { JupyterFrontEnd } from '@jupyterlab/application';
import { refreshKernelsWithInvalidation } from './handler';

export async function refreshKernelSpecs(app: JupyterFrontEnd): Promise<void> {
  await refreshKernelsWithInvalidation();
  await app.serviceManager.kernelspecs.refreshSpecs();
}

import { INewLauncher, ISectionOptions } from './types';
import { LauncherModel } from '@jupyterlab/launcher';

export class NewModel extends LauncherModel implements INewLauncher {
  addSection(options: ISectionOptions) {
    this.sections.push(options);
  }
  sections: ISectionOptions[] = [];
}

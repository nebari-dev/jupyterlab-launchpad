import { INewLauncher, ISectionOptions } from './types';
import { ISignal, Signal } from '@lumino/signaling';
import { LauncherModel } from '@jupyterlab/launcher';

export class NewModel extends LauncherModel implements INewLauncher {
  sections: ISectionOptions[] = [];
  addSection(options: ISectionOptions) {
    this.sections.push(options);
    this._sectionAdded.emit();
  }
  get sectionAdded(): ISignal<NewModel, void> {
    return this._sectionAdded;
  }
  private _sectionAdded = new Signal<NewModel, void>(this);
}

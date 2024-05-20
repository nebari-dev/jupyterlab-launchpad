import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { TranslationBundle } from '@jupyterlab/translation';
import { CommandIDs } from './types';
import { ISettingsLayout } from './types';

export function addCommands(
  app: JupyterFrontEnd,
  trans: TranslationBundle,
  settings: ISettingRegistry.ISettings
) {
  app.commands.addCommand(CommandIDs.toggleColumn, {
    label: args => {
      if (args.label) {
        return args.label as string;
      }
      if (args.id) {
        const id = args.id as string;
        return id[0].toLocaleUpperCase() + id.substring(1);
      }
      return trans.__('Toggle given column');
    },
    execute: async args => {
      const id = args.id as string | undefined;
      if (!id) {
        return console.error('Column ID missing');
      }
      const columns =
        (settings.composite.hiddenColumns as
          | ISettingsLayout['hiddenColumns']
          | undefined) ?? {};
      if (columns[id] === 'visible' || !columns[id]) {
        columns[id] = 'hidden';
      } else {
        columns[id] = 'visible';
      }
      await settings.set('hiddenColumns', columns);
    },
    isToggleable: true,
    isToggled: args => {
      const id = args.id as string | undefined;
      if (!id) {
        console.error('Column ID missing for checking if toggled');
        return false;
      }
      const columns =
        (settings.composite.hiddenColumns as
          | ISettingsLayout['hiddenColumns']
          | undefined) ?? {};
      return columns[id] !== 'hidden';
    }
  });
  app.commands.addCommand(CommandIDs.moveColumn, {
    label: args => {
      if (args.direction === 'left') {
        return trans.__('Move Column Left');
      } else if (args.direction === 'right') {
        return trans.__('Move Column Right');
      } else {
        return trans.__('Move column left or right');
      }
    },
    execute: async args => {
      const order = args.order as ISettingsLayout['columnOrder'];
      const id = args.id as string;
      const pos = order.indexOf(id);
      const shift = args.direction === 'left' ? -1 : +1;
      const newPos = pos + shift;
      if (newPos < 0 || newPos >= order.length) {
        console.log('Cannot move the column any further');
        return;
      }
      const replacement = order[newPos];
      order[newPos] = id;
      order[pos] = replacement;
      await settings.set('columnOrder', order);
    }
  });
}

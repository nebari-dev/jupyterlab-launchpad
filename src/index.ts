// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
import {
  ILabShell,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette, MainAreaWidget } from '@jupyterlab/apputils';
import { FileBrowserModel, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { ILauncher, LauncherModel } from '@jupyterlab/launcher';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStateDB } from '@jupyterlab/statedb';
import { ITranslator } from '@jupyterlab/translation';
import { addIcon, launcherIcon } from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { DockPanel, TabBar, Widget } from '@lumino/widgets';
import { NewLauncher as Launcher } from './launcher';
import { LastUsedDatabase } from './last_used';
import { FavoritesDatabase } from './favorites';

/**
 * The command IDs used by the launcher plugin.
 */
namespace CommandIDs {
  export const create = 'launcher:create';
}

/**
 * Initialization data for the jupyterlab-new-launcher extension.
 */
const plugin: JupyterFrontEndPlugin<ILauncher> = {
  id: 'jupyterlab-new-launcher:plugin',
  description: 'A redesigned JupyterLab launcher',
  provides: ILauncher,
  autoStart: true,
  requires: [ITranslator, IStateDB],
  optional: [ILabShell, ICommandPalette, IDefaultFileBrowser, ISettingRegistry],
  activate
};

export default plugin;

/**
 * Activate the launcher.
 */
function activate(
  app: JupyterFrontEnd,
  translator: ITranslator,
  stateDB: IStateDB,
  labShell: ILabShell | null,
  palette: ICommandPalette | null,
  defaultBrowser: IDefaultFileBrowser | null,
  settingRegistry: ISettingRegistry | null
): ILauncher {
  const { commands, shell } = app;
  const trans = translator.load('jupyterlab-new-launcher');
  const model = new LauncherModel();

  console.log('JupyterLab extension jupyterlab-new-launcher is activated!');

  if (settingRegistry) {
    settingRegistry
      .load(plugin.id)
      .then(settings => {
        console.log(
          'jupyterlab-new-launcher settings loaded:',
          settings.composite
        );
      })
      .catch(reason => {
        console.error(
          'Failed to load settings for jupyterlab-new-launcher.',
          reason
        );
      });
  }

  const lastUsedDatabase = new LastUsedDatabase({
    stateDB,
    fetchInterval: 10000
  });
  const favoritesDatabase = new FavoritesDatabase();

  commands.addCommand(CommandIDs.create, {
    label: trans.__('New Launcher'),
    icon: args => (args.toolbar ? addIcon : undefined),
    execute: (args: ReadonlyPartialJSONObject) => {
      const cwd = (args['cwd'] as string) ?? defaultBrowser?.model.path ?? '';
      const id = `launcher-${Private.id++}`;
      const callback = (item: Widget) => {
        // If widget is attached to the main area replace the launcher
        if (find(shell.widgets('main'), w => w === item)) {
          shell.add(item, 'main', { ref: id });
          launcher.dispose();
        }
      };
      const launcher = new Launcher({
        model,
        cwd,
        callback,
        commands,
        translator,
        lastUsedDatabase,
        favoritesDatabase
      });

      launcher.model = model;
      launcher.title.icon = launcherIcon;
      launcher.title.label = trans.__('Launcher');

      const main = new MainAreaWidget({ content: launcher });

      // If there are any other widgets open, remove the launcher close icon.
      main.title.closable = !!Array.from(shell.widgets('main')).length;
      main.id = id;

      shell.add(main, 'main', {
        activate: args['activate'] as boolean,
        ref: args['ref'] as string
      });

      if (labShell) {
        labShell.layoutModified.connect(() => {
          // If there is only a launcher open, remove the close icon.
          main.title.closable = Array.from(labShell.widgets('main')).length > 1;
        }, main);
      }

      if (defaultBrowser) {
        const onPathChanged = (model: FileBrowserModel) => {
          launcher.cwd = model.path;
        };
        defaultBrowser.model.pathChanged.connect(onPathChanged);
        launcher.disposed.connect(() => {
          defaultBrowser.model.pathChanged.disconnect(onPathChanged);
        });
      }

      return main;
    }
  });

  if (labShell) {
    void Promise.all([app.restored, defaultBrowser?.model.restored]).then(
      () => {
        function maybeCreate() {
          // Create a launcher if there are no open items.
          if (labShell!.isEmpty('main')) {
            void commands.execute(CommandIDs.create);
          }
        }
        // When layout is modified, create a launcher if there are no open items.
        labShell.layoutModified.connect(() => {
          maybeCreate();
        });
      }
    );
  }

  if (palette) {
    palette.addItem({
      command: CommandIDs.create,
      category: trans.__('Launcher')
    });
  }

  if (labShell) {
    labShell.addButtonEnabled = true;
    labShell.addRequested.connect((sender: DockPanel, arg: TabBar<Widget>) => {
      // Get the ref for the current tab of the tabbar which the add button was clicked
      const ref =
        arg.currentTitle?.owner.id ||
        arg.titles[arg.titles.length - 1].owner.id;

      return commands.execute(CommandIDs.create, { ref });
    });
  }

  return model;
}

/**
 * The namespace for module private data.
 */
namespace Private {
  /**
   * The incrementing id used for launcher widgets.
   */
  // There is a bug in `prefer-const` for exported let, see:
  // - https://github.com/typescript-eslint/typescript-eslint/issues/4572
  // - https://github.com/typescript-eslint/typescript-eslint/issues/4573
  export let id = 0; // eslint-disable-line prefer-const
}

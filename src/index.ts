// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
import {
  ILabShell,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette, MainAreaWidget } from '@jupyterlab/apputils';
import { FileBrowserModel, IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { ILauncher } from '@jupyterlab/launcher';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import { addIcon, launcherIcon } from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { DockPanel, TabBar, Widget } from '@lumino/widgets';
import { NewLauncher as Launcher } from './launcher';
import { NewModel as Model } from './model';
import {
  CommandIDs,
  ILauncherDatabase,
  INewLauncher,
  MAIN_PLUGIN_ID
} from './types';
import { addCommands } from './commands';
import { sessionDialogsPlugin } from './dialogs';
import { databasePlugin } from './database';
import webkitCSSPatch from '../style/webkit.raw.css';

/**
 * Initialization data for the jupyterlab-new-launcher extension.
 */
const launcherPlugin: JupyterFrontEndPlugin<ILauncher> = {
  id: MAIN_PLUGIN_ID,
  description: 'A redesigned JupyterLab launcher',
  provides: ILauncher,
  autoStart: true,
  requires: [ITranslator, ISettingRegistry, ILauncherDatabase],
  optional: [ILabShell, ICommandPalette, IDefaultFileBrowser],
  activate
};

export default [launcherPlugin, sessionDialogsPlugin, databasePlugin];

function createStyleSheet(text: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.setAttribute('type', 'text/css');
  style.appendChild(document.createTextNode(text));
  return style;
}

/**
 * Activate the launcher.
 */
function activate(
  app: JupyterFrontEnd,
  translator: ITranslator,
  settingRegistry: ISettingRegistry,
  database: ILauncherDatabase,
  labShell: ILabShell | null,
  palette: ICommandPalette | null,
  defaultBrowser: IDefaultFileBrowser | null
): INewLauncher {
  const { commands, shell } = app;
  const trans = translator.load('jupyterlab-new-launcher');
  const model = new Model();

  if (
    navigator.userAgent.indexOf('AppleWebKit') !== -1 &&
    navigator.userAgent.indexOf('Chrome') === -1
  ) {
    const style = createStyleSheet(webkitCSSPatch);
    document.body.appendChild(style);
  }

  settingRegistry.load(MAIN_PLUGIN_ID).then(settings => {
    addCommands(app, trans, settings);
  });

  // Detect kernels started outside of the launcher, e.g. automatically due to having notebooks open from previous session
  const lastSessionActivity: Record<string, string> = {};
  const recordSessionActivity = async () => {
    const models = [...app.serviceManager.sessions.running()];
    for (const model of models) {
      if (!model.kernel) {
        continue;
      }
      let command: string;
      if (model.type === 'notebook') {
        command = 'notebook:create-new';
      } else if (model.type === 'console') {
        command = 'console:create';
      } else {
        command = 'unknown';
      }
      const key = command + '-' + model.kernel.name;
      const activity = model.kernel.last_activity;
      if (activity && lastSessionActivity[key] !== activity) {
        lastSessionActivity[key] = activity;
        const item = {
          command,
          args: {
            isLauncher: true,
            kernelName: model.kernel.name
          }
        };
        await database.lastUsed.recordAsUsed(item, new Date(activity));
      }
    }
  };
  app.serviceManager.sessions.ready.then(recordSessionActivity);
  app.serviceManager.sessions.runningChanged.connect(recordSessionActivity);

  commands.addCommand(CommandIDs.create, {
    label: trans.__('New Launcher'),
    icon: args => (args.toolbar ? addIcon : undefined),
    execute: async (args: ReadonlyPartialJSONObject) => {
      const cwd = (args['cwd'] as string) ?? defaultBrowser?.model.path ?? '';
      const id = `launcher-${Private.id++}`;
      const callback = (item: Widget) => {
        // If widget is attached to the main area replace the launcher
        if (find(shell.widgets('main'), w => w === item)) {
          shell.add(item, 'main', { ref: id });
          launcher.dispose();
        }
      };

      const settings = await settingRegistry.load(MAIN_PLUGIN_ID);
      await Promise.all([database.lastUsed.ready, database.favorites.ready]);

      const launcher = new Launcher({
        model,
        cwd,
        callback,
        commands,
        translator,
        lastUsedDatabase: database.lastUsed,
        favoritesDatabase: database.favorites,
        settings
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

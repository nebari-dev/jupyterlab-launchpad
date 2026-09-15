// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { CommandRegistry } from '@lumino/commands';
import type { ISignal } from '@lumino/signaling';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ILauncher, Launcher } from '@jupyterlab/launcher';
import { TranslationBundle } from '@jupyterlab/translation';
import { FilterBox } from '@jupyterlab/ui-components';

import * as React from 'react';
import { NewModel } from './model';
import {
  IItem,
  IKernelItem,
  ILastUsedDatabase,
  IFavoritesDatabase,
  ISettingsLayout,
  ISectionOptions,
  ILaunchpadKernelTable
} from './types';
import { folderOutlineIcon } from './icons';
import { Item } from './item';
import { KernelTable } from './components/table';
import { CollapsibleSection } from './components/section';
import { TypeCard } from './components/card';
import { QuickSettings } from './components/quick-settings';

function LauncherBody(props: {
  trans: TranslationBundle;
  cwd: string;
  typeItems: IItem[];
  notebookItems: IKernelItem[];
  consoleItems: IKernelItem[];
  otherItems: IItem[];
  commands: CommandRegistry;
  settings: ISettingRegistry.ISettings;
  favouritesChanged: ISignal<IFavoritesDatabase, void>;
  lastUsedChanged: ISignal<ILastUsedDatabase, void>;
  kernelTable: ILaunchpadKernelTable;
  sections: ISectionOptions[];
}): React.ReactElement {
  const { trans, cwd, typeItems, commands, otherItems, favouritesChanged } =
    props;
  const [query, updateQuery] = React.useState<string>('');
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [showCreateEmpty, updateCreateEmpty] = React.useState<
    ISettingsLayout['createEmptySection']
  >(
    props.settings.composite
      .createEmptySection as ISettingsLayout['createEmptySection']
  );
  const [showStarred, updateShowStarred] = React.useState<
    ISettingsLayout['starredSection']
  >(
    props.settings.composite.starredSection as ISettingsLayout['starredSection']
  );
  const [showNotebookLauncher, updateShowNotebookLauncher] = React.useState<
    ISettingsLayout['launchNotebookSection']
  >(
    props.settings.composite
      .launchNotebookSection as ISettingsLayout['launchNotebookSection']
  );
  const [showConsole, updateShowConsole] = React.useState<
    ISettingsLayout['launchConsoleSection']
  >(
    props.settings.composite
      .launchConsoleSection as ISettingsLayout['launchConsoleSection']
  );

  const [searchAll, updateSearchAll] = React.useState<
    ISettingsLayout['searchAllSections']
  >(
    props.settings.composite
      .searchAllSections as ISettingsLayout['searchAllSections']
  );

  const syncSettings = () => {
    const newShowCreateEmpty = props.settings.composite
      .createEmptySection as ISettingsLayout['createEmptySection'];
    if (showCreateEmpty !== newShowCreateEmpty) {
      updateCreateEmpty(newShowCreateEmpty);
    }
    const newStarred = props.settings.composite
      .starredSection as ISettingsLayout['starredSection'];
    if (showStarred !== newStarred) {
      updateShowStarred(newStarred);
    }
    const newShowConsole = props.settings.composite
      .launchConsoleSection as ISettingsLayout['launchConsoleSection'];
    if (showConsole !== newShowConsole) {
      updateShowConsole(newShowConsole);
    }
    const newShowNotebook = props.settings.composite
      .launchNotebookSection as ISettingsLayout['launchNotebookSection'];
    if (showNotebookLauncher !== newShowNotebook) {
      updateShowNotebookLauncher(newShowNotebook);
    }

    const newSearchAll = props.settings.composite
      .searchAllSections as ISettingsLayout['searchAllSections'];
    if (searchAll !== newSearchAll) {
      updateSearchAll(newSearchAll);
    }
  };

  React.useEffect(() => {
    props.settings.changed.connect(syncSettings);
    return () => {
      props.settings.changed.disconnect(syncSettings);
    };
  });

  // A favourites change can affect several visible sections, but one forced
  // render is enough to refresh all of them.
  const updateIfNeeded = () => {
    if (showCreateEmpty || showStarred || showNotebookLauncher || showConsole) {
      forceUpdate();
    }
  };

  React.useEffect(() => {
    favouritesChanged.connect(updateIfNeeded);
    return () => {
      favouritesChanged.disconnect(updateIfNeeded);
    };
  });

  const starred = [...props.notebookItems, ...props.consoleItems].filter(
    item => item.starred
  );

  const startCollapsed = props.settings.composite
    .collapsedSections as ISettingsLayout['collapsedSections'];
  const itemKey = (item: IItem) => item.command + JSON.stringify(item.args);
  const lowerCaseQuery = query.toLowerCase();

  const builtinSections: ISectionOptions[] = [];
  if (showCreateEmpty) {
    builtinSections.push({
      className: 'jp-Launcher-openByType',
      title: trans.__('Create or Launch'),
      id: 'create-empty',
      rank: 1,
      render: () =>
        typeItems
          .filter(
            item =>
              !lowerCaseQuery ||
              item.label.toLowerCase().includes(lowerCaseQuery)
          )
          .map(item => <TypeCard key={itemKey(item)} item={item} />)
    });
  }
  if (showStarred) {
    builtinSections.push({
      className: 'jp-Launcher-openByKernel',
      title: trans.__('Starred'),
      id: 'starred',
      rank: 2,
      render: () =>
        starred.length > 0 ? (
          <KernelTable
            items={starred}
            commands={props.commands}
            showSearchBox={!searchAll}
            searchPlaceholder={trans.__(
              'Search starred kernels and environments'
            )}
            showWidgetType={true}
            query={query}
            settings={props.settings}
            trans={trans}
            onClick={item => item.execute()}
            favouritesChanged={props.favouritesChanged}
            lastUsedChanged={props.lastUsedChanged}
            kernelTable={props.kernelTable}
          />
        ) : (
          trans.__('No starred items')
        )
    });
  }
  if (showNotebookLauncher) {
    builtinSections.push({
      className: 'jp-Launcher-openByKernel jp-Launcher-launchNotebook',
      title: trans.__('Create a new Notebook'),
      id: 'launch-notebook',
      rank: 3,
      render: () => (
        <KernelTable
          items={props.notebookItems}
          commands={props.commands}
          showSearchBox={!searchAll}
          searchPlaceholder={trans.__(
            'Search notebook kernels and environments'
          )}
          blankMessage={trans.__('No matching kernels found')}
          query={query}
          settings={props.settings}
          trans={trans}
          onClick={item => item.execute()}
          favouritesChanged={props.favouritesChanged}
          lastUsedChanged={props.lastUsedChanged}
          kernelTable={props.kernelTable}
        />
      )
    });
  }
  if (showConsole) {
    builtinSections.push({
      className: 'jp-Launcher-openByKernel jp-Launcher-launchConsole',
      title: trans.__('Launch a new Console'),
      description: trans.__(
        'Some environments only support console sessions, not notebooks'
      ),
      id: 'launch-console',
      rank: 5,
      render: () => (
        <KernelTable
          items={props.consoleItems}
          commands={props.commands}
          showSearchBox={!searchAll}
          searchPlaceholder={trans.__(
            'Search console kernels and environments'
          )}
          blankMessage={trans.__('No matching consoles found')}
          query={query}
          settings={props.settings}
          trans={trans}
          onClick={item => item.execute()}
          favouritesChanged={props.favouritesChanged}
          lastUsedChanged={props.lastUsedChanged}
          kernelTable={props.kernelTable}
        />
      )
    });
  }
  const allSections = [...builtinSections, ...props.sections];

  return (
    <div className="jp-LauncherBody">
      <div className="jp-NewLauncher-Header">
        <div className="jp-NewLauncher-TopBar">
          <div
            className="jp-Launcher-cwd"
            title={trans.__('New files save to: %1', cwd ? cwd : '/')}
          >
            <folderOutlineIcon.react
              className="jp-Launcher-cwdIcon"
              tag="span"
              aria-hidden="true"
            />
            <span>
              {trans.__('New files save to:')} <code>{cwd ? cwd : '/'}</code>
            </span>
          </div>
        </div>
        {searchAll ? (
          <div className="jp-Launcher-searchBox">
            <FilterBox
              placeholder={trans.__(
                'Search kernels, environments and applications'
              )}
              updateFilter={(_, query) => {
                updateQuery(query ?? '');
              }}
              initialQuery={''}
              useFuzzyFilter={false}
            />
          </div>
        ) : null}
      </div>
      <div className="jp-NewLauncher-OtherItems">
        {otherItems.map(item => (
          <TypeCard key={itemKey(item)} item={item} />
        ))}
        <QuickSettings commands={commands} trans={trans} />
      </div>
      {allSections
        .sort((a, b) => a.rank - b.rank)
        .map(section => (
          <CollapsibleSection
            className={section.className}
            title={section.title}
            description={section.description}
            emptyMessage={trans.__('No matches found')}
            key={section.id}
            open={startCollapsed[section.id] !== 'collapsed'}
          >
            {section.render()}
          </CollapsibleSection>
        ))}
    </div>
  );
}

export namespace NewLauncher {
  export interface IOptions extends ILauncher.IOptions {
    lastUsedDatabase: ILastUsedDatabase;
    favoritesDatabase: IFavoritesDatabase;
    kernelTable: ILaunchpadKernelTable;
    settings: ISettingRegistry.ISettings;
    model: NewModel;
  }
}

const SERVER_PROXY_COMMAND = 'server-proxy:open';
const DEFAULT_TYPE_COMMAND_RANK = Number.POSITIVE_INFINITY;

export class NewLauncher extends Launcher {
  constructor(options: NewLauncher.IOptions) {
    super(options);
    this.commands = options.commands;
    this.trans = this.translator.load('jupyterlab-launchpad');
    this._lastUsedDatabase = options.lastUsedDatabase;
    this._favoritesDatabase = options.favoritesDatabase;
    this._kernelTable = options.kernelTable;
    this._settings = options.settings;
    this._newModel = options.model;
    this._newModel.sectionAdded.connect(() => {
      this.update();
    });
  }
  private _lastUsedDatabase: ILastUsedDatabase;
  private _favoritesDatabase: IFavoritesDatabase;
  private _kernelTable: ILaunchpadKernelTable;
  private _newModel: NewModel;

  trans: TranslationBundle;

  renderCommand = (item: ILauncher.IItemOptions): IItem => {
    return new Item({
      item,
      cwd: this.cwd,
      commands: this.commands,
      lastUsedDatabase: this._lastUsedDatabase,
      favoritesDatabase: this._favoritesDatabase
    });
  };

  renderKernelCommand = (item: ILauncher.IItemOptions): IItem => {
    // note: do not use spread syntax here or object attributes will get frozen
    return this.renderCommand(item);
  };

  /**
   * Render the launcher to virtual DOM nodes.
   */
  protected render(): React.ReactElement<any> | null {
    // Bail if there is no model.
    if (!this.model) {
      return null;
    }

    const trans = this.trans;
    const items = [...this.model.items()];

    const notebookCategory = trans.__('Notebook');
    const consoleCategory = trans.__('Console');
    const kernelCategories = [notebookCategory, consoleCategory];

    const otherCommands = this._settings.composite
      .utilityCommands as ISettingsLayout['utilityCommands'];

    const otherItems = items
      .filter(item => otherCommands.includes(item.command))
      .map(this.renderCommand);

    // TODO: maybe better to filter out everything from default lab and re-populate the kernel categories manually to get more metadata?
    const nonKernelItems = items.filter(
      item =>
        ((!item.category || !kernelCategories.includes(item.category)) &&
          !otherCommands.includes(item.command)) ||
        item.command === SERVER_PROXY_COMMAND
    );
    const rankOverrides = {
      'terminal:create-new': 3, // TODO: replace with terminal which asks for environment choice?
      'fileeditor:create-new': 6,
      'fileeditor:create-new-markdown-file': 5
    };
    for (const item of nonKernelItems) {
      if (item.command in rankOverrides) {
        item.rank = rankOverrides[item.command as keyof typeof rankOverrides];
      }
    }
    const typeCommands = [
      {
        command: 'notebook:create-new',
        rank: 1
      },
      {
        command: 'console:create',
        rank: 4
      },
      ...nonKernelItems
    ].sort(
      (a, b) =>
        (a.rank ?? DEFAULT_TYPE_COMMAND_RANK) -
        (b.rank ?? DEFAULT_TYPE_COMMAND_RANK)
    );

    const notebookItems = items
      .filter(
        item =>
          item.category &&
          item.category === notebookCategory &&
          item.command !== SERVER_PROXY_COMMAND
      )
      .map(this.renderKernelCommand);

    const consoleItems = items
      .filter(
        item =>
          item.category &&
          item.category === consoleCategory &&
          item.command !== SERVER_PROXY_COMMAND
      )
      .map(this.renderKernelCommand);

    // TODO: only create items once or if changed; dispose of them too
    const typeItems: IItem[] = typeCommands.map(this.renderCommand);

    return (
      <LauncherBody
        trans={this.trans}
        cwd={this.cwd}
        commands={this.commands}
        typeItems={typeItems}
        notebookItems={notebookItems}
        consoleItems={consoleItems}
        otherItems={otherItems}
        settings={this._settings}
        favouritesChanged={this._favoritesDatabase.changed}
        lastUsedChanged={this._lastUsedDatabase.changed}
        kernelTable={this._kernelTable}
        sections={this._newModel.sections}
      />
    );
  }
  protected commands: CommandRegistry;
  private _settings: ISettingRegistry.ISettings;
}

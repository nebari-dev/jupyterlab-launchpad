// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { CommandRegistry } from '@lumino/commands';
import type { ISignal } from '@lumino/signaling';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ILauncher, Launcher } from '@jupyterlab/launcher';
import { TranslationBundle } from '@jupyterlab/translation';
import {
  FilterBox,
  notebookIcon,
  consoleIcon
} from '@jupyterlab/ui-components';
import * as React from 'react';
import { NewModel } from './model';
import {
  IItem,
  IKernelItem,
  ILastUsedDatabase,
  IFavoritesDatabase,
  ISettingsLayout,
  ISectionOptions
} from './types';
import { fileIcon, starIcon } from './icons';
import { Item } from './item';
import { KernelTable } from './components/table';
import { CollapsibleSection } from './components/section';
import { TypeCard } from './components/card';

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
  sections: ISectionOptions[];
}): React.ReactElement {
  const { trans, cwd, typeItems, otherItems, favouritesChanged } = props;
  const [query, updateQuery] = React.useState<string>('');
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [showStarred, updateShowStarred] = React.useState<
    ISettingsLayout['starredSection']
  >(
    props.settings.composite.starredSection as ISettingsLayout['starredSection']
  );

  const [searchAll, updateSearchAll] = React.useState<
    ISettingsLayout['searchAllSections']
  >(
    props.settings.composite
      .searchAllSections as ISettingsLayout['searchAllSections']
  );

  const syncSettings = () => {
    const newStarred = props.settings.composite
      .starredSection as ISettingsLayout['starredSection'];
    if (showStarred !== newStarred) {
      updateShowStarred(newStarred);
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

  if (favouritesChanged) {
    const updateIfNeeded = () => {
      if (showStarred) {
        forceUpdate();
      }
    };
    React.useEffect(() => {
      favouritesChanged.connect(updateIfNeeded);
      return () => {
        favouritesChanged.disconnect(updateIfNeeded);
      };
    });
  }

  const metadataAvailable = new Set<string>();
  for (const item of props.notebookItems) {
    const kernelMetadata = item.metadata?.kernel;
    if (!kernelMetadata) {
      continue;
    }
    for (const key of Object.keys(kernelMetadata)) {
      metadataAvailable.add(key);
    }
  }

  const starred = [...props.notebookItems, ...props.consoleItems].filter(
    item => item.starred
  );

  const startCollapsed = props.settings.composite
    .collapsedSections as ISettingsLayout['collapsedSections'];

  const builtinSections: ISectionOptions[] = [
    {
      className: 'jp-Launcher-openByType',
      title: trans.__('Create Empty'),
      icon: fileIcon,
      id: 'create-empty',
      rank: 1,
      render: () =>
        typeItems
          .filter(
            item =>
              !query ||
              item.label.toLowerCase().indexOf(query.toLowerCase()) !== -1
          )
          .map(item => <TypeCard item={item} trans={trans} />)
    },
    {
      className: 'jp-Launcher-openByKernel jp-Launcher-launchNotebook',
      title: trans.__('Launch New Notebook'),
      icon: notebookIcon,
      id: 'launch-notebook',
      rank: 3,
      render: () => (
        <KernelTable
          items={props.notebookItems}
          commands={props.commands}
          showSearchBox={!searchAll}
          query={query}
          settings={props.settings}
          trans={trans}
          onClick={item => item.execute()}
          favouritesChanged={props.favouritesChanged}
          lastUsedChanged={props.lastUsedChanged}
        />
      )
    },
    {
      className: 'jp-Launcher-openByKernel jp-Launcher-launchConsole',
      title: trans.__('Launch New Console'),
      icon: consoleIcon,
      id: 'launch-console',
      rank: 5,
      render: () => (
        <KernelTable
          items={props.consoleItems}
          commands={props.commands}
          showSearchBox={!searchAll}
          query={query}
          settings={props.settings}
          trans={trans}
          onClick={item => item.execute()}
          favouritesChanged={props.favouritesChanged}
          lastUsedChanged={props.lastUsedChanged}
        />
      )
    }
  ];
  if (showStarred) {
    builtinSections.push({
      className: 'jp-Launcher-openByKernel',
      title: trans.__('Starred'),
      icon: starIcon,
      id: 'starred',
      rank: 2,
      render: () =>
        starred.length > 0 ? (
          <KernelTable
            items={starred}
            commands={props.commands}
            showSearchBox={!searchAll}
            showWidgetType={true}
            query={query}
            settings={props.settings}
            trans={trans}
            onClick={item => item.execute()}
            favouritesChanged={props.favouritesChanged}
            lastUsedChanged={props.lastUsedChanged}
          />
        ) : (
          'No starred items'
        )
    });
  }
  const allSections = [...builtinSections, ...props.sections];

  return (
    <div className="jp-LauncherBody">
      <div className="jp-NewLauncher-TopBar">
        <div className="jp-Launcher-cwd">
          <h3>
            {trans.__('Current folder:')} <code>{cwd ? cwd : '/'}</code>
          </h3>
        </div>
        <div className="jp-NewLauncher-OtherItems">
          {otherItems.map(item => (
            <TypeCard item={item} trans={trans} />
          ))}
        </div>
      </div>
      {searchAll ? (
        <div className="jp-Launcher-searchBox">
          <FilterBox
            placeholder={trans.__('Filter')}
            updateFilter={(_, query) => {
              updateQuery(query ?? '');
            }}
            initialQuery={''}
            useFuzzyFilter={false}
          />
        </div>
      ) : null}
      {allSections
        .sort((a, b) => a.rank - b.rank)
        .map(section => (
          <CollapsibleSection
            className={section.className}
            title={section.title}
            icon={section.icon}
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
    settings: ISettingRegistry.ISettings;
    model: NewModel;
  }
}

const SERVER_PROXY_COMMAND = 'server-proxy:open';

export class NewLauncher extends Launcher {
  constructor(options: NewLauncher.IOptions) {
    super(options);
    this.commands = options.commands;
    this.trans = this.translator.load('jupyterlab-new-launcher');
    this._lastUsedDatabase = options.lastUsedDatabase;
    this._favoritesDatabase = options.favoritesDatabase;
    this._settings = options.settings;
    this._newModel = options.model;
    this._newModel.sectionAdded.connect(() => {
      this.update();
    });
  }
  private _lastUsedDatabase: ILastUsedDatabase;
  private _favoritesDatabase: IFavoritesDatabase;
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
    ].sort((a, b) => (a?.rank ?? 0) - (b?.rank ?? 0));

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
        sections={this._newModel.sections}
      />
    );
  }
  protected commands: CommandRegistry;
  private _settings: ISettingRegistry.ISettings;
}

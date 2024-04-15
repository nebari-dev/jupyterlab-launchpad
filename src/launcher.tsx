// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import type { CommandRegistry } from '@lumino/commands';
import type { VirtualElement } from '@lumino/virtualdom';
import { Time } from '@jupyterlab/coreutils';
import { ILauncher, Launcher } from '@jupyterlab/launcher';
import { TranslationBundle } from '@jupyterlab/translation';
import {
  classes,
  FilterBox,
  LabIcon,
  caretRightIcon,
  Table
} from '@jupyterlab/ui-components';
import * as React from 'react';
import { ILastUsedDatabase } from './last_used';

function TypeCard(props: {
  trans: TranslationBundle;
  item: IItem;
}): React.ReactElement {
  const { item } = props;
  return (
    <div
      onClick={() => item.execute()}
      className="jp-Launcher-TypeCard jp-LauncherCard"
      title={item.caption}
      tabIndex={0}
    >
      <div className="jp-LauncherCard-icon">
        <LabIcon.resolveReact
          icon={item.icon}
          iconClass={classes(item.iconClass, 'jp-Icon-cover')}
          stylesheet="launcherCard"
        />
      </div>
      <div className="jp-LauncherCard-label">
        <p>{item.label}</p>
      </div>
    </div>
  );
}

interface IItem extends ILauncher.IItemOptions {
  label: string;
  caption: string;
  icon: VirtualElement.IRenderer | undefined;
  iconClass: string;
  execute: () => Promise<void>;
  lastUsed: Date | null;
}

interface IKernelItem extends IItem {
  //kernel: string;
}

function CollapsibleSection(
  props: React.PropsWithChildren<{
    title: string;
    className: string;
    open: boolean;
  }>
) {
  const [open, setOpen] = React.useState<boolean>(props.open);

  const handleToggle = (event: { currentTarget: { open: boolean } }) =>
    setOpen(event.currentTarget.open);

  return (
    <details
      onToggle={handleToggle}
      className={classes(props.className, 'jp-CollapsibleSection')}
      open={open}
    >
      <summary>
        <div
          className="jp-CollapsibleSection-CollapserIconWrapper"
          aria-hidden="true"
        >
          <caretRightIcon.react className="jp-CollapsibleSection-CollapserIcon" />
        </div>
        <h3 className="jp-CollapsibleSection-Title">{props.title}</h3>
      </summary>
      <div className="jp-Launcher-CardGroup jp-Launcher-cardContainer">
        {props.children}
      </div>
    </details>
  );
}

function LauncherBody(props: {
  trans: TranslationBundle;
  cwd: string;
  typeItems: IItem[];
  notebookItems: IKernelItem[];
}): React.ReactElement {
  const { trans, cwd, typeItems } = props;
  const [query, updateQuery] = React.useState<string>('');
  const KernelTable = Table<IKernelItem>;

  return (
    <div className="jp-LauncherBody">
      <h2 className="jp-LauncherBody-Title">
        {trans.__('Launch New Session')}
      </h2>
      <div className="jp-Launcher-cwd">
        <h3>{cwd}</h3>
      </div>
      <div className="jp-Launcher-searchBox">
        <FilterBox
          placeholder={trans.__('Filter')}
          updateFilter={(fn, query) => {
            updateQuery(query ?? '');
          }}
          initialQuery={''}
          useFuzzyFilter={false}
        />
      </div>
      <CollapsibleSection
        className="jp-Launcher-openByType"
        title={trans.__('Open New by Type')}
        open={true} // TODO: store this in layout/state higher up
      >
        {typeItems
          .filter(
            item =>
              !query ||
              item.label.toLowerCase().indexOf(query.toLowerCase()) !== -1
          )
          .map(item => (
            <TypeCard item={item} trans={trans} />
          ))}
      </CollapsibleSection>
      <CollapsibleSection
        className="jp-Launcher-openByKernel"
        title={trans.__('Open New by Kernel')}
        open={true} // TODO: store this in layout/state higher up
      >
        <KernelTable
          rows={props.notebookItems
            .filter(
              kernel =>
                kernel.label.toLowerCase().indexOf(query.toLowerCase()) !== -1
            )
            .map(data => {
              return {
                data: data,
                key: data.command + JSON.stringify(data.args)
              };
            })}
          blankIndicator={() => {
            return <div>{trans.__('No entries')}</div>;
          }}
          sortKey={'kernel'}
          onRowClick={event => {
            const element = (event.target as HTMLElement).querySelector(
              '.jp-TableKernelItem'
            )!;
            (element as HTMLElement).click();
          }}
          columns={[
            {
              id: 'icon',
              label: trans.__('Icon'),
              renderCell: (row: IKernelItem) => (
                <div
                  className="jp-LauncherCard-icon"
                  onClick={() => row.execute()}
                >
                  {row.kernelIconUrl ? (
                    <img
                      src={row.kernelIconUrl}
                      className="jp-Launcher-kernelIcon"
                      alt={row.label}
                    />
                  ) : (
                    <div className="jp-LauncherCard-noKernelIcon">
                      {row.label[0].toUpperCase()}
                    </div>
                  )}
                </div>
              ),
              sort: (a: IKernelItem, b: IKernelItem) =>
                a.command.localeCompare(b.command)
            },
            {
              id: 'kernel',
              label: trans.__('Kernel'),
              renderCell: (row: IKernelItem) => (
                <span
                  className="jp-TableKernelItem"
                  onClick={row.execute}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      row.execute();
                    }
                  }}
                  tabIndex={0}
                >
                  {row.label}
                </span>
              ),
              sort: (a: IKernelItem, b: IKernelItem) =>
                a.label.localeCompare(b.label)
            },
            {
              id: 'last-used',
              label: trans.__('Last Used'),
              renderCell: (row: IKernelItem) => {
                return row.lastUsed ? (
                  <span title={Time.format(row.lastUsed)}>
                    {Time.formatHuman(row.lastUsed)}
                  </span>
                ) : (
                  trans.__('Never')
                );
              },
              sort: (a: IKernelItem, b: IKernelItem) => {
                if (a.lastUsed === b.lastUsed) {
                  return 0;
                }
                if (!a.lastUsed) {
                  return 1;
                }
                if (!b.lastUsed) {
                  return -1;
                }
                return a.lastUsed > b.lastUsed ? 1 : -1;
              }
            }
          ]}
        />
      </CollapsibleSection>
    </div>
  );
}

export namespace NewLauncher {
  export interface IOptions extends ILauncher.IOptions {
    lastUsedDatabase: ILastUsedDatabase;
  }
}

export class NewLauncher extends Launcher {
  constructor(options: NewLauncher.IOptions) {
    super(options);
    this.commands = options.commands;
    this.trans = this.translator.load('jupyterlab-new-launcher');
    this._lastUsedDatabase = options.lastUsedDatabase;
  }
  private _lastUsedDatabase: ILastUsedDatabase;
  trans: TranslationBundle;

  renderCommand = (item: ILauncher.IItemOptions): IItem => {
    const args = { ...item.args, cwd: this.cwd };
    const iconClass = this.commands.iconClass(item.command, args);
    const icon = this.commands.icon(item.command, args);
    const caption = this.commands.caption(item.command, args);
    const label = this.commands.label(item.command, args);
    const execute = async () => {
      await this.commands.execute(item.command, args);
      this._lastUsedDatabase.recordAsUsedNow(item);
    };
    const lastUsed = this._lastUsedDatabase.get(item);
    return { ...item, icon, iconClass, label, caption, execute, lastUsed };
  };

  renderKernelCommand = (item: ILauncher.IItemOptions): IItem => {
    return {
      ...this.renderCommand(item)
    };
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

    // TODO: maybe better to filter out everything from default lab and re-populate the kernel categories manually to get more metadata?
    const nonKernelItems = items.filter(
      item => !item.category || !kernelCategories.includes(item.category)
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
      .filter(item => item.category && item.category === notebookCategory)
      .map(this.renderKernelCommand);

    const typeItems: IItem[] = typeCommands.map(this.renderCommand);

    return (
      <LauncherBody
        trans={this.trans}
        cwd={this.cwd}
        typeItems={typeItems}
        notebookItems={notebookItems}
      />
    );
  }
  protected commands: CommandRegistry;
}

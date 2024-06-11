import { TranslationBundle } from '@jupyterlab/translation';
import type { CommandRegistry } from '@lumino/commands';
import { settingsIcon } from '@jupyterlab/ui-components';
import * as React from 'react';
import { Menu } from '@lumino/widgets';

import { CommandIDs } from '../types'


export function QuickSettings(props: {
  trans: TranslationBundle;
  commands: CommandRegistry;
}): React.ReactElement {
  const { commands } = props;

  const menu = new Menu({commands: commands})
  menu.addItem({ command: CommandIDs.showStarred, args: {} })
  menu.addItem({ command: CommandIDs.searchAllSections, args: {}} )
  menu.addItem({ command: 'settingeditor:open', args: { query: 'New Launcher' }})

  const iconRef = React.useRef<HTMLDivElement>(null)

  const onClickHandler = (event: React.MouseEvent) =>
    {
      const current = iconRef.current;
      var x, y
      if (current) {
        var position = current.getBoundingClientRect();
        x = position.left
        y = position.bottom
      } else {
        x = event.clientX
        y = event.clientY
      }
      menu.open(x, y)
    }

  return (
    <div className="jp-Launcher-TypeCard jp-LauncherCard"
         ref={iconRef}
         onClick={event => {
              onClickHandler(event)
            }}>
            <div className="jp-LauncherCard-icon">
              <settingsIcon.react/>
            </div>
          </div>
  );
}
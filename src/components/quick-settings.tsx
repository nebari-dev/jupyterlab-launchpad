import { TranslationBundle } from '@jupyterlab/translation';
import type { CommandRegistry } from '@lumino/commands';
import { MenuSvg, settingsIcon } from '@jupyterlab/ui-components';
import * as React from 'react';

import { CommandIDs } from '../types';

export function QuickSettings(props: {
  trans: TranslationBundle;
  commands: CommandRegistry;
}): React.ReactElement {
  const { commands } = props;

  const menu = new MenuSvg({ commands: commands });
  menu.addItem({ command: CommandIDs.showStarred });
  menu.addItem({ command: CommandIDs.searchAllSections });
  menu.addItem({ command: CommandIDs.openSettings });

  const iconRef = React.useRef<HTMLDivElement>(null);

  const onClickHandler = (event: React.MouseEvent) => {
    const current = iconRef.current;
    let x, y;
    if (current) {
      const position = current.getBoundingClientRect();
      x = position.left;
      y = position.bottom;
    } else {
      x = event.clientX;
      y = event.clientY;
    }
    menu.open(x, y);
  };

  return (
    <div
      className="jp-Launcher-TypeCard jp-LauncherCard jp-Launcher-QuickSettings"
      ref={iconRef}
      onClick={event => {
        onClickHandler(event);
      }}
    >
      <div className="jp-LauncherCard-icon">
        <settingsIcon.react />
      </div>
    </div>
  );
}

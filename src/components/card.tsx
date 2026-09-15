// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import { classes, LabIcon } from '@jupyterlab/ui-components';
import * as React from 'react';
import { IItem } from '../types';

export function TypeCard(props: { item: IItem }): React.ReactElement {
  const { item } = props;
  const label = item.label;
  const execute = () => {
    item.execute();
  };

  return (
    <div
      onClick={execute}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          execute();
        }
      }}
      className="jp-Launcher-TypeCard jp-LauncherCard"
      title={item.caption || label}
      data-command={item.command}
      data-label={label}
      role="button"
      tabIndex={0}
    >
      <div className="jp-LauncherCard-icon">
        {!item.icon && item.kernelIconUrl ? (
          <img
            src={item.kernelIconUrl}
            className="jp-Launcher-kernelIcon"
            alt={label}
          />
        ) : (
          <LabIcon.resolveReact
            icon={item.icon}
            iconClass={classes(item.iconClass, 'jp-Icon-cover')}
          />
        )}
      </div>
      <div className="jp-LauncherCard-label">
        <p>{label}</p>
      </div>
    </div>
  );
}

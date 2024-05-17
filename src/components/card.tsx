// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import { TranslationBundle } from '@jupyterlab/translation';
import { classes, LabIcon } from '@jupyterlab/ui-components';
import * as React from 'react';
import { IItem } from '../types';

export function TypeCard(props: {
  trans: TranslationBundle;
  item: IItem;
}): React.ReactElement {
  const { item } = props;
  return (
    <div
      onClick={() => item.execute()}
      className="jp-Launcher-TypeCard jp-LauncherCard"
      title={item.caption || item.label}
      tabIndex={0}
    >
      <div className="jp-LauncherCard-icon">
        <LabIcon.resolveReact
          icon={item.icon}
          iconClass={classes(item.iconClass, 'jp-Icon-cover')}
        />
      </div>
      <div className="jp-LauncherCard-label">
        <p>{item.label}</p>
      </div>
    </div>
  );
}

// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import { classes, LabIcon, caretRightIcon } from '@jupyterlab/ui-components';
import * as React from 'react';

export function CollapsibleSection(
  props: React.PropsWithChildren<{
    title: string;
    className: string;
    icon: LabIcon;
    open: boolean;
    onToggled?: (open: boolean) => void;
  }>
) {
  const [open, setOpen] = React.useState<boolean>(props.open);

  const handleToggle = (event: { currentTarget: { open: boolean } }) => {
    setOpen(event.currentTarget.open);
    if (props.onToggled) {
      props.onToggled(event.currentTarget.open);
    }
  };

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
        <props.icon.react
          tag="span"
          className="jp-CollapsibleSection-CategoryIcon"
        />
        <h3 className="jp-CollapsibleSection-Title">{props.title}</h3>
      </summary>
      <div className="jp-Launcher-CardGroup jp-Launcher-cardContainer">
        {props.children}
      </div>
    </details>
  );
}

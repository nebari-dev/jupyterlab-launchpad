// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.

import type { CommandRegistry } from '@lumino/commands';
import { ReadonlyJSONObject, ReadonlyJSONValue } from '@lumino/coreutils';
import {
  checkIcon,
  closeIcon,
  LabIcon,
  refreshIcon
} from '@jupyterlab/ui-components';
import * as React from 'react';
import { IColumnDescriptor } from './columns';

/**
 * Generic, domain-agnostic renderer for a data-driven column cell.
 *
 * The launcher owns *how* each `renderType` looks; the descriptor (supplied by
 * whichever provider emitted the metadata) owns *what* to show. No provider
 * name appears anywhere in this file.
 */
export function renderDescriptorCell(options: {
  descriptor: IColumnDescriptor;
  value: ReadonlyJSONValue | undefined;
  metadata: ReadonlyJSONObject | undefined;
  commands?: CommandRegistry;
}): React.ReactNode {
  const { descriptor, value, metadata, commands } = options;
  const tooltip =
    descriptor.tooltipKey && metadata
      ? asString(metadata[descriptor.tooltipKey])
      : undefined;

  switch (descriptor.renderType) {
    case 'badge':
      return renderBadge(descriptor, value, tooltip);
    case 'boolean':
      return renderBoolean(value);
    case 'version':
      return (
        <span className="jp-Launchpad-version" title={tooltip}>
          {asString(value) || '-'}
        </span>
      );
    case 'action':
      return renderAction(descriptor, metadata, commands);
    case 'text':
    default:
      return <span title={tooltip}>{asString(value) || '-'}</span>;
  }
}

const TONE_ICON: Record<string, LabIcon> = {
  success: checkIcon,
  danger: closeIcon,
  warning: refreshIcon
};

function renderBadge(
  descriptor: IColumnDescriptor,
  value: ReadonlyJSONValue | undefined,
  tooltip: string | undefined
): React.ReactNode {
  const raw = asString(value);
  if (!raw) {
    return '-';
  }
  const style = descriptor.badges?.[raw];
  const tone = style?.tone ?? 'neutral';
  const icon = TONE_ICON[tone];
  return (
    <span
      className={`jp-Launchpad-badge jp-Launchpad-badge-${tone}`}
      title={tooltip ?? descriptor.description}
    >
      {icon ? <icon.react tag="span" className="jp-Launchpad-badgeIcon" /> : null}
      {style?.label ?? raw}
    </span>
  );
}

function renderBoolean(value: ReadonlyJSONValue | undefined): React.ReactNode {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  const truthy = value === true || value === 'true';
  const icon = truthy ? checkIcon : closeIcon;
  return <icon.react tag="span" className="jp-Launchpad-boolIcon" />;
}

function renderAction(
  descriptor: IColumnDescriptor,
  metadata: ReadonlyJSONObject | undefined,
  commands: CommandRegistry | undefined
): React.ReactNode {
  const action = descriptor.action;
  if (!action || !commands) {
    return '-';
  }
  const enabled = commands.isEnabled(action.commandId, metadata ?? {});
  if (!enabled) {
    return '-';
  }
  return (
    <button
      className="jp-Launchpad-rowAction jp-mod-styled"
      onClick={() => void commands.execute(action.commandId, metadata ?? {})}
    >
      {action.label ?? commands.label(action.commandId, metadata ?? {})}
    </button>
  );
}

function asString(value: ReadonlyJSONValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(asString).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

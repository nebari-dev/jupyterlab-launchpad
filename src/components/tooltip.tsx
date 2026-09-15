// Copyright (c) Nebari Development Team.
// Distributed under the terms of the Modified BSD License.
import * as React from 'react';

const TOOLTIP_OFFSET = 12;

export function LaunchpadTooltip(
  props: React.PropsWithChildren<{
    className?: string;
    label: string;
  }>
): React.ReactElement {
  const tooltipId = React.useId();
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const className = props.className
    ? `jp-LaunchpadTooltipAnchor ${props.className}`
    : 'jp-LaunchpadTooltipAnchor';

  const updatePosition = React.useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    tooltip.style.left = `${Math.round(
      anchorRect.left + anchorRect.width / 2
    )}px`;
    tooltip.style.top = `${Math.round(anchorRect.top - TOOLTIP_OFFSET)}px`;
  }, []);

  const clearNativeTitles = React.useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    anchor.removeAttribute('title');
    anchor.querySelectorAll('[title]').forEach(node => {
      node.removeAttribute('title');
    });
  }, []);

  const hideTooltip = React.useCallback(() => {
    const tooltip = tooltipRef.current;
    if (tooltip) {
      tooltip.remove();
      tooltipRef.current = null;
    }
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
  }, [updatePosition]);

  const showTooltip = React.useCallback(() => {
    if (!anchorRef.current) {
      return;
    }
    clearNativeTitles();

    let tooltip = tooltipRef.current;
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = tooltipId;
      tooltip.className = 'jp-LaunchpadTooltip';
      tooltip.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltip);
      tooltipRef.current = tooltip;
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
    }

    tooltip.textContent = props.label;
    updatePosition();
  }, [clearNativeTitles, props.label, tooltipId, updatePosition]);

  React.useEffect(() => {
    return () => {
      hideTooltip();
    };
  }, [hideTooltip]);

  return (
    <span
      ref={anchorRef}
      className={className}
      aria-describedby={tooltipId}
      aria-label={props.label}
      onBlur={hideTooltip}
      onFocus={showTooltip}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          hideTooltip();
          event.stopPropagation();
        }
      }}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      tabIndex={0}
    >
      {props.children}
    </span>
  );
}

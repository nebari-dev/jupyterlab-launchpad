import { LabIcon } from '@jupyterlab/ui-components';
import arrowUpDownSvgstr from '../style/icons/md/arrow-up-down.svg';
import starSvgstr from '../style/icons/md/star.svg';
import folderOutlineSvgstr from '../style/icons/md/folder-outline.svg';
import infoCircleSvgstr from '../style/icons/md/info-circle.svg';
import updateAvailableSvgstr from '../style/icons/md/update-available.svg';
import codeServerSvgstr from '../style/icons/code-server.svg';
import nebiSvgstr from '../style/icons/nebi.svg';

export const arrowUpDownIcon = new LabIcon({
  name: 'jupyterlab-launchpad:arrow-up-down',
  svgstr: arrowUpDownSvgstr
});

export const starIcon = new LabIcon({
  name: 'jupyterlab-launchpad:star',
  svgstr: starSvgstr
});

export const folderOutlineIcon = new LabIcon({
  name: 'jupyterlab-launchpad:folder-outline',
  svgstr: folderOutlineSvgstr
});

export const infoCircleIcon = new LabIcon({
  name: 'jupyterlab-launchpad:info-circle',
  svgstr: infoCircleSvgstr
});

export const updateAvailableIcon = new LabIcon({
  name: 'jupyterlab-launchpad:update-available',
  svgstr: updateAvailableSvgstr
});

export const codeServerIcon = new LabIcon({
  name: 'jupyterlab-launchpad:code-server',
  svgstr: codeServerSvgstr
});

export const nebiIcon = new LabIcon({
  name: 'jupyterlab-launchpad:nebi',
  svgstr: nebiSvgstr
});

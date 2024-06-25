import { LabIcon } from '@jupyterlab/ui-components';
import starSvgstr from '../style/icons/md/star.svg';
import fileSvgstr from '../style/icons/md/file.svg';
import codeServerSvgstr from '../style/icons/code-server.svg';

export const starIcon = new LabIcon({
  name: 'jupyterlab-launchpad:star',
  svgstr: starSvgstr
});

export const fileIcon = new LabIcon({
  name: 'jupyterlab-launchpad:file',
  svgstr: fileSvgstr
});

export const codeServerIcon = new LabIcon({
  name: 'jupyterlab-launchpad:code-server',
  svgstr: codeServerSvgstr
});

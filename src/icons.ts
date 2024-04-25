import { LabIcon } from '@jupyterlab/ui-components';
import starSvgstr from '../style/icons/md/star.svg';
import fileSvgstr from '../style/icons/md/file.svg';

export const starIcon = new LabIcon({
  name: 'jupyterlab-new-launcher:star',
  svgstr: starSvgstr
});

export const fileIcon = new LabIcon({
  name: 'jupyterlab-new-launcher:file',
  svgstr: fileSvgstr
});

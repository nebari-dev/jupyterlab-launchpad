# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

<!-- <END NEW CHANGELOG ENTRY> -->

## `v1.2.1`

- Fix Attempt fix for Nebi environments without a kernel, add configurable kernel packages, and improve repair error notifications https://github.com/nebari-dev/jupyterlab-launchpad/pull/100
- Remove the workspace Version column https://github.com/nebari-dev/jupyterlab-launchpad/pull/103
- Hide Nebi columns by default when Nebi is unavailable, add a `nebi` installation extra, and refresh README screenshots with reproducible UI tests https://github.com/nebari-dev/jupyterlab-launchpad/pull/96
- Fix Nebi installation for discovered workspaces outside Jupyter's file browser root https://github.com/nebari-dev/jupyterlab-launchpad/pull/98

## `v1.2.0`

- Redesign Launchpad launcher experience https://github.com/nebari-dev/jupyterlab-launchpad/pull/87

## `v1.1.1`

- Refresh Launchpad kernels after Nebi workspace jobs complete https://github.com/nebari-dev/jupyterlab-launchpad/pull/87

## `v1.1.0`

- Add support for `nb-nebi-kernels` state metadata and add explicit refresh trigger by @MUFFANUJ in https://github.com/nebari-dev/jupyterlab-launchpad/pull/80

## `v1.0.5`

- Disable activity tracking on `DatabaseHandler` to allow idle server shutdown by @tylerpotts in https://github.com/nebari-dev/jupyterlab-launchpad/pull/78

## `v1.0.4`

- Add settings and menu items to toggle display of each section by @andrewfulton9 in https://github.com/nebari-dev/jupyterlab-launchpad/pull/71
- Improve alignment of quick settings menu by @Darshan808 in https://github.com/nebari-dev/jupyterlab-launchpad/pull/72
- Fix server-proxy launcher icons not rendering by @Adam-D-Lewis in https://github.com/nebari-dev/jupyterlab-launchpad/pull/74
- Use upstream `update-snapshots-checkout` by @krassowski in https://github.com/nebari-dev/jupyterlab-launchpad/pull/76

## `v1.0.3`

- Fix updating state in the running kernels table by @krassowski in https://github.com/nebari-dev/jupyterlab-launchpad/pull/70

## `v1.0.2`

- Updated integration tests update workflow by @krassowski in https://github.com/nebari-dev/jupyterlab-launchpad/pull/62
- Add a suggestion to restart after installation by @krassowski in https://github.com/nebari-dev/jupyterlab-launchpad/pull/67
- Fix kernel dialog sections sizing by @krassowski in https://github.com/nebari-dev/jupyterlab-launchpad/pull/69

## `v1.0.1`

- Fix migration from old settings by @krassowski in https://github.com/nebari-dev/jupyterlab-launchpad/pull/60

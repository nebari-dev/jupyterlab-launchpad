# RFC: data-driven launcher columns

## Problem

The launcher table turns every kernel-metadata key into a column. But the
*label*, *render style*, and *hidden-by-default* behaviour of those columns
live in a hard-coded `switch` (`columnLabelFromKey` in
`src/components/table.tsx`), which already carries `conda_*` special-cases from
`nb_conda_kernels`.

Any new metadata provider therefore has to patch launcher core to make its
columns render well: add label cases, add badge/colour logic, add row actions,
add hidden-column defaults, and (if it needs server actions) add request
handlers. That mixes provider concerns into a general-purpose component and
means the provider's vocabulary is baked into an upstream repo forever.

## Idea

Let a provider describe its own columns as **data**, and keep the launcher
domain-agnostic: it renders whatever descriptors it is handed. This mirrors how
**Ragna** selects assistants and how **JupyterHub** selects an authenticator —
by a dotted import path in config, not by a compiled plugin:

```python
# Ragna
assistants = ["my_module.MyAssistant"]
# JupyterHub
c.JupyterHub.authenticator_class = "oauthenticator.GitHubOAuthenticator"
```

The launcher's provider is already exactly this shape: a `KernelSpecManager`
subclass selected in `jupyter_server_config.py`:

```python
c.ServerApp.kernel_spec_manager_class = "nb_nebi_kernels.NebiKernelSpecManager"
```

So no new labextension is required. The provider just emits, alongside the
values it already stamps onto each kernel, a small block of column descriptors.

## The contract

A provider adds a reserved key `__launchpad_columns__` to its kernel metadata,
mapping each column key to a descriptor (`src/columns.ts`):

```jsonc
{
  "nebi_state": "remote-not-pulled",
  "nebi_local_version": "1.2.0",
  "nebi_remote_version": "1.3.0",
  "__launchpad_columns__": {
    "nebi_state": {
      "label": "Status",
      "renderType": "badge",
      "tooltipKey": "nebi_not_ready_reason",
      "badges": {
        "ready":             { "tone": "success" },
        "outdated":          { "tone": "warning", "label": "Outdated" },
        "remote-not-pulled": { "tone": "info",    "label": "Not pulled" },
        "local-not-installed": { "tone": "danger", "label": "Not installed" },
        "local-missing-deps":  { "tone": "danger", "label": "Missing deps" }
      }
    },
    "nebi_local_version":  { "label": "Local version",  "renderType": "version" },
    "nebi_remote_version": { "label": "Remote version", "renderType": "version" },
    "nebi_not_ready_reason": { "hidden": true },
    "nebi_pull": {
      "label": "Actions",
      "renderType": "action",
      "action": { "commandId": "launchpad:nebi-pull", "label": "Pull" }
    }
  }
}
```

The launcher reads this, renders a colour-coded badge with a paired icon (so
colour is never the only signal), highlights versions, hides the noisy reason
column, and shows an action button. **No provider name appears in launcher
core.**

### Render types

- `text` (default) - plain, ellipsised.
- `badge` - value looked up in `badges`, rendered with a semantic `tone`
  (`neutral`/`info`/`success`/`warning`/`danger`) that maps to a themeable CSS
  class plus an icon.
- `version` - highlighted version string.
- `boolean` - check / cross icon.
- `action` - a button that dispatches a JupyterLab command with the row's
  metadata as arguments. The command is owned by whoever contributed the
  descriptor, so the launcher never learns any provider verbs.

## Actions and server work

Row actions dispatch a **command** by id. The command (and any server endpoint
it calls, e.g. running `nebi pull`) lives in the provider's own package - for
Nebi, in `nb_nebi_kernels` (which already shells out to `nebi`/`pixi` and owns
that domain). The launcher only needs a generic "dispatch a registered
command" bridge, not provider-specific handlers.

## Column visibility

Which columns show by default is a `settings` concern. A deployment (e.g. a
Nebari software pack) can ship an `overrides.json` for
`jupyterlab-launchpad:launcher` to tune visibility per environment - again with
no rebuild of the launcher.

## What this PR contains

This is an **RFC / proof-of-concept sketch** to make the shape concrete for
discussion. It is intentionally small and has **not** been built or run
through CI yet:

- `src/columns.ts` - the descriptor contract, a `collectColumnDescriptors`
  helper, and an optional `ILauncherColumnRegistry` token for in-process
  contributors.
- `src/columnRenderer.tsx` - a generic, domain-agnostic cell renderer for the
  render types above.
- `src/components/table.tsx` - a minimal seam: descriptor label/render win when
  present, otherwise the existing behaviour is unchanged.
- `style/base.css` - badge styling hooks.

## Why not "just add nebi to the launcher"

Because the launcher is a fork tracking upstream `jupyterlab-new-launcher`, and
nebi has nothing to do with a general launcher. Keeping the launcher generic
means: one narrow extension seam to maintain upstream, provider vocabulary
stays in the provider, and rebasing on upstream never fights nebi code. The
only thing worth landing here is the *generic* seam; everything nebi-specific
stays in the config-selected provider.

# Integration Testing

This folder contains the integration tests of the extension.

They are defined using [Playwright](https://playwright.dev/docs/intro) test runner
and [Galata](https://github.com/jupyterlab/jupyterlab/tree/main/galata) helper.

The Playwright configuration is defined in [playwright.config.js](./playwright.config.js).

The JupyterLab server configuration to use for the integration test is defined
in [jupyter_server_test_config.py](./jupyter_server_test_config.py).

The Nebi repair tests in `tests/nebi_repair.spec.ts` use the real Launchpad
frontend and authenticated Jupyter Server Proxy requests. `nebi_test_fixtures.py` supplies
filesystem-backed kernel discovery, temporary Nebi/Pixi executables, and a local
Nebi API fixture through Jupyter Server Proxy. These tests do not install packages
or require a real Nebi service. No repair or discovery HTTP responses are
intercepted. After completing the setup below, run
`PYTHONPATH=.. jlpm playwright test nebi_repair.spec.ts` from this directory so the
server imports the Python package under test. If Playwright reuses an existing
server, that server must already use this checkout and the test configuration.
Two cropped notification snapshots cover the installation error and the
environment that remains unavailable after repair, so truncated or clipped
messages can be reviewed visually. Generate these baselines on Linux to match CI.

The default configuration will produce video for failing tests and an HTML report.

> There is a new experimental UI mode that you may fall in love with; see [that video](https://www.youtube.com/watch?v=jF0yA-JLQW0).

## Run the tests

> All commands are assumed to be executed from the root directory

To run the tests, you need to:

1. Compile the extension:

```sh
jlpm install
jlpm build:prod
```

> Check the extension is installed in JupyterLab.

2. Install test dependencies (needed only once):

```sh
python -m pip install -e ".[test]"
cd ./ui-tests
jlpm install
jlpm playwright install
cd ..
```

3. Execute the [Playwright](https://playwright.dev/docs/intro) tests:

```sh
cd ./ui-tests
jlpm playwright test
```

Test results will be shown in the terminal. In case of any test failures, the test report
will be opened in your browser at the end of the tests execution; see
[Playwright documentation](https://playwright.dev/docs/test-reporters#html-reporter)
for configuring that behavior.

## Update the tests snapshots

> All commands are assumed to be executed from the root directory

If you are comparing snapshots to validate your tests, you may need to update
the reference snapshots stored in the repository. To do that, you need to:

1. Compile the extension:

```sh
jlpm install
jlpm build:prod
```

> Check the extension is installed in JupyterLab.

2. Install test dependencies (needed only once):

```sh
cd ./ui-tests
jlpm install
jlpm playwright install
cd ..
```

3. Execute the [Playwright](https://playwright.dev/docs/intro) command:

```sh
cd ./ui-tests
jlpm playwright test -u
```

> Some discrepancy may occurs between the snapshots generated on your computer and
> the one generated on the CI. To ease updating the snapshots on a PR, you can
> type `please update playwright snapshots` to trigger the update by a bot on the CI.
> Once the bot has computed new snapshots, it will commit them to the PR branch.

## Update the README screenshots

After the setup above, regenerate the README images from the repository root:

```sh
cd ui-tests
jlpm playwright test --project=readme --update-snapshots
jlpm playwright test --project=readme
```

Use Linux and Playwright's installed Chromium to match CI rendering. Review and
commit the plain (`launcher.png`, `dialog.png`) and Nebi (`launcher-nebi.png`,
`dialog-nebi.png`) images in `docs/images/`. These images also serve as the baselines when the tests run without `--update-snapshots`.

## Create tests

> All commands are assumed to be executed from the root directory

To create tests, the easiest way is to use the code generator tool of playwright:

1. Compile the extension:

```sh
jlpm install
jlpm build:prod
```

> Check the extension is installed in JupyterLab.

2. Install test dependencies (needed only once):

```sh
cd ./ui-tests
jlpm install
jlpm playwright install
cd ..
```

3. Start the server:

```sh
cd ./ui-tests
jlpm start
```

4. Execute the [Playwright code generator](https://playwright.dev/docs/codegen) in **another terminal**:

```sh
cd ./ui-tests
jlpm playwright codegen localhost:8888
```

## Debug tests

> All commands are assumed to be executed from the root directory

To debug tests, a good way is to use the inspector tool of playwright:

1. Compile the extension:

```sh
jlpm install
jlpm build:prod
```

> Check the extension is installed in JupyterLab.

2. Install test dependencies (needed only once):

```sh
cd ./ui-tests
jlpm install
jlpm playwright install
cd ..
```

3. Execute the Playwright tests in [debug mode](https://playwright.dev/docs/debug):

```sh
cd ./ui-tests
jlpm playwright test --debug
```

## Test with real Nebi

The opt-in Python test [test_nebi_integration.py](../tests/test_nebi_integration.py)
checks the native package job and preservation of earlier versions against a disposable
data-science-pack server running this checkout, Nebi v0.15, and Pixi. It uses
`linux-aarch64` packages, so the server must run on Linux ARM64. Run the following
from the repository root, replacing the URL and token with those of the test server:

```sh
export LAUNCHPAD_INTEGRATION_URL="http://127.0.0.1:8889"
export LAUNCHPAD_INTEGRATION_TOKEN="<test-server-token>"
python -m unittest discover -s tests -p test_nebi_integration.py
```

The URL is the Jupyter Server base URL, including any configured base path; do not
append `/lab` or `/nebi`. The test creates and deletes its own workspace. It is
skipped when `LAUNCHPAD_INTEGRATION_URL` is unset.

## Upgrade Playwright and the browsers

To update the web browser versions, you must update the package `@playwright/test`:

```sh
cd ./ui-tests
jlpm up "@playwright/test"
jlpm playwright install
```

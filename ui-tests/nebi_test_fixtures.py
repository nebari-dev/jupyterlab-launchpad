"""External Nebi/Pixi fixtures for server-to-browser integration tests.

The production HTTP handlers, error serialization and frontend are not mocked.
Tests create nebi-test.json inside their temporary workspace to expose a kernel.
"""

import atexit
import json
from pathlib import Path
import shutil
import sys
from tempfile import mkdtemp

from jupyter_client.kernelspec import KernelSpecManager


class NebiTestKernelSpecManager(KernelSpecManager):
    def get_all_specs(self):
        specs = super().get_all_specs()
        for fixture in Path(self.parent.root_dir).glob("*/nebi-test.json"):
            metadata = json.loads(fixture.read_text())
            metadata.update({
                "nebi_workspace_path": str(fixture.parent),
                "pixi_environment": "default",
                "nebi_state": "local-missing-deps",
            })
            specs[fixture.parent.name] = {
                "resource_dir": str(fixture.parent),
                "spec": {
                    "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
                    "display_name": "Nebi repair integration fixture",
                    "language": "python",
                    "metadata": metadata,
                },
            }
        return specs

    def invalidate_discovery_cache(self):
        # Fixture discovery reads the filesystem on every request.
        pass


def configure_nebi_fixtures(c):
    """Provide a deterministic Pixi executable without installing packages."""
    import os

    cli_dir = Path(mkdtemp(prefix="launchpad-test-pixi-"))
    atexit.register(shutil.rmtree, cli_dir)
    pixi = cli_dir / "pixi"
    pixi.write_text(
        f"#!{sys.executable}\n"
        "import json, pathlib, sys\n"
        "pathlib.Path('pixi-invocation.json').write_text(json.dumps(sys.argv[1:]))\n"
        "if 'test-failing-kernel' in sys.argv:\n"
        "    sys.stderr.write('Could not install test-failing-kernel.\\nPackage is unavailable.\\n')\n"
        "    sys.exit(1)\n"
    )
    pixi.chmod(0o755)
    os.environ["PATH"] = str(cli_dir) + os.pathsep + os.environ["PATH"]
    c.ServerApp.kernel_spec_manager_class = NebiTestKernelSpecManager

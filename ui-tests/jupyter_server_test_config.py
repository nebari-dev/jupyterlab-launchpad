"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
import os
import sys
from pathlib import Path

from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)

sys.path.insert(0, str(Path(__file__).parent))
from nebi_test_fixtures import configure_nebi_fixtures

configure_nebi_fixtures(c)

# Configure a mock server-proxy entry for testing icon rendering.
# Requires jupyter-server-proxy to be installed (listed in [project.optional-dependencies] test).
try:
    c.ServerProxy.servers = {
        "test-app": {
            "command": ["echo", "test"],
            "launcher_entry": {
                "enabled": True,
                "title": "Test App",
                "icon_path": os.path.join(os.path.dirname(__file__), "test-icon.svg"),
            },
        }
    }
except Exception:
    pass

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"

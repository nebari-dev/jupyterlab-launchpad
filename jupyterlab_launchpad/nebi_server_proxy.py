"""Server-proxy registration for the Nebi UI."""

from pathlib import Path
import shutil

from jupyter_core.paths import jupyter_runtime_dir


def setup_nebi_server_proxy():
    """Return the jupyter-server-proxy process config for Nebi."""
    if shutil.which("nebi") is None:
        raise FileNotFoundError("nebi was not found on PATH")

    config = {
        "command": [
            "nebi",
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            "{port}",
        ],
        "environment": {
            "NEBI_DATABASE_DRIVER": "sqlite",
            "NEBI_DATABASE_DSN": str(
                Path(jupyter_runtime_dir()) / "nebi-server-proxy.db"
            ),
            "NEBI_MODE": "local",
            "NEBI_SERVER_BASE_PATH": "{base_url}nebi",
        },
        "absolute_url": True,
        "new_browser_tab": False,
        "timeout": 30,
    }
    config["launcher_entry"] = {
        "title": "Nebi",
        "path_info": "nebi/workspaces",
    }
    return config

import unittest
from unittest.mock import Mock, patch

from jupyter_server.serverapp import ServerApp

from jupyterlab_launchpad import _load_jupyter_server_extension
from jupyterlab_launchpad.config import NebiConfig


class NebiConfigTests(unittest.TestCase):
    def test_extension_registers_configuration_for_help(self):
        server = ServerApp()
        server.web_app = Mock()
        with patch("jupyterlab_launchpad.setup_handlers"):
            _load_jupyter_server_extension(server)
            _load_jupyter_server_extension(server)

        self.assertEqual(server.classes.count(NebiConfig), 1)
        help_text = "\n".join(server.emit_help(classes=True))
        self.assertIn("--NebiConfig.kernel_dependencies", help_text)
        self.assertIn("['ipykernel']", help_text)
        self.assertIn("NebiConfig.kernel_dependencies", server.generate_config_file())

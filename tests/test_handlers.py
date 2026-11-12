import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from traitlets.config import Config

from jupyterlab_launchpad.handlers import NebiCapabilitiesHandler


class NebiCapabilitiesTests(unittest.TestCase):
    def test_kernel_defaults_are_exposed_including_disabled_installation(self):
        for packages in (None, [], ["r-irkernel"]):
            with self.subTest(packages=packages):
                config = Config()
                if packages is not None:
                    config.NebiConfig.kernel_dependencies = packages
                handler = Mock(spec=NebiCapabilitiesHandler)
                NebiCapabilitiesHandler.initialize(handler, SimpleNamespace(config=config))
                with patch(
                    "jupyterlab_launchpad.handlers.shutil.which", return_value="/bin/tool"
                ) as which:
                    NebiCapabilitiesHandler.get.__wrapped__(handler)
                which.assert_called_once_with("nebi")
                self.assertEqual(
                    json.loads(handler.finish.call_args.args[0]),
                    {
                        "nebi": True,
                        "kernelDependencies": ["ipykernel"] if packages is None else packages,
                    },
                )


if __name__ == "__main__":
    unittest.main()

from traitlets import List, Unicode
from traitlets.config import Configurable


class NebiConfig(Configurable):
    kernel_dependencies = List(
        Unicode(),
        default_value=["ipykernel"],
        config=True,
        help="Conda packages to install when a Nebi workspace has no Jupyter kernel. "
        "Used when the user has not supplied a kernel package override. "
        "Set to an empty list to disable kernel installation by default.",
    )

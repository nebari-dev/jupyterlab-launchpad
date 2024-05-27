import json
from pathlib import Path

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado


class DatabaseHandler(APIHandler):

    def initialize(self, name: str, settings_dir: str):
        self.path = Path(settings_dir) / "jupyterlab-new-launcher" / f"{name}.json"

    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        if not self.path.exists():
            return self.finish("{}")
        # read-through to raise any syntax errors on server-side
        data = json.loads(self.path.read_text(encoding="utf-8"))
        self.finish(json.dumps(data))

    @tornado.web.authenticated
    def post(self):
        # parse to ensure we do not write malformed data
        data = self.get_json_body()
        json_code = json.dumps(data)
        # write
        self.path.parent.mkdir(exist_ok=True, parents=True)
        self.path.write_text(json_code, encoding="utf-8")
        # tell client that all is ok
        self.set_status(204)


def setup_handlers(web_app, server_app):
    host_pattern = ".*$"

    base_url = web_app.settings["base_url"]
    api_url = url_path_join(base_url, "jupyterlab-new-launcher");
    db_url = url_path_join(api_url, "database")
    kwargs = {"settings_dir": web_app.settings["lab_config"]["user_settings_dir"]}
    handlers = [
        (url_path_join(db_url, "last-used"), DatabaseHandler, {"name": "last-used", **kwargs}),
        (url_path_join(db_url, "favorites"), DatabaseHandler, {"name": "favorites", **kwargs}),
    ]
    web_app.add_handlers(host_pattern, handlers)

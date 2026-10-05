# c = get_config()

import re

from jupyterhub.auth import Authenticator
from jupyterhub.handlers import BaseHandler
from oauthenticator.generic import GenericOAuthenticator
from tornado import web
import os

c = get_config()  # noqa: F821

# We rely on environment variables to configure JupyterHub so that we
# avoid having to rebuild the JupyterHub container every time we change a
# configuration parameter.

c.JupyterHub.bind_url = "http://0.0.0.0:8000"
c.JupyterHub.base_url = "/ijupyterhub"
c.JupyterHub.trust_xheaders = True

c.JupyterHub.hub_bind_url = "http://0.0.0.0:8081"
c.JupyterHub.hub_connect_url = "http://ihub-jupyterhub:8081"
c.JupyterHub.public_url = os.environ.get(
    "JUPYTER_PUBLIC_URL", "http://localhost:8080/ijupyterhub"
)
c.GenericOAuthenticator.validate_server_cert = os.environ.get(
    "JUPYTER_VALIDATE_CERT", "True"
).lower() in ("true", "1", "t")

secure_cookies = os.environ.get("JUPYTERHUB_SECURE_COOKIES", "True").lower() in (
    "true",
    "1",
    "t",
)
same_site_policy = "None" if secure_cookies else "Lax"


c.JupyterHub.cookie_options = {
    "SameSite": same_site_policy,
    "secure": secure_cookies,
}

# c.JupyterHub.allow_named_servers = True  # optional, only if you use multi-server per user
# c.ConfigurableHTTPProxy.command = ["configurable-http-proxy", "--redirect-port", "80"]

# c.JupyterHub.hub_ip = '0.0.0.0'


# Spawn single-user servers as Docker containers
c.JupyterHub.spawner_class = "dockerspawner.DockerSpawner"

# Spawn containers from this image
c.DockerSpawner.image = os.environ["DOCKER_NOTEBOOK_IMAGE"]

# Connect containers to this Docker network
network_name = os.environ["DOCKER_NETWORK_NAME"]
c.DockerSpawner.use_internal_ip = True

c.DockerSpawner.container_ip = ""    
c.DockerSpawner.extra_host_config = {
    "network_mode": network_name
}

c.DockerSpawner.network_name = network_name
c.Spawner.environment = {
    "JUPYTERHUB_SINGLEUSER_APP": "jupyter_server.serverapp.ServerApp"
}

c.Spawner.cmd = ["jupyterhub-singleuser"]


# Explicitly set notebook directory because we'll be mounting a volume to it.
# Most `jupyter/docker-stacks` *-notebook images run the Notebook server as
# user `jovyan`, and set the notebook directory to `/home/jovyan/work`.
# We follow the same convention.
notebook_dir = os.environ.get("DOCKER_NOTEBOOK_DIR", "/home/{username}")
c.DockerSpawner.notebook_dir = notebook_dir


# Mount config into every user container
c.DockerSpawner.volumes = {
    # "ihub_jupyter_single_user_config/jupyter_server_config.py": "/etc/jupyter/jupyter_server_config.py:ro",
}

# Mount the real user's Docker volume on the host to the notebook user's
# notebook directory in the container
c.DockerSpawner.volumes.update({
    "jupyterhub-user-{username}": notebook_dir,
    "ihub-services_ihub_jupyter_single_user_config": "/etc/jupyter",
    "ihub-services_ihub_projects": notebook_dir + "/projects",
    # "ihub_jupyter_shared_configs": {"bind": "/etc/jupyter", "mode": "ro"},
})

expected_projects_mount = notebook_dir + "/projects"
configured_projects_mount = c.DockerSpawner.volumes.get("ihub-services_ihub_projects")
if configured_projects_mount != expected_projects_mount:
    raise RuntimeError(
        "Invalid shared projects mount. "
        "Expected 'ihub-services_ihub_projects' to mount at "
        f"'{expected_projects_mount}', but found '{configured_projects_mount}'."
    )

# Remove containers once they are stopped
c.DockerSpawner.remove = True

# For debugging arguments passed to spawned containers
c.DockerSpawner.debug = True

# Persist hub data on volume mounted inside container
c.JupyterHub.cookie_secret_file = "/data/jupyterhub_cookie_secret"
c.JupyterHub.db_url = "sqlite:////data/jupyterhub.sqlite"


def _is_dev_bypass_enabled() -> bool:
    auth_mode = os.environ.get("AUTH_MODE", "oauth").strip().lower()
    environment = os.environ.get("ENVIRONMENT", "development").strip().lower()
    return auth_mode == "dev_bypass" and environment == "development"


def _dev_identity() -> tuple[str, str, str]:
    email = os.environ.get("DEV_AUTH_EMAIL", "dev.user@example.com").strip().lower()
    name = os.environ.get("DEV_AUTH_NAME", "Local Dev User").strip()
    # Match iHub's JupyterHub API user_id behavior to avoid duplicate servers.
    username = email
    username = re.sub(r"[^a-zA-Z0-9@._-]", "-", username).strip(".-_")
    if not username:
        username = "dev-user"
    return username, email, name


class DevBypassLoginHandler(BaseHandler):
    async def get(self):
        user_info = await self.authenticator.authenticate(self)
        if not user_info:
            raise web.HTTPError(403)

        user = await self.login_user(user_info)
        if user is None:
            raise web.HTTPError(403)

        self.redirect(self.get_next_url(user))


class DevBypassAuthenticator(Authenticator):
    async def authenticate(self, handler, data=None):
        username, email, name = _dev_identity()
        return {
            "name": username,
            "auth_state": {
                "auth_mode": "dev_bypass",
                "subject_id": f"dev-bypass:{email}",
                "email": email,
                "name": name,
            },
        }

    def get_handlers(self, app):
        return [(r"/login", DevBypassLoginHandler)]


if _is_dev_bypass_enabled():
    c.JupyterHub.authenticator_class = DevBypassAuthenticator
    c.Authenticator.auto_login = True
    c.Authenticator.allow_all = True
    c.Authenticator.allow_existing_users = False
else:
    c.JupyterHub.authenticator_class = GenericOAuthenticator

    c.GenericOAuthenticator.client_id = os.environ["OAUTH_CLIENT_ID"]
    c.GenericOAuthenticator.client_secret = os.environ["OAUTH_CLIENT_SECRET"]

    c.GenericOAuthenticator.authorize_url = os.environ["OAUTH_AUTHORIZE_URL"]
    c.GenericOAuthenticator.token_url = os.environ["OAUTH_TOKEN_URL"]
    c.GenericOAuthenticator.userdata_url = os.environ["OAUTH_USERDATA_URL"]
    c.GenericOAuthenticator.oauth_callback_url = os.environ["JUPYTER_OAUTH_CALLBACK_URL"]

    c.GenericOAuthenticator.username_claim = "email"

    c.GenericOAuthenticator.scope = os.environ.get("SCOPE", "openid email").split(" ")

    c.GenericOAuthenticator.allow_all = True
    c.GenericOAuthenticator.allow_existing_users = False

    c.Authenticator.allow_all = True
    c.Authenticator.allow_existing_users = False

# Specify admin users
c.Authenticator.admin_users = {"admin"}

c.JupyterHub.services = [
    {
        "name": "ihub-admin",
        "api_token": os.environ["JH_ADMIN_TOKEN"],
    },
]

c.JupyterHub.load_roles = [
    {
        "name": "ihub-role",
        "scopes": [
            "admin:users",  # can mint tokens for users
            "tokens",  # can mint tokens for users
            "admin:servers",  # manage user servers if needed
            "read:users",  # read user info
        ],
        "services": [
            # assign the service the above permissions
            "ihub-admin",
        ],
    }
]

# c.ZMQChannelsWebsocketConnection.kernel_ws_protocol = None

# # Allow all signed-up users to login
# c.Authenticator.allow_all = True

# # Authenticate users with Native Authenticator
# c.JupyterHub.authenticator_class = "nativeauthenticator.NativeAuthenticator"

# # Allow anyone to sign-up without approval
# c.NativeAuthenticator.open_signup = True

# # Allowed admins
# admin = os.environ.get("JUPYTERHUB_ADMIN")
# if admin:
#     c.Authenticator.admin_users = [admin]

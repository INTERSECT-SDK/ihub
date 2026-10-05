# Copyright (c) 2021-2023 Datalayer, Inc.
#
# MIT License

"""Configuration for the Jupyter development server."""

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.
# mypy: ignore-errors
import os
import stat
import subprocess
from pathlib import Path

from jupyter_core.paths import jupyter_data_dir

c = get_config()  # noqa: F821

# to output both image/svg+xml and application/pdf plot formats in the notebook file
c.InlineBackend.figure_formats = {"png", "jpeg", "svg", "pdf"}

# https://github.com/jupyter/notebook/issues/3130
c.FileContentsManager.delete_to_trash = False


#################
# Logging
#################

c.ServerApp.log_level = 'INFO'

#################
# Network
#################

c.ServerApp.ip = '0.0.0.0'

secure_cookies = os.environ.get('JUPYTER_SECURE_COOKIES', 'True').lower() in (
    'true',
    '1',
    't',
)
same_site_policy = 'None' if secure_cookies else 'Lax'


#################
# Security
#################

# todo enable this for more security
c.ServerApp.disable_check_xsrf = True
# ORIGIN = 'http://localhost:3208'
ORIGIN = '*'
# c.ServerApp.allow_origin = ORIGIN
c.ServerApp.allow_origin_pat = '.*'
c.ServerApp.allow_credentials = True
c.ServerApp.tornado_settings = {
    'headers': {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': 'Accept, Accept-Encoding, Accept-Language, Authorization, Cache-Control, Connection, Content-Type, Host, Origin, Pragma, Referer, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, Upgrade, User-Agent, X-XSRFToken, X-Datalayer, Expires',
        'Access-Control-Allow-Credentials': 'true',
        'Content-Security-Policy': f"frame-ancestors 'self' {ORIGIN} ",
    },
    'cookie_options': {'SameSite': same_site_policy, 'Secure': secure_cookies},
}
c.IdentityProvider.cookie_options = {
    'SameSite': same_site_policy,
    'Secure': secure_cookies,
}

#################
# Server Extensions
#################

c.ServerApp.jpserver_extensions = {
    'jupyterlab': False,
}


#################
# URLs
#################

# c.ServerApp.base_url = '/api/jupyter-server'
# c.ServerApp.default_url = '/api/jupyter-server/lab'


#################
# Kernel
#################

# See
# https://github.com/jupyterlab/jupyterlab/pull/11841
# https://github.com/jupyter-server/jupyter_server/pull/657
c.ZMQChannelsWebsocketConnection.kernel_ws_protocol = None  # None or ''

#################
# JupyterLab
#################


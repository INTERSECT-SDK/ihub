ARG JUPYTERHUB_VERSION=5.4.2
FROM quay.io/jupyterhub/jupyterhub:${JUPYTERHUB_VERSION}

USER root

RUN apt-get update && \
    apt-get install --no-install-recommends -y ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir \
    "dockerspawner==14.0.0" \
    "oauthenticator==17.5.0"

# Bake the configuration into the image so published images run without a
# source checkout. Compose files may still bind-mount over these paths to
# iterate on configuration locally.
COPY ./jupyterhub_config.py /srv/jupyterhub/jupyterhub_config.py
COPY ./jupyter_server_config.py /single_user_config/jupyter_server_config.py

EXPOSE 8000 8081

CMD ["jupyterhub", "-f", "/srv/jupyterhub/jupyterhub_config.py"]

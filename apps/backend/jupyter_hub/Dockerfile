FROM quay.io/jupyterhub/jupyterhub:5.4.2

USER root

RUN pip install dockerspawner oauthenticator

RUN apt-get update && \
    apt-get install -y ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY ./jupyter_server_config.py /single_user_config/jupyter_server_config.py

CMD ["jupyterhub", "-f", "/srv/jupyterhub/jupyterhub_config.py"]
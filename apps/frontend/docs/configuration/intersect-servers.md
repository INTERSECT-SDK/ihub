# INTERSECT Servers

The **INTERSECT Servers** panel stores broker connections, controls their
runtime connection state, and displays discovered services and capabilities.
Campaign Builder uses one of these connections as its selected INTERSECT
instance.

## Before you begin

For the local Compose deployment, use the connection values above. For a
shared deployment, obtain the following from the INTERSECT deployment owner:

| Field                | Required | Description                               |
| -------------------- | -------- | ----------------------------------------- |
| Name                 | Yes      | A recognizable label in iHub.             |
| IP Address           | Yes      | Broker host name or IP address.           |
| Port                 | Yes      | Broker listener port.                     |
| Message Protocol     | Yes      | `amqp0.9.1` or `mqtt5.0`.                 |
| Username             | Yes      | Broker user name.                         |
| Password             | No       | Broker password when required.            |
| Orchestrator URL     | No       | Campaign orchestrator base URL.           |
| Orchestrator API Key | No       | Credential required by that orchestrator. |

The optional orchestrator values are needed only when the connected
environment requires them to start or stop campaigns.

## Add a server

1. Open a project.
2. Open **INTERSECT Servers** in the left navigation.
3. Select **Create new INTERSECT broker**.
4. Complete the fields and submit the form.
5. Expand the new server and select **Connect**.

The server must reach the exact **connected** state before Campaign Builder
allows a run.

Each server header summarizes broker and orchestrator health in one status
badge:

- **CONNECTED** (blue) means both components are connected.
- **DISCONNECTED** (gray) means both components are explicitly disconnected.
- **WARNING** (orange) covers every other combination, including checks in
  progress, partial connectivity, failures, and missing configuration. Hover
  over the badge or focus it with the keyboard to see each component that is
  not connected and its current state.

- **BROKER** is the saved broker connection state. Only this state controls
  whether Campaign Builder allows a run.
- **ORCHESTRATOR** is a read-only reachability check for the saved Orchestrator
  URL. iHub checks when the panel opens, when the browser window regains focus,
  and every 30 seconds while the panel remains open.

The orchestrator check can report **CHECKING** while its first request is in
progress, **CONNECTED** for a successful health response, **DISCONNECTED**
when the orchestrator responds unsuccessfully or cannot be reached, and **NOT
CONFIGURED** when no Orchestrator URL is saved. **UNAVAILABLE** means iHub
could not obtain a valid health result from its own API. Orchestrator health
does not connect or disconnect the broker and does not change campaign
readiness.

## Set up a local INTERSECT environment

For local development, use Docker Compose to run a RabbitMQ message broker and
the INTERSECT campaign orchestrator. You need Docker with the Docker Compose
plugin installed.

Our mock capabilities [`docker-compose.yml`](https://code.ornl.gov/intersect/ihub/mock-capabilities/-/blob/main/docker-compose.yml?ref_type=heads)
is a reference for this setup. Its AMQP host port is `5673` because the default
port was already in use. The example below uses RabbitMQ's default AMQP port,
`5672`.

### Create the environment file

Create a directory for the local stack, then add a `.env` file:

```dotenv
BROKER_USERNAME=intersect_username
BROKER_PASSWORD=replace-with-a-local-password
BROKER_PROTOCOL=amqp0.9.1
ORCHESTRATOR_SECRET_NAME=local-ihub-orchestrator-secret
ORCHESTRATOR_API_KEY=replace-with-a-local-api-key
```

These values are local development credentials. Choose your own passwords and
do not commit the `.env` file.

### Create the Compose file

In the same directory, create `docker-compose.yml`:

```yaml
services:
  broker:
    image: rabbitmq:3-management-alpine
    ports:
      - "1884:1883"
      - "5672:5672"
      - "15673:15672"
    environment:
      RABBITMQ_DEFAULT_USER: ${BROKER_USERNAME}
      RABBITMQ_DEFAULT_PASS: ${BROKER_PASSWORD}
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 10s
      retries: 5
      start_period: 10s
      timeout: 10s
    networks:
      - internal
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq/mnesia/

  orchestrator:
    image: ghcr.io/intersect-sdk/campaign-orchestrator:latest
    environment:
      LOG_LEVEL: DEBUG
      SECRET_NAME: ${ORCHESTRATOR_SECRET_NAME}
      API_KEY: ${ORCHESTRATOR_API_KEY}
      SYSTEM_NAME: local-ihub-orchestrator
      BROKER_HOST: broker
      BROKER_PORT: 5672
      BROKER_USERNAME: ${BROKER_USERNAME}
      BROKER_PASSWORD: ${BROKER_PASSWORD}
      BROKER_PROTOCOL: ${BROKER_PROTOCOL}
      PRODUCTION: "true"
      SERVER_PORT: "9071"
    ports:
      - "9071:9071"
    depends_on:
      broker:
        condition: service_healthy
    networks:
      - internal

networks:
  internal:
    driver: bridge

volumes:
  rabbitmq_data:
    driver: local
```

The MQTT and RabbitMQ management ports follow the reference file. This guide
uses AMQP, so enter `5672` in iHub.

### Start and inspect the services

Start the broker and orchestrator:

```shell
docker compose up -d
```

Confirm that both containers are running:

```shell
docker compose ps
```

If a container does not start, inspect its logs:

```shell
docker compose logs broker orchestrator
```

The RabbitMQ management interface is available at
<http://localhost:15673>. Sign in with `BROKER_USERNAME` and
`BROKER_PASSWORD` from `.env`.

Stop the local stack when it is no longer needed:

```shell
docker compose down
```

### Connect iHub to the local services

Use the following values when creating the INTERSECT server in iHub:

| Field                | Local value                                                     |
| -------------------- | --------------------------------------------------------------- |
| Name                 | A recognizable name, such as `Local INTERSECT`.                 |
| IP Address           | `127.0.0.1` when the iHub backend runs on the host.             |
| Port                 | `5672`                                                          |
| Message Protocol     | `amqp0.9.1`                                                     |
| Username             | `BROKER_USERNAME` from `.env`.                                  |
| Password             | `BROKER_PASSWORD` from `.env`.                                  |
| Orchestrator URL     | `http://127.0.0.1:9071` when the iHub backend runs on the host. |
| Orchestrator API Key | `ORCHESTRATOR_API_KEY` from `.env`.                             |

If the iHub backend runs in Docker, `127.0.0.1` refers to its own container.
Use `host.docker.internal` or another host address reachable from that
container for both the broker host and orchestrator URL. For example, use
`host.docker.internal` and `http://host.docker.internal:9071`.

If a port is already in use, change the host side of its Compose mapping. Keep
the container-side port unchanged, and enter the new host port in iHub.

## Verify discovery

Expand a connected server. iHub lists the services advertised through that
connection. Expand a service to inspect its capabilities, endpoints, and
available metadata.

Campaign Builder loads its **Services** menu from this discovered inventory. If
the server is connected but no services appear, confirm that the services are
running and publishing lifecycle messages to the same broker.

## Manage a connection

Expand a server to:

- **Connect** a disconnected server;
- **Disconnect** a connected server;
- **Edit** its saved fields; or
- **Delete** the saved connection.

After an edit, connect again if the server is not already connected. Deleting
a connection removes it from Campaign Builder selections and can make existing
campaign documents temporarily unrunnable.

## Troubleshooting

### Unable to connect

Check the host, port, protocol, username, password, and network path. Confirm
that the protocol matches the broker listener rather than relying on the
placeholder text.

### The status changes back to disconnected

The saved record exists, but iHub could not maintain a live client connection.
Confirm broker reachability and credentials, then reconnect.

### Services or capabilities are missing

Confirm that:

- the correct server is connected;
- the service uses the same broker and hierarchy;
- the service is currently publishing lifecycle data; and
- Campaign Builder has the same server selected.

### Campaign Run is disabled

Campaign execution requires the selected server's current status to be exactly
**connected**. A stale, missing, or differently reported state is treated as
not ready.

## Related guides

- [Quick Start](quick-start.md)
- [Campaign Builder](applications/campaign-builder.md)
- [Configuration Overview](configuration/overview.md)
- [Troubleshooting](help/troubleshooting.md)

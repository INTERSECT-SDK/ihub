# Create an INTERSECT Capability

This walkthrough creates a standalone INTERSECT service with one capability:
a deterministic random number generator. The capability advertises one
message endpoint, `generate_random_number`, and reports the numbers generated
for each logical stream through its status.

An INTERSECT service connects an application to the INTERSECT ecosystem. A
service contains one or more capability implementations:

- a capability implementation extends `IntersectBaseCapabilityImplementation`.
- an `@intersect_message()` method is an endpoint that accepts a request and returns a response.
- the required `@intersect_status()` method reports inexpensive, serializable service state.

See the
[official INTERSECT SDK documentation](https://intersect-python-sdk.readthedocs.io/en/latest/)
for the full SDK model and the
[upstream examples](https://github.com/INTERSECT-SDK/python-sdk/tree/main/examples)
for other service and client patterns.

## Before you begin

You need:

- Python 3.10 or later for the type syntax used in this walkthrough.
- a running INTERSECT server (message broker) for the capability to connect to.
- a running orchestrator server to use the capability in a campaign.
- an iHub project where you can configure and connect the servers.

The INTERSECT SDK supports other Python versions. This walkthrough uses Python
3.10 or later so its types can stay close to the reference implementation.

Follow [INTERSECT Servers](../configuration/intersect-servers.md) to set up both
servers for local development and connect them to iHub.
Do not put real broker credentials in source control.

## 1. Create the project

Create a project directory and virtual environment:

```shell
mkdir random-number-capability
cd random-number-capability
python -m venv .venv
source .venv/bin/activate
```

Install the INTERSECT SDK:

```shell
python -m pip install intersect-sdk
```

Create an empty `random_num_gen.py` file. Add each Python block below to that
file in order. Together, the blocks form the complete service.

## 2. Add the imports

Start with the Python standard-library, INTERSECT SDK, and Pydantic imports:

```python
"""Run a random number generator as an INTERSECT capability."""

import logging
import os
import random
import time
from dataclasses import dataclass

from intersect_sdk import (
    HierarchyConfig,
    IntersectBaseCapabilityImplementation,
    IntersectService,
    IntersectServiceConfig,
    default_intersect_lifecycle_loop,
    intersect_message,
    intersect_status,
)
from pydantic import BaseModel, Field
from typing_extensions import Annotated

logger = logging.getLogger(__name__)

DEFAULT_RANDOM_SEED = 0
```

`DEFAULT_RANDOM_SEED` makes a stream deterministic even when a caller does
not provide a seed. This generator is suitable for a repeatable example, not
for security-sensitive random values.

## 3. Define the request, response, and state

Add the models used by the capability:

```python
class RandomServiceRandomNumGenCapabilityImplState(BaseModel):
    """Numbers generated for each logical stream."""

    streams: Annotated[
        dict[str, list[int]],
        Field(description="Generated numbers keyed by logical stream ID."),
    ] = Field(default_factory=dict)


class GenerateRandomNumberRequest(BaseModel):
    """Input payload for random number generation."""

    seed: Annotated[
        int | None,
        Field(
            title="seed",
            description=(
                "Optional random number generator seed. If omitted, the "
                "stream continues its current random sequence."
            ),
            ge=0,
        ),
    ] = None
    stream_id: Annotated[
        str,
        Field(
            title="stream_id",
            description=(
                "Logical stream identifier used to keep random sequences "
                "independent."
            ),
            min_length=1,
        ),
    ] = "default"
    delay: Annotated[
        float,
        Field(
            title="delay",
            description=(
                "Number of seconds to wait before generating the value."
            ),
            ge=0.0,
        ),
    ] = 0.0


@dataclass
class RandomServiceRandomNumGenCapabilityImplResponse:
    """Output payload for random number generation."""

    stream_id: str
    value: int
    state: RandomServiceRandomNumGenCapabilityImplState
    success: bool
```

INTERSECT uses the type annotations to generate the endpoint schema. Pydantic
fields add the descriptions, defaults, and validation bounds that iHub uses to
render capability inputs. A request with a negative seed, an empty stream ID,
or a negative delay is rejected before the endpoint runs.

## 4. Implement the capability

Add the capability implementation:

```python
class RandomServiceRandomNumGenCapabilityImpl(
    IntersectBaseCapabilityImplementation
):
    """Generate deterministic random numbers for independent streams."""

    intersect_sdk_capability_name = "Random_Number_Generator"

    def __init__(self) -> None:
        """Initialize capability state and random number streams."""
        super().__init__()
        self.state = RandomServiceRandomNumGenCapabilityImplState()
        self._rng_by_stream: dict[str, random.Random] = {}
        self._stream_seed_initialized: set[str] = set()

    @intersect_status()
    def status(self) -> RandomServiceRandomNumGenCapabilityImplState:
        """Return the current capability state."""
        return self.state

    @intersect_message()
    def generate_random_number(
        self,
        request: GenerateRandomNumberRequest,
    ) -> RandomServiceRandomNumGenCapabilityImplResponse:
        """Generate one random integer between 1 and 100."""
        stream_id = request.stream_id

        if stream_id not in self._rng_by_stream:
            self._rng_by_stream[stream_id] = random.Random(
                DEFAULT_RANDOM_SEED
            )
            self.state.streams[stream_id] = []

        rng = self._rng_by_stream[stream_id]

        if (
            request.seed is not None
            and stream_id not in self._stream_seed_initialized
        ):
            rng.seed(request.seed)
            self._stream_seed_initialized.add(stream_id)

        time.sleep(request.delay)
        value = rng.randint(1, 100)
        self.state.streams[stream_id].append(value)

        logger.info(
            "Generated random number %s for stream %s",
            value,
            stream_id,
        )

        return RandomServiceRandomNumGenCapabilityImplResponse(
            stream_id=stream_id,
            value=value,
            state=self.state,
            success=True,
        )
```

`intersect_sdk_capability_name` names the capability advertised by the
service. The decorated method name becomes its endpoint, so iHub discovers the
operation as `Random_Number_Generator.generate_random_number`.

Each `stream_id` owns an independent `random.Random` instance. The first
non-null seed supplied for a stream is applied once; later calls continue that
stream's deterministic sequence. Because this introductory capability has no
reset endpoint, restart the service to clear its in-memory streams.

## 5. Configure and run the service

Add the service configuration and application entry point:

```python
    @staticmethod
    def run() -> None:
        """Configure and run the INTERSECT service."""
        broker_config = {
            "brokers": [
                {
                    "host": os.getenv("BROKER_HOST"),
                    "port": os.getenv("BROKER_PORT"),
                    "username": os.getenv("BROKER_USERNAME"),
                    "password": os.getenv("BROKER_PASSWORD"),
                    "protocol": os.getenv("BROKER_PROTOCOL"),
                },
            ],
        }
        config = IntersectServiceConfig(
            hierarchy=HierarchyConfig(
                organization="random-organization",
                facility="random-facility",
                system="random-system",
                subsystem="random-subsystem",
                service="random-service",
            ),
            status_interval=30.0,
            **broker_config,
        )
        capability = RandomServiceRandomNumGenCapabilityImpl()
        service = IntersectService([capability], config)

        logger.info(
            "Starting %s, use Ctrl+C to exit.",
            capability.intersect_sdk_capability_name,
        )
        default_intersect_lifecycle_loop(service)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    RandomServiceRandomNumGenCapabilityImpl.run()
```

The hierarchy identifies the service as:

```text
random-organization.random-facility.random-system.random-subsystem.random-service
```

Export the connection values for your broker:

```shell
export BROKER_HOST="<broker-host>"
export BROKER_PORT="<broker-port>"
export BROKER_USERNAME="<broker-username>"
export BROKER_PASSWORD="<broker-password>"
export BROKER_PROTOCOL="amqp0.9.1"
```

Use `mqtt5.0` instead when that is the protocol exposed by your broker. Start
the service:

```shell
python random_num_gen.py
```

The service continues running and publishing lifecycle information until you
stop it with **Ctrl+C**.

## 6. Verify the capability in iHub

Connect iHub to the same broker and invoke the endpoint:

1. Open an iHub project.
2. Follow [INTERSECT Servers](../configuration/intersect-servers.md) to add
   and connect the broker used by the Python service.
3. Expand the connected server and find the `random-service` service.
4. Expand `Random_Number_Generator` and confirm that
   `generate_random_number` appears.
5. Create a campaign and add the endpoint as a capability node.
6. Enter `42` for **seed**, `demo` for **stream_id**, and `0` for **delay**.
7. Run the campaign with one iteration and inspect the returned `value`,
   `stream_id`, `state`, and `success` fields.

See [Campaign Builder](../applications/campaign-builder.md) for the complete
campaign workflow. If the service does not appear, confirm that iHub and the
Python process use the same broker host, port, protocol, and credentials.

## Next steps

This walkthrough intentionally implements only `generate_random_number`. The
[complete iHub mock capability](https://code.ornl.gov/intersect/ihub/mock-capabilities/-/blob/main/src/random_generator_services/random_service/random_num_gen.py?ref_type=heads)
also demonstrates list generation and a reset endpoint.

Continue with:

- the official [INTERSECT SDK documentation](https://intersect-python-sdk.readthedocs.io/en/latest/)
  for configuration, schemas, events, clients, and API details.
- the [INTERSECT Python SDK examples](https://github.com/INTERSECT-SDK/python-sdk/tree/main/examples)
  for service-to-client and event-driven patterns.
- [Quick Start](../quick-start.md) to connect capability output to other iHub campaign nodes.

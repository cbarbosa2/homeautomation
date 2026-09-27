# Agent guidance

This is a Deno home automation service controlling a battery and two wallboxes through MQTT.

- **Automation behavior:** Read [docs/automation-rules.md](docs/automation-rules.md) before changing or reviewing charging modes, power allocation, priority, battery targets, or grid protection. It defines intended behavior; implementation may differ.
- **Architecture:** Read [docs/architecture.md](docs/architecture.md) when locating code or changing service interactions, scheduling, or application lifecycle.
- **Development:** Read [docs/development.md](docs/development.md) before setting up, running, or validating the application.
- **Date and time:** Read the [Temporal conventions](docs/development.md#date-and-time) before adding, changing, or reviewing date/time types or logic.
- **Configuration and monitoring:** Read [docs/operations.md](docs/operations.md) when changing environment settings, MQTT connectivity, HTTP endpoints, or metrics.

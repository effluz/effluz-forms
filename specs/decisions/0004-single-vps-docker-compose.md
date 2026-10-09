# 0004. Single VPS running a Docker Compose stack behind Caddy

Status: accepted
Date: 2026-10-08

## Context

The VPS currently has no container runtime. Choosing PostgreSQL in a
container (ADR 0001) requires one. Options were: Docker for everything,
Docker for the database only with the app running natively, or no Docker
with native packages. A staging environment was considered and declined.

## Decision

Install Docker on the VPS and run proxy, app, worker and database as one
Compose stack. Caddy is the reverse proxy for automatic TLS. Production is
the only deployed environment; developers run the same stack locally.

## Consequences

- Reproducible: the server is a provisioning script plus a Compose file.
  Moving to another VPS is restore-and-redeploy.
- CI builds one image for app and worker; deploys are image pulls.
- A single server is a single point of failure. Accepted at this scale, and
  mitigated by tested backups and the move runbook.
- No staging means production is the first place real integrations meet
  real traffic. The test suite and the local stack carry that risk.

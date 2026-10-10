# 0007. GitHub Actions for CI/CD, images in GitHub Container Registry

Status: accepted
Date: 2026-10-08

## Context

The repository is on GitHub. Continuous deployment to a self-hosted VPS was
requested. Options for the registry were GHCR or Docker Hub; options for
deployment were SSH-driven Compose, a pull-based agent on the server, or a
PaaS layer on the VPS.

## Decision

Two workflows, `ci` and `deploy`, plus a weekly `maintenance` workflow.
Images are pushed to GHCR tagged by commit SHA. Deployment is SSH-driven:
pull, migrate, restart, health check, roll back on failure. `main` is
protected and is the production branch.

## Consequences

- No extra tooling on the server beyond Docker and SSH.
- Deploy secrets are limited to SSH access; application secrets stay on the
  server.
- Every merge to `main` goes live. Reviews and the test suite are the gate,
  so they must stay fast and trustworthy.
- A pull-based deployer or PaaS layer remains possible later without
  changing the image or the Compose file.

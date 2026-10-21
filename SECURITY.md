# Security and data handling

## Scope

Pratirup is a research prototype. It processes **no personal data**:

- the training and demo data are open, de-identified research datasets;
- the repository holds no secrets, API keys or credentials, and the app calls no external services.

## Hardening in this repository

- The Docker image runs as a non-root user (`uid 10001`) and ships only serving dependencies.
- `docker-compose.yml` runs the container with:
  - a read-only root filesystem, with tmpfs for the cache;
  - all Linux capabilities dropped and `no-new-privileges`;
  - memory and PID limits;
  - port 8000 bound to localhost only.
- CI runs on every push:
  - unit tests (leakage, labels, live-vs-replay parity);
  - `pip-audit`, `npm audit` (high and critical);
  - a Docker build with a smoke test;
  - a Trivy image scan.
- Dependabot tracks pip, npm, GitHub Actions and Docker base-image updates.
- Input validation: CGM readings are range-checked (20–600 mg/dL at the API, 39–501 mg/dL in ingestion), and out-of-order readings are rejected.

## If this were deployed with real patients

- **Law.** India's DPDP Act 2023 and DPDP Rules 2025 apply: consent, notice, purpose limitation, security safeguards and breach intimation.
- **Regulation.** A deployed version would need medical-device classification under CDSCO.
- **Missing controls.** Authentication and role-based access, encryption at rest, audit logging and consent management are not implemented. They are required before any real data touches the system.

## Reporting

Please report security issues privately to the maintainers through GitHub (Spiritsfuse/pratirup → Security → Report a vulnerability) rather than in a public issue.

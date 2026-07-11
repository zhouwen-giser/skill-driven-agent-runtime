# OSS Intake: uv (external test environment tool)

- Official repository: `https://github.com/astral-sh/uv`
- Package/module: PyPI `uv`
- Exact version: `0.11.28`
- License: dual Apache-2.0 OR MIT, as published by the upstream project.
- Requested use: create and execute the official A2A TCK's frozen Python environment outside the SDAR repository.
- Capability needed: the pinned A2A TCK uses `uv.lock` and documents frozen execution through uv; uv is not available on the current host.
- Why existing dependencies cannot provide it: pnpm and the product's Node.js runtime cannot install or verify the TCK's Python lock graph.
- Boundary: install only into `D:\Temp\sdar-a2a-tck-tooling`; do not add uv or Python packages to the SDAR product, workspace, image, SBOM, or runtime.
- Security/quality findings: execute only the already-approved exact TCK commit; use `uv sync --frozen`; do not publish, vendor, or copy tool source.
- Maintenance: version changes require a new intake update and a reproduced TCK report.
- Decision: approved as an external EP-01 test tool under ADR-006; not a production dependency.

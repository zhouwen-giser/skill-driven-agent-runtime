# OSS Intake: React Console Stack

- Official repositories: https://github.com/facebook/react, https://github.com/vitejs/vite, https://github.com/vitejs/vite-plugin-react, https://github.com/DefinitelyTyped/DefinitelyTyped
- Packages/modules: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`
- Exact versions: `react@19.2.7`, `react-dom@19.2.7`, `vite@8.1.4`, `@vitejs/plugin-react@6.0.3`, `@types/react@19.2.17`, `@types/react-dom@19.2.3`
- Exact source pins: React commit `6117d7cca4906492c51fe6a03381e35adfd86e7d`; Vite tag `v8.1.4`; Vite React plugin commit `640fd358a0e82393acfce4e92e19a6ac6e1641a7`; DefinitelyTyped packages are pinned by exact npm version and integrity in `third_party/sources.lock.yaml` and `pnpm-lock.yaml`.
- License and NOTICE: all six packages declare MIT. The exact React, Vite and Vite React plugin source pins contain an MIT `LICENSE`; no separate `NOTICE` obligation is declared. The installed package license files are included by the repository SBOM/license evidence generator.
- Requested use: direct dependency.
- Files or APIs inspected: package manifests and registry metadata; React `createRoot`, component and hook APIs; Vite build/dev-server configuration; Vite React plugin transform entry point; React TypeScript declarations.
- Capability needed: build and render the required operational React console while retaining strict TypeScript and a reproducible production bundle.
- Why current authoritative components cannot provide it: the repository has real management APIs but no browser rendering or frontend build implementation. These packages provide presentation/build infrastructure only; they do not implement Goal, Skill, Workflow, Memory, Evaluation, protocol, or persistence behavior.
- Boundary/adapter: `apps/console` owns all React/Vite imports and consumes versioned management HTTP DTOs. Domain and application packages must not import frontend framework types. The production bundle is static content served by the existing single-process management HTTP boundary.
- Maintenance and upgrade plan: exact versions only; upgrades require lockfile/SBOM/license regeneration, console unit and E2E tests, production build, and a review of engine requirements and migration notes.
- Security/quality findings: Vite is a development/build dependency and is not the V1 runtime authority. The production server serves only built static assets. Console requests remain subject to the accepted trusted-intranet/no-auth warning. No third-party DAG runtime or copied UI source is introduced.
- License obligations: preserve MIT license and copyright notices in release notices; retain generated SBOM and license report.
- Decision and ADR: accepted by ADR-064. No source code is copied or adapted.


# OSS Intake: esbuild

- Official repository: `https://github.com/evanw/esbuild`
- Package/module: `esbuild` (transitive development/build dependency of Vitest/Vite)
- Exact tag/commit/version: npm `0.28.1`; git commit `bb9db84c02433fbe37b3509f53f9f3e3cc48725e`; integrity `sha512-HrJrvZv5ayxBzPfwphOoNzkzOIIlifzk0KJrGK2c8R4+LKpMtpYLQeUdjnwjWv/LZlkH2laZk+4w78pi99D4Vw==`.
- License and NOTICE: MIT; packaged license verified at `node_modules/esbuild/LICENSE.md` after install.
- Requested use: transitive development dependency; its platform binary install script must be explicitly allowed by pnpm.
- Files or APIs inspected: npm metadata and package install behavior. SDAR does not import esbuild APIs.
- Capability needed: Vitest/Vite TypeScript transformation during tests.
- Why current authoritative components cannot provide it: it is selected transitively by the accepted test runner; replacing it independently would fork the toolchain.
- Boundary/adapter: development/test toolchain only; no domain or runtime imports.
- Maintenance and upgrade plan: controlled by exact Vitest lockfile; re-review if it becomes a production dependency or its install script changes materially.
- Security/quality findings: pnpm correctly blocked the postinstall until allowlisted; allowlist contains only `esbuild`.
- License obligations: retain MIT text and list in generated SBOM/license report.
- Decision and ADR: accepted as a narrow build dependency under ADR-006; no new runtime capability.

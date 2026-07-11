# OSS Intake: Express

- Official repository: `https://github.com/expressjs/express`
- Package/module: `express@5.2.1`, development types `@types/express@5.0.6`
- Exact tag/commit/version: Express npm `5.2.1`, commit `dbac741a49a5a64336b70c06e85c2e2706e36336`, integrity `sha512-hIS4idWWai69NezIdRt2xFVofaF4j+6INOpJlVOLDO8zXGpUVEVzIYk12UUi2JzjEzWL3IOAxcTubgz9Po0yXw==`; types integrity `sha512-sKYVuV7Sv9fbPIt/442koC7+IIwK5olP1KWeD88e/idgoJqDm3JV/YUiPwkoKK92ylff2MGxSz1CSjsXelx0YA==`.
- License and NOTICE: MIT for Express and DefinitelyTyped definitions; packaged licenses must be included in SBOM/license output.
- Requested use: direct HTTP server dependency required by the official A2A SDK Express handler.
- Files or APIs inspected: `express()`, JSON middleware, router mounting and Node HTTP server integration.
- Capability needed: same-process A2A and management HTTP endpoints.
- Why current authoritative components cannot provide it: A2A SDK beta's supported Node handler is typed as Express middleware; hand-rolling the protocol transport would bypass the official SDK.
- Boundary/adapter: Express is restricted to `apps/server` and protocol adapter bootstrap; domain packages cannot import it.
- Maintenance and upgrade plan: exact pin and lockfile; A2A endpoint contract and error middleware tests on upgrade.
- Security/quality findings: Node >=18 supported; SDAR baseline Node >=20. V1 deliberately has no authentication and must emit trusted-intranet warnings.
- License obligations: retain MIT notices and list in SBOM/third-party notices.
- Decision and ADR: accepted as the HTTP shell anticipated by ADR-007; it is not a workflow or agent runtime.

# v1.0.11 Feature Test Results

Reproducible evidence:

- format check: passed;
- ESLint: passed;
- strict TypeScript: passed;
- unit: 281 passed;
- contract: 62 passed;
- targeted semantics/Planner/API/Console suite: 104 passed;
- integration: 59 passed;
- E2E: 46 passed;
- architecture: 182 TypeScript source files passed;
- management OpenAPI: 105 operations passed;
- production server and Console build: passed;
- empty and historical-0049 migration verification through 0063: passed;
- PostgreSQL/Redis and Server/Console smoke: passed;
- complete `pnpm verify`: passed in 86,700 ms.

The first persistence attempt observed a transient operator-managed endpoint refusal. After the
operator restored the service, every real gate passed. No Docker command ran.

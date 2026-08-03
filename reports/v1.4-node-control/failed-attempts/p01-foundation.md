# P01 Retained Failed Attempts

## Attempt 1: strict lint gate

- command: `pnpm format; pnpm typecheck; pnpm lint; pnpm verify:architecture; pnpm verify:node-control-contract`
- result: lint failed with 40 findings; the PowerShell command sequence continued, so the final
  aggregate shell exit code was not used as proof
- root cause: the initial P01 sources used deprecated Zod/Vitest APIs, value imports where only types
  were needed, expression-bodied void callbacks, redundant unions and unqualified web globals
- repair: migrated to current APIs and strict callback/type/global forms; reran each gate separately
- rerun: format, lint, typecheck, architecture, frozen contract and 7 focused tests passed

## Attempt 2: first Node Control smoke

- command: `pnpm smoke:node-control`
- result: failed in the nested production build with TypeScript `TS2883`
- root cause: declaration emit could not portably name the inferred Express application type even
  though the no-emit typecheck passed
- repair: declared `createNodeControlHttpApp(...): Express` explicitly
- rerun: `pnpm build` passed

## Attempt 3: second Node Control smoke

- command: `pnpm smoke:node-control`
- result: failed when the nested Runtime smoke reached PostgreSQL database creation with `XX000`:
  `template database "template1" has a collation version, but no actual collation version could be determined`
- root cause: the nested smoke inherited the default `sdar` Compose project and encountered the
  already preserved Debian/Alpine-incompatible data volume identified in P00
- repair: allocate unique Runtime PostgreSQL/Redis ports and a disposable Runtime Compose project;
  remove only that exact project and its test volumes after the smoke
- rerun: Node Control PostgreSQL/API/Worker/authentication/shutdown and Runtime-after-Control-stop
  smoke passed; the same path passed again inside the full verifier

## Environment-only publication attempts

- an unprivileged `git add` was denied because `.git/index.lock` is outside the writable sandbox;
  the exact path list succeeded with the user-authorized Git permission
- a pre-commit refresh of remote references timed out twice in the approval service; P01 had already
  fetched latest main at phase start, and the successful implementation push confirmed the remote
  feature branch fast-forwarded from `f272285` to `bf56489`

No failed attempt was hidden, no assertion was weakened, and no existing Docker volume was deleted.

# v1.1 Phase 0 Draft PR Tooling Blocker

Status: resolved on 2026-07-16.

## Context

- Phase: 0
- Branch: `feature/v1.1-mcp-tasks`
- Published Phase commit: `5dfef3b80f05b0fa2eec4141ad4395c86f4b67a6`
- Remote: `https://github.com/zhouwen-giser/skill-driven-agent-runtime.git`
- Target base: `release/v1.0-hardening`
- Latest hardening: `v1.0.4-bug-fixed` / `fa4b0509971fc73c474211b871eeefaf4e76eb54`

## Blocker

The Phase 0 package requires a Draft PR. The repository's GitHub publish skill requires GitHub CLI and an authenticated `gh auth status` before PR creation. `gh` is not in PATH and does not exist in the checked common install locations:

```text
C:\Program Files\GitHub CLI\gh.exe
C:\Users\zhouw\AppData\Local\Programs\GitHub CLI\gh.exe
C:\Users\zhouw\scoop\apps\gh\current\bin\gh.exe
```

No PR was fabricated through an unreviewed REST credential path, and the Draft was not marked ready.

## Work preserved

- Complete clean baseline and Phase 0 source/build gates passed.
- Design, requirements, ADRs, OSS pins and reports are committed and pushed.
- Worktree was clean after push.
- No Phase 1 implementation was started.

## Minimum resolution

Install GitHub CLI, run `gh auth login` for `github.com` if needed, and make `gh --version` plus `gh auth status` succeed in this shell. Codex can then create the Draft PR from `feature/v1.1-mcp-tasks` to `release/v1.0-hardening`, record its URL, close this blocker and start Phase 1.

## Resolution evidence

- `gh version 2.96.0` succeeded.
- `gh auth status` confirmed active account `zhouwen-giser` with repository/workflow scope.
- Draft PR `https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/2` is open with base `release/v1.0-hardening`, head `feature/v1.1-mcp-tasks`, and `isDraft=true`.
- Head `c9069a6a0a6066f76b05fa4c251aed736369c2fd` was pushed before PR creation.

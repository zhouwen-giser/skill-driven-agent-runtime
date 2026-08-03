# P13 Failed Attempts

| Attempt | Failure | Root cause | Repair / disposition |
|---|---|---|---|
| first recovery drill | Node Control API was not ready | Windows sequential ephemeral-port reservation reused a released port | reserved all four ports concurrently until selection completed; real drill rerun passed |
| first full Integration | 148/149 passed; an LLM fixture received 422 | P13 egress allowlist correctly rejected the existing test-only provider authority | supplied the explicit test allowlist; full Integration rerun passed 30 files / 149 tests |
| focused formatter wrapper | Prettier returned no parser for `.env.example` | the explicit mixed-file command included an extensionless env file | reran Prettier on supported sources and the repository format gate; both passed |
| first exact full verify | frozen contract size drift on `authority-matrix.csv` | Git normalized four byte-locked CRLF CSV blobs to LF in a clean Windows checkout | added exact `-text` attributes and re-indexed original MANIFEST-matching bytes in `63c6961`/`ec10587` |
| second exact full verify | final Node Control nested Runtime smoke could not reach two Healthy containers through host ports | transient Docker Desktop host-port forwarding failure; all earlier gates passed | immediate same-SHA recovery rerun passed; no assertion or timeout was weakened |
| third exact full verify | every gate passed but summary recorded `dirty=true` | the isolated worktree retained the second failed run's tracked summary before rerun | restored only the task-owned generated summary in the disposable worktree, confirmed clean status and reran |
| final exact full verify | passed | clean `ec10587`, all eight verifier steps passed | accepted summary SHA-256 `93d4801d...d9d319` |

No failed attempt is represented as passing product evidence.

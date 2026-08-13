# Secret loading

Never place a populated secret file in this repository. Mount or reference files from a deployment
secret manager outside the checkout, restrict them to the service account (normally mode `0600`), and
rotate them according to the site runbook.

The UGV guard helpers support an explicit unauthenticated mode or exactly one source for each
secret. For the current public deployment use:

```text
SMPP_REGISTRY_CREDENTIAL_REF=unauthenticated://none
SMPP_UGV_RUNTIME_CREDENTIAL_REF=unauthenticated://none
```

In this mode the corresponding token and `_FILE` variables must remain empty and SDAR omits the
`Authorization` header entirely. For an authenticated deployment use a `secret://env/...`
reference and exactly one of:

```text
SMPP_REGISTRY_TOKEN or SMPP_REGISTRY_TOKEN_FILE
SMPP_UGV_RUNTIME_TOKEN or SMPP_UGV_RUNTIME_TOKEN_FILE
SDAR_UGV_MODEL_API_KEY or SDAR_UGV_MODEL_API_KEY_FILE
```

The model secret is required only when `SDAR_UGV_REAL_MODEL_ENABLED=YES`. Runtime and Registry
credentials remain independent even if an operator's secret manager stores them in the same vault.

An empty value is treated as unset. Supplying both a non-empty inline value and `_FILE` path fails
closed. Files must be regular UTF-8 files no larger than 64 KiB; surrounding whitespace is removed.
Neither the value nor its path is emitted in success or failure output.

Credential references are explicit deployment authority. `unauthenticated://none` is the only
non-secret value; it never silently falls back from a missing secret. A `secret://env/...` reference
reads the named environment variable. When `_FILE` is used, the deployment driver must load the file
into that child process's in-memory environment without writing or logging the value. A guard-only
validation does not change the parent process environment.

The Runtime master key and SDAR/Node-Control service tokens follow their current product environment
contracts and currently have no `_FILE` resolver in the service processes. Inject them directly as
process environment values from the deployment secret manager; do not add an unreviewed plaintext
compatibility file. Client/server variables for one authenticated service channel must receive the
same secret through the manager, while distinct roles must use distinct credentials.

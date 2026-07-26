# Test Plan

执行：

pnpm verify

重点：

Migration:

- apply
- rollback
- reapply

Repository:

- create
- read
- version
- activate
- deprecate

Concurrency:

两个Activation同时执行。

Security:

无Approval无法Active。


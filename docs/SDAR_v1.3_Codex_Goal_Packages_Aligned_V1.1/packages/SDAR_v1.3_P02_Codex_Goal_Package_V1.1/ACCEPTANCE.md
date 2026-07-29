# Acceptance

必须：

- PostgreSQL为唯一Artifact Authority
- Version不可覆盖修改
- Active Pointer唯一
- Approval可审计
- CAS并发安全
- Outbox可靠
- Migration可重放

测试：

- Fresh DB Migration
- Repository Round Trip
- Concurrent Activation
- Invalid State Reject
- Audit Verify

禁止：

- Candidate直接Active
- 修改Active Definition
- Redis作为权威


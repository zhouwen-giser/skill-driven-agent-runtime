# P12 Dependency Contract

## P00

必须：

```text
READY_FULL
```

## P01～P06

提供：

- Artifact Domain；
- Repository / Version / Lineage；
- Validation / Shadow；
- Promotion / Approval / Activation；
- Revalidation / Deprecation / Rollback / Kill Switch；
- Audit / Event。

## P07～P10

提供：

- Retrieval / Applicability；
- Template / Rule Runtime；
- Fast Gateway；
- Runtime Match / Decision；
- Formal Handoff；
- Feedback / Drift；
- Reason Codes；
- Management Query Ports。

## P11

提供：

- Case Runtime；
- Model Profile / Route / Cascade；
- Token / Cost；
- Outcome / Drift；
- Management Query Ports；
- Feature Flags。

## Existing Management / Console

提供：

- Auth；
- RBAC；
- Tenant；
- Error Envelope；
- Pagination；
- OpenAPI；
- UI Component / Route；
- Audit；
- Feature Flag。

## Existing A2A

提供：

- Agent Card；
- Skills；
- Task；
- Input-required；
- SSE；
- Auth；
- TCK；
- Formal Task State。

## 输出给 P13

- API Operation Inventory；
- OpenAPI Operation Count；
- Console Route / Capability Inventory；
- A2A Projection Contract；
- SSE Event Contract；
- RBAC Matrix；
- Exposure Allowlist；
- Audit / Idempotency；
- Security Report；
- Accessibility Report；
- E2E Report；
- Known Limitations。

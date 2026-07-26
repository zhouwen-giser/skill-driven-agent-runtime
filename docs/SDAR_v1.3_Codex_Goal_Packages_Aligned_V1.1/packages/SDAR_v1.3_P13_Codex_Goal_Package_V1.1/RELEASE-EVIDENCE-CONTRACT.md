# P13 Release Evidence Contract

## 必需证据

- Exact origin/main SHA；
- P00～P12 Commit ancestors；
- Working tree；
- Toolchain；
- Dependency lock；
- Full Verify；
- Test counts；
- Migration；
- Upgrade；
- Rollback；
- Security；
- Capacity；
- Chaos；
- Protocol；
- Console；
- A2A TCK；
- SBOM；
- License；
- Sources；
- Build；
- Container；
- Feature Flags；
- Rollout；
- Rollback；
- Known Limitations；
- Final Reviews；
- Final Drift Audit。

## Release Candidate Report

必须包含：

```text
Decision
Exact SHA
Included Goals
Passed Gates
Failed / Waived Gates
Waiver Authority
Known Limitations
Security Findings
Capacity
Recovery
Upgrade
Rollout
Rollback
Monitoring
Authorization Required
```

## Waiver

默认不允许 Critical / High Security、Authority、Data Loss、Cross-tenant、Credential、Side-effect、Migration、Rollback Gate 豁免。

其他豁免必须：

- 明确 Owner；
- 到期时间；
- 风险；
- Mitigation；
- Approval；
- 不写成“通过”。

## Artifact

生成：

- Verification Summary；
- SHA256；
- Release Manifest；
- SBOM；
- License；
- Source Lock；
- Container Digest（如有）；
- Reproducibility Report。

## 最终状态

```text
RELEASE_CANDIDATE_READY
RELEASE_CANDIDATE_BLOCKED
```

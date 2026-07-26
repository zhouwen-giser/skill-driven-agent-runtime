# P12 Exposure / Redaction Contract

## 分层

### Public

- Safe capability；
- Formal status；
- Input-required；
- Safe reason code；
- Safe evidence link。

### Authenticated User

- 自己的 Request / Goal / Plan / Outcome；
- Safe artifact usage summary；
- Confirmation / fallback reason。

### Tenant Operator

- Tenant Artifact / Runtime / Drift；
- Validation / Shadow / Promotion；
- Governance operation。

### Security / Admin

- Security event；
- Kill switch；
- extended audit；
- 仍不返回 Secret 原文。

## 禁止公开

```text
credential
api key
secret
provider token
raw encrypted config
private chain of thought
internal prompt
full raw tool output
unredacted pii
cross-tenant id
private experience
internal skill/provider topology
```

## Lineage

Lineage API 按权限裁剪：

- Public：只显示高层来源类别；
- Operator：显示安全引用；
- Admin：显示完整非秘密引用；
- Secret 永不返回。

## Error

错误响应不得泄露：

- SQL；
- Stack；
- Secret；
- Internal path；
- Other tenant existence；
- Provider credential status detail。

## Export

如支持导出：

- 权限；
- Tenant；
- Redaction；
- Watermark / Audit；
- Size Bound；
- Async Job；
- Expiry；
- 不含 Secret。

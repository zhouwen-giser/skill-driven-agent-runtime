# P11 Model Profile Contract

## 1. Profile

Model Profile 是运行时可用模型能力投影，不是 Credential。

至少包含：

```text
profile id
provider id
model id / version
capability tags
quality tier
latency tier
cost tier
context window
input / output modality
structured output support
tool calling support
data residency
data classification allowance
rate / capacity
readiness
health
profile version
```

## 2. 权威

```text
Provider Registry / Readiness
> Model Route Artifact

Credential Store
> Artifact / Profile Projection
```

## 3. Credential

Profile / Artifact 禁止保存：

- API Key；
- Token；
- Secret；
- Raw Credential；
- Private Endpoint Secret。

Invocation 只能通过现有 Credential Authority。

## 4. Readiness

至少：

```text
ready
restricted
degraded
disabled
unknown
```

`unknown` 不可自动当 ready。

## 5. Capability

Capability Tag 只能表示技术能力：

- structured output；
- reasoning tier；
- context；
- modality；
- tool-call support；
- latency / cost tier。

不能表示模型获得业务授权。

## 6. Version

Profile 变化触发：

- Cache Invalidation；
- Model Route Recheck；
- Revalidation Signal；
- Stale Cascade Step Discard。

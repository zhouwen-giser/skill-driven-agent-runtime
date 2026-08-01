# 09. 错误和 Operation 语义

## Problem Details

使用 `application/problem+json`，稳定字段：

```text
type
title
status
code
detail
instance
correlationId
violations[]
retryable
```

客户端只能根据 `code` 和 HTTP Status 处理，不能解析 detail 文本。

## Management Operation

状态：

```text
accepted → running → succeeded
                    ↘ failed
                    ↘ canceled
```

Operation 必须保存 Actor、Reason、Idempotency Key、Target、输入 Hash、结果或错误。

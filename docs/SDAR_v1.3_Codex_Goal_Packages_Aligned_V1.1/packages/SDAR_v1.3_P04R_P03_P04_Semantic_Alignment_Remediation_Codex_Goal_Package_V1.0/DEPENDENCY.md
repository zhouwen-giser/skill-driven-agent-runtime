# Dependency

## 前置

```text
P00 READY_FULL
P01 COMPLETED
P02 COMPLETED
P03/P04 implementation exists
```

P03/P04 可以处于 `READY_FOR_REVIEW_CONFIRMATION`，P04R 的职责就是修复并闭合它们。

## 后置

```text
P05 requires:
P03 = COMPLETED
P04 = COMPLETED
P04R = COMPLETED
```

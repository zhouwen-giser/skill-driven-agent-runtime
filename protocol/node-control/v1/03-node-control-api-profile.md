# 03. Node Control API Profile

## 协议

- REST + JSON；
- OpenAPI 3.1；
- SSE 用于节点变化提示；
- `application/problem+json` 统一错误；
- UTC ISO 8601 时间；
- Token Pagination；
- OAuth2/Bearer 兼容身份，首版允许部署侧 Service Token。

## 命令语义

长时命令返回 `202 Accepted + ManagementOperation`。前端或组织控制平面不得把 `accepted` 显示为最终成功。

## 查询语义

GET 返回控制面定义和 Runtime 观测的组合，但每个字段必须标明来源。统一使用：

```text
desired
observed
convergence
```

## SSE

事件只携带稳定 ID、Revision 和简要变化；消费者收到后重新 GET 资源。

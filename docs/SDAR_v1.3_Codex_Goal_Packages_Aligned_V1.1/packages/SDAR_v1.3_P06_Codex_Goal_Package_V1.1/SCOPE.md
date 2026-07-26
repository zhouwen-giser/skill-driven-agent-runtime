# P06 Scope

## 允许修改

按仓库实际结构映射到 compiler/shadow、compiler/promotion、compiler/revalidation、PostgreSQL、BullMQ、Management Governance、Server Shadow Hook、Migration、Tests、Docs、Reports。

## 可新增持久化对象

- artifact_shadow_run / result / metric；
- artifact_promotion_package / policy；
- artifact_approval / activation；
- artifact_status_transition；
- artifact_revalidation_trigger；
- artifact_rollback_record；
- artifact_canary_policy 仅允许治理合同，不实现在线 Canary。

如 P02 已有对应表，扩展现有权威，不建立第二权威。

## 禁止修改

P04 Candidate Definition、P05 ValidationResult/Dataset、v1.2.2 正式 Goal/Plan/Attempt/Outcome、v1.2.3 Experience/Planning、Fast Gateway、Retrieval、Applicability、Template/Rule/Case Runtime、Model Cascade、Provider/MCP/A2A 公共协议。

## 禁止输出

不得让 Candidate 进入正式请求；不得创建 Runtime Binding、Fast Path、Semantic Matcher、在线参数绑定；不得自动审批或自动恢复 Active。

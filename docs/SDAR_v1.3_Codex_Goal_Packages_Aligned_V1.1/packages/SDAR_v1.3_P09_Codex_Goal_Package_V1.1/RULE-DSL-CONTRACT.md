# P09 Rule DSL Contract

## 1. 目标

Rule DSL 必须：

- 严格类型；
- 可静态验证；
- 可确定性执行；
- 可审计；
- 无任意代码执行；
- 无网络 / 文件 / 数据库任意访问；
- 无动态 eval；
- 无 LLM Operator。

## 2. Operand

允许：

```text
request field
confirmed goal field
current plan field
trusted world state field
business event field
parameter binding
capability status
skill availability
provider readiness
policy result
authorization claim
time bucket
environment class
device class
```

禁止：

- Credential；
- 私有思维链；
- 未授权 Tenant 数据；
- 任意 SQL；
- 任意 JavaScript；
- 任意 HTTP；
- 直接 Memory Query。

## 3. Operator

首版允许：

```text
eq
neq
in
not_in
exists
not_exists
gt
gte
lt
lte
contains
starts_with
matches_safe_pattern
within_range
intersects
is_ready
is_authorized
changed_since
```

每个 Operator 必须定义：

- 输入类型；
- Null Policy；
- Unknown Policy；
- Case Policy；
- Locale Policy；
- Bounds；
- Version。

## 4. 逻辑

允许：

```text
all
any
not
```

必须使用三值逻辑。

### all

- 任一 false → false；
- 无 false 且存在 unknown → unknown；
- 全 true → true。

### any

- 任一 true → true；
- 无 true 且存在 unknown → unknown；
- 全 false → false。

### not

- true → false；
- false → true；
- unknown → unknown。

## 5. Condition 类型

### required

必须为 true 才能匹配。

### forbidden

true 时立即拒绝或不匹配。

### advisory

只影响 Advice，不授予执行权限。

### confirmation

true 或 unknown 时要求确认。

## 6. Rule Action

允许：

```text
advise
require_confirmation
deny
fallback
suggest_parameter
propose_plan_patch
```

禁止：

```text
execute_skill
call_mcp
create_attempt
start_workflow
complete_goal
grant_authorization
activate_artifact
```

## 7. Bounds

必须限制：

- Rule 深度；
- Condition 数量；
- String 长度；
- Collection 大小；
- Pattern 复杂度；
- Evaluation 时间；
- Patch Operation 数量。

超限：

```text
fallback / deny
```

由风险策略决定。

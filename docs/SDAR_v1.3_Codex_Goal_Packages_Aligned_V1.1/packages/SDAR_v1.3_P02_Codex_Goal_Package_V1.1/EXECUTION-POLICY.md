# Execution Policy

模型：
GPT-5.6 Sol Medium

原则：

- 先理解现有Persistence架构。
- 不引入新的ORM模式。
- 不绕过Repository。
- 不修改已有Authority。

禁止：

- Fast Gateway
- Runtime执行
- MCP调用
- Skill调用
- 新Workflow Engine

Migration必须：

- 可重放
- 可回滚
- 可测试


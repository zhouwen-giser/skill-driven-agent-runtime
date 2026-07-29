# Execution Policy

模型：
GPT-5.6 Sol Medium

原则：

1. 先理解现有Domain模式。
2. 不新增重复抽象。
3. 不为了未来方便提前实现Runtime。
4. Domain Contract优先于业务实现。

禁止：
- migration
- repository
- controller
- API
- worker
- queue
- MCP调用
- Skill调用

修改必须集中于：
domain/schema/type/architecture tests。

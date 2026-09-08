# D10 — 并行测试环境与验证层级

## 必需的独立测试

本任务不依赖SMPP分支完成。建立：

```text
真实GOWM已安装的隔离PostgreSQL
    ├─ ugv_sdar：由真实SDAR代码写入
    ├─ gowm_device / gowm_task：当前合同
    └─ ugv_smpp：测试同伴按合同发布必要的合成MCP行

真实SDAR正常应用路径
    ↔ 当前Frozen MCP协议测试桩
```

MCP桩提供tools discovery、Task接纳、poll、result、input/cancel和必要events，使用仓库当前协议Schema验证，不臆造新版协议。

模型可采用现有deterministic model fixture，任务输入、计划确认、工作流、MCP调用、回执处理和A2A终态经过生产代码。明确测试不依赖真实LLM API。

## 数据库准备

只使用显式 `GOWM_BUSINESS_TEST_DATABASE_URL` 与 `GOWM_BUSINESS_SMOKE_ENABLE=true` 的隔离库。测试库与并行SMPP工作使用不同名称，避免互相清理；隔离的是测试环境，不是为每设备建立业务Schema。

沿GOWM已有安装器/交接SQL准备，遵守其core和extension前置，不在SDAR实现另一个迁移所有者。可由只读检出的GOWM代码安装到测试库，输出放在SDAR报告目录或临时目录，不改GOWM源码。不能为了方便从旧未包含078的main安装。

默认命令不依赖Docker；可使用已部署测试PostgreSQL及现有Redis。若正常路径需要Redis，使用显式隔离Redis database/key prefix或现有可替换队列端口，不能假装生产队列未参与。需要数据库的测试缺环境输出NOT_RUN；单元/合同继续运行。

## 两个设备与重复身份

同库同Schema登记A/B两个测试设备、服务绑定，使用同名nodeId、相同caller idempotency文本、相同协议桩remote task文本及相同provider/stream局部标识。实际SDAR内部Task/Plan/Instance/Run身份仍按真实代码生成。

业务链最少包含：
- 一个Point移动目标。
- 一个Polygon观察目标；沿已有Skill输入或测试注册的无害fixture Skill，不新增实际观察控制能力。
- 同名Node的Retry或循环及一个未执行分支。
- 正常终态、取消、等待输入、重启恢复。

## 桩的写入边界

生产SDAR的数据库角色不授予ugv_smpp DML。只有测试同伴/Fixture Seeder的独立测试角色可在隔离库发布GOWM约束允许的合成provider_task；必须标记 `SYNTHETIC_MCP_PEER`，不执行真实设备、不给实际Mission通过结论。

SDAR必须只消费其协议回执并验证表中canonical父记录。不能在SDAR运行代码中偷偷加入 `ensureProviderTask` 创建假SMPP数据。

测试应有两个时序：
1. 父MCP行先发布，再返回Task回执：立即解析canonical。
2. 回执先返回，父行后发布：先保存NULL，后续关联补齐；没有第二次MCP创建调用。

还要验证无父记录/不透明远端ID时SDAR保留有效协议结果、未解析关联与准确报告，不假称全链已闭合。

## 共享协议身份不改造

父行UUID必须来自桩真实返回的匹配Task身份，而不是SDAR随机生成一个ID。故意返回不透明ID的场景只能在桩提供明确映射证据或协议允许时解析；否则保持未解析。

## 实际GOWM回读

从 `gowm_business_v1.sdar_tasks / workflow_steps / task_target_geometries / task_execution_lineage` 验证自己的记录。canonical已知但Provider/Mission未产生时，read model仍可能给PROVIDER_PENDING，属预期，不通过伪造Mission让状态变LINKED。

Task lineage分别查看steps、targets、lineage，确保Native Event与Remote Node Run未笛卡尔合并。

## 可选双方联调

SMPP并行分支可用后，使用它的正常Runtime在另一个显式测试环境运行一次互操作。只读取/调用它，不修改其代码。报告实际两仓commit、合同、协议请求ID、SDAR Task、Remote ID、canonical ID及GOWM回读。

这项未运行不阻碍本任务SDAR存储INTEGRATION_DEV_READY；不得把桩测试写成真实SMPP联调PASS。

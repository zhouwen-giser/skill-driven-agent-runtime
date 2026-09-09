# D02 — 连接、启动与事务

## 配置

建议新增或复用以下清晰配置，最终按当前项目风格实现：

```text
SDAR_STORAGE_MODE=gowm-shared
GOWM_DATABASE_URL=<由部署注入>
SDAR_SERVICE_KEY=<稳定逻辑服务>
SDAR_ALLOWED_DEVICE_IDS=["实际deviceId-A","实际deviceId-B"]
SDAR_DEVICE_ID=<仅单设备专用实例可显式配置；可空>
SDAR_GOWM_CONTRACT_DIR=contracts/gowm-shared-storage/current
```

这些是本任务建议的配置名，不是已存在环境变量。`allowedDeviceIds`解析JSON数组；空集合不等于所有设备。单设备实例可显式绑定一个设备作为请求上下文，多设备入口没有明确设备就返回清晰缺少上下文，不选数组第一项。

保留既有非UGV/非设备使用入口，避免一项改造破坏通用SDAR；共享模式每个进程只有一个业务主库，不双写，故障时不回退public或旧库。旧模式不是新建长期多版本产品。

`GOWM_DATABASE_URL`与现有runtime DB配置冲突时明确报错或清晰配置优先级，禁止一部分Repository仍写旧库。独立Node Control配置库、管理数据库不在本次迁移范围；runtime侧本已依赖且GOWM已托管的配置/证据记录仍须适配。

## 固定命名空间

应用业务SQL指向 `ugv_sdar`。查询设备目录使用 `gowm_device`，空间目标使用 `gowm_task`，canonical关联只读 `ugv_smpp`。共享模式不执行 `public.agent_task`、`public.goal`、`public.remote_task_binding` 等业务SQL。

保留PostGIS/pgvector等扩展的真实Schema引用。不要对整个代码做 `public.` 全文替换。检查显式qualified SQL、regclass、序列、存储函数、prepared statement、表发现和迁移检测路径。

采用显式固定Schema或连接初始化的固定search_path；不要一次pool.query(SET)后假设下一次查询落在同一连接。不得设置整个数据库的全局search_path，不接收用户指定的schema/table字符串。

一个业务连接配置每进程复用有限连接池，不为每个设备创建Pool。若既有Readonly/Worker连接池独立，全部核对实际database和schema。

## 启动只验证

共享模式关闭 `apps/server/src/runtime.ts` 的baseline / planPostV122MigrationFiles应用、init脚本、自动建表/重置/ALTER。原生Standalone安装路径继续受旧模式约束，不能误用到共享库。

启动验证SDAR消费子集：
- GOWM公共设备/目标表与SDAR所需安装记录存在。
- `ugv_sdar.gowm_install_history`中原生family和四层SDAR overlay与摄取记录匹配。
- partial unique index、nullable语义、`canonical_mcp_task_id`触发器、设备归属/父级约束存在。
- 原生Task revision、命令上下文等触发器仍存在，权限满足正常DML。
- pgvector等当前SDAR功能实际依赖可用；不为此执行CREATE EXTENSION。
- 当前逻辑服务绑定的设备与scope匹配。

只校验SDAR所需 `ugv_smpp.provider_task` 等读取结构/权限，不要求SMPP服务在线、无须MCP任务已存在；不得把上游全量verify当启动前置而额外要求无关UGV运行能力。GOWM公共视图当前可能依赖两域安装：测试前验证环境已完整安装，不用空视图伪造通过。

结构不匹配停止本存储模式接纳有副作用工作，给出GOWM_STORAGE_CONTRACT_MISMATCH。无DDL自修复、无旧库fallback。服务不可用沿用正常bounded retry与退出语义。

## 保留事务与Task authority

现有Task revision/command authority、初始Admission、Workflow确认、Continuation、结果提交等事务边界必须保留。

统一事务函数向下传同一个PoolClient；目标绑定、canonical补齐与其对应业务记录需要原子性时使用同一个client，不在子函数中另开pool.query。现有AsyncLocalStorage事务机制可以复用，但不得与可变全局currentDeviceId混用。

MCP调用、模型调用、长时间等待都在数据库事务之外。先持久化意图，提交后外部调用，回执回来再进入结果事务。不能把网络调用包进持锁事务，不能宣称同库能保证跨服务/物理exactly-once。

仅验证Task lineage的诊断查询失败，不应自动重发远程任务。删除/清理策略不得破坏业务历史，见D09。

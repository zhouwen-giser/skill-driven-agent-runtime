# SDAR / GOWM 共享存储开发交付

状态：**SDAR_GOWM_SHARED_STORAGE_INCOMPLETE**。本报告交付可审查的实现及当前证据，不宣布原任务包全部完成。

正常 Server 已接入固定 `ugv_sdar`，Task/Plan/Workflow/事件/Invocation/Remote 继承设备归属；目标保留 REQUESTED/PLANNED/DISPATCHED 与局部 CRS，延迟 canonical 补齐不重发工具。子调用、事件、取消和 Evidence/retention 有分项实现与证据，全部覆盖范围以验收索引为准。

本轮检查：351 个文件、3064 项 unit/contract 全通过（124.36 秒）；lint、typecheck、构建、架构、协议、136 个代码文件格式、87 文件离线合同检查通过。最终两个测试 helper 仅改为既有公开导出；该变更经过架构、完整测试、构建和 PG driver，未重跑此前 lint/typecheck。PostgreSQL driver 26 组通过。日志见 `development-checks/`，数据库结果见 `postgres-results.json`。

正常 Remote 代表链见 `runtime-smoke-results.json`：双设备工具共调用 2 次，2.0 continuation 成功，父记录延迟出现后 canonical 补齐、无新增调用；模型桩失败和清理错误均为 0。之前的子调用、事件、binding 取消和父 Task 取消报告仍保留。全部是隔离数据库/本地协议桩证据。

## 未完成与阻塞

- 上游临时 Skill 终态触发器遗漏 experience.device_id，导致 Task 终态事务回滚。
- 上游辅助 Provider link 的全局唯一键不能表达两设备相同 handle。
- `verify:migrations` 因 Docker EPERM 失败，启动清理尝试也被拒绝；未为此新增 Docker 环境，不计为通过。
- 真正进程重启/过期回调组合、所有后台及共享来源范围、可选配置装配和完整 Artifact/Usage 子链仍未全面证明。既有启动模型路由告警和 canonical backlog 不因代表链通过而关闭。
- 演化完整发布、完整 Console 和发布级验收继续延期。45 项原验收全部保留于 `acceptance-results.json`，未用历史 PASS 冒充本次全部通过。

上游缺口详见 `docs/gowm-shared-storage/UPSTREAM_STORAGE_GAP.md`。未修改 GOWM/SMPP，没有 DDL 绕过、影子副本、真实设备调用或用户部署切换。

## 清理与交付

两个本任务隔离 PG/Redis 容器及 PG 匿名测试卷已删除，精确名称回查为空。测试证据已落盘；用户运行实例未操作。之前被权限拒绝的迁移脚本没有成功启动已确认资源。

单仓提交、push 和 Draft PR 待执行；不自动 merge/tag/release/deploy。实现身份与检查边界见 `FINAL_REPORT.json`，报告本身不参与实现输入 hash。

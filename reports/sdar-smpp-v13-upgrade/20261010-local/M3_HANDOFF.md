# M3 阶段交接

状态：本地 COMPLETE。工作包：W3 原 RequiredInput、受管导航、单发送者。HEAD `52f54a11a40380f7c73bd9da277d640e49bdfbf7`；实际 gate 输入 `5d63724fa4944d3a52a0b8875be97898cde2a8ecd323633151191ad4b9e21496`。

完整阶段命令、环境、30 项结果和日志见 [M3_VALIDATION.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/M3_VALIDATION.json)。逐项最终实现和精确测试关联见 [CASE_RESULTS.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/CASE_RESULTS.json)。原失败记录见 [FAILED_ATTEMPTS.json](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/FAILED_ATTEMPTS.json)。

复用原 Frozen MCP/Registry、RemoteTaskBinding/authority、Task/Skill/单 LangGraph 和原生 continuation。持久投影、完整 bytes 和命令 journal 在原 observations 中；确认消费与最终发送 claim 原子，失去响应后仅有限只读核对。

仅原生输入约束增加 0184；GOWM 使用 owner 合同，不执行消费者 DDL。rollback-preflight 拒绝未决写接管，down 拒绝保留的 remote inputs。详见 [迁移和回滚](/home/sz/code/skill-driven-agent-runtime/reports/sdar-smpp-v13-upgrade/20261010-local/MIGRATION_AND_ROLLBACK.md)。

下一阶段/维护输入：保留 exact Task/Execution 身份和 frozen contracts；不要用 accepted 代替 applied，也不要用 completed 代替 Skill 成功。当前未授权现场项为 NOT_RUN；没有 push、PR 修改、merge、deploy 或现场动作。历史阶段未覆盖的新增场景以 M4 和最终 CASE_RESULTS 为准。

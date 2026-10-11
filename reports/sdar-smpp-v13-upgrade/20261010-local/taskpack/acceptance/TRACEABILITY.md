# 需求—任务—验证追踪

这些编号是本次升级任务包的局部追踪 ID，不取代仓库既有需求编号。W0 必须映射到真实需求/ADR，再增量更新仓库 `docs/17_TRACEABILITY_MATRIX.md`。实现与测试尚未执行，因此不预填 PASS。

| 需求 | 内容 | 工作包 | 验收场景 | 实现/测试/证据 |
|---|---|---|---|---|
| UPG-V13-R01 | 固定部署兼容合同与治理 successor | W0 | AC-001, AC-002, AC-003, AC-004 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R02 | 原任务/Execution/authority 精确关联 | W1 | AC-006, AC-007, AC-008, AC-009, AC-010 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R03 | 完整分页分块及精确版本读取 | W1, W2, W4 | AC-008, AC-011, AC-033 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R04 | 复用事件 inbox、双水位和 continuity | W2 | AC-012, AC-013, AC-014, AC-015, AC-016 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R05 | 正式 Skill/Agent 消费受校验业务投影 | W2 | AC-017, AC-018 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R06 | 真实控制授权、单发送者和取消边界 | W3, W5 | AC-019, AC-028, AC-029, AC-030, AC-048 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R07 | 原任务 RequiredInput 闭环 | W3 | AC-020, AC-021, AC-022, AC-023, AC-024 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R08 | 同一任务运行中导航调整与 applied 确认 | W3 | AC-025, AC-026, AC-027, AC-028 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R09 | 技术终态、业务结果和证据质量分离 | W4 | AC-031, AC-037 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R10 | 完整实际轨迹与几何角色分离 | W4 | AC-032, AC-033, AC-035 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R11 | Provider 接收时间为 canonical 源时间 | W0, W4 | AC-005, AC-034, AC-035 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R12 | 估算/未知/缺失不伪装为真实完成 | W4 | AC-036, AC-037 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R13 | 正式确认链及 evidence 输出兼容 | W4 | AC-038 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R14 | 只恢复原读取/核对，防止重复执行 | W1, W2, W5 | AC-010, AC-013, AC-039, AC-040, AC-041 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R15 | 两条正式入口隔离端到端链 | W5 | AC-042, AC-043 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R16 | 迁移与未决命令回滚保护 | W5 | AC-039, AC-044 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R17 | 现场授权与本地/现场分层验收 | W5 | AC-045, AC-046, AC-047, AC-048 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R18 | 同源完整门禁与失败证据保留 | W5 | AC-049 | 待执行者填入真实路径；NOT_RUN |
| UPG-V13-R19 | 现有 GOWM 正式存储边界 | W5 | AC-039, AC-050 | 待执行者填入真实路径；NOT_RUN |

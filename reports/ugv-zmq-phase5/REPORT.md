# ZMQ 消费候选验收（2026-10-25）

本轮源码 `9cd615b4da06f91386067dec92d0116a5f77dd95`，分支 `codex/ugv-zmq-phase5-20261024`。
状态：候选实现和完整门禁已验证；正式治理、原生任务链/巡逻后继及现场资格仍开放。

- pin 精确 12 工具目录、输入/输出、Task Profile、资源和执行语义；校验 Provider/目录身份及
  revision/checksum，保留 explicit confirmation / 禁止物理重放约束。
- 通过现有 JsonSchemaValidator 端口注入校验，不在 UGV 模块引入外部 schema SDK。
- timeWindow 使用父期限剩余预算与 300 秒较小值；证据不足的检查持续降级。
- 11 项新增单元用例通过；真实 SMPP 冻结 discovery adapter 对正式隔离 Runtime 的只读目录
  验证通过，物理调用 0。该探针不构成 SDAR 治理发布或真实 Skill 执行。
- 完整隔离门禁 `sdar-verify-d392206e-dc0d-4ad9-ad43-f58fb94f85c2` 全部通过，退出/清理码 0，runtime/baseline
  输入未改写。细项、实际测试数和既有分组跳过见 `raw/sdar-full-summary.json`。
- 新建 Docker bridge 宿主机连接失败已保留；显式默认 bridge 选项保留真实就绪、项目/卷与
  清理检查。它不提供网络租户隔离。系统 Python 缺 ensurepip 的失败也保留，最终使用独立
  Python 3.12.14；另保留基线窗口漂移 19.064% 的失败，再以固定 8 核 CPU 亲和性整轮验证。
  未改测试阈值或产品依赖。官方 TCK 的 http_json/MUST 为 74 passed、
  161 skipped、30 deselected。

SMPP 验证源码 `2f4eeb1f57343742bec3886847e8a4892cc185ed`；正式 MCP/native ZMQ/PostgreSQL 12 项验收通过。
GOWM 本轮仅为 SQL/RLS 组件验证，完整 owner 部署未验收。G0 缺 12 项外部材料，未切换
19100/19101，未发送现场设备命令。旧 inspection/patrol 身份及历史证据保持原合同。

`verification.json` 固定运行身份、输入摘要及原始日志/证据 SHA-256；双项目源码候选包的最终
提交与包/镜像哈希另在 `/mnt/data/ugv-zmq-phase5-20261024/delivery/` receipt 固定。

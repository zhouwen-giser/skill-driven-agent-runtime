# 完整证据样例

以下是本次冻结门禁实际生成的原 Task 导出。JSON 包含 A2A artifacts、逐个规范 Source ArtifactRef、完整 canonical envelope 与原始内容字节（base64），以及确认事实、消费 claim、Provider receipt、自己 command 的 applied 核对。

- [vehicle_area_recon](/home/sz/code/skill-driven-agent-runtime/reports/runtime-semantic-closure/sdar-verify-80dc2518-c4ae-47d4-b2ac-ac58d2d85506/snapshot-reports/sdar-smpp-v13-upgrade/20261010-local/formal-vehicle_area_recon-b2c388fe-b3ae-4c3d-86d2-6b0107bd73d9/evidence.json): Task `bf75153b-832c-4898-893d-b83a3046fdf3`，6 个完整源 Artifact，原 Tool 调用 1 次。
- [vehicle_navigate](/home/sz/code/skill-driven-agent-runtime/reports/runtime-semantic-closure/sdar-verify-80dc2518-c4ae-47d4-b2ac-ac58d2d85506/snapshot-reports/sdar-smpp-v13-upgrade/20261010-local/formal-vehicle_navigate-920fd123-15e6-4894-b102-19b0eee2b64d/evidence.json): Task `329a5f4f-2958-42d7-991f-a8cde4578597`，6 个完整源 Artifact，原 Tool 调用 1 次。
- [同一发布 Skill 的失败反例](/home/sz/code/skill-driven-agent-runtime/reports/runtime-semantic-closure/sdar-verify-80dc2518-c4ae-47d4-b2ac-ac58d2d85506/snapshot-reports/sdar-smpp-v13-upgrade/20261010-local/formal-vehicle_navigate-920fd123-15e6-4894-b102-19b0eee2b64d/same-skill-negative.json)：协议 completed 保留，业务失败事实改变模型输入/输出，原生 Task 拒绝成功。

轨迹保留 Provider 提供的全部 256 个点及原始顺序。未提供的逐点时钟与完整事件历史明确为 gap。大于 1 MiB 内容的分块、哈希、损坏拒绝与源读取由 AC-033 真库和合同测试另外验证。

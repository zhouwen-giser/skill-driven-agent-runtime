# 原生 ZMQ Skill：隔离装配与调用

入口 `apps/node-control-acceptance/src/zmq-skill-governance.ts` 的
`governNativeZmqSkills` 只接受 `qualification: isolated_simulator`、数字回环 HTTP
管理地址及回环 Provider。19100/19101 禁止作为此入口的目标。Provider ID、resourceId、
simulationId、本地服务和 Binding 身份来自实际隔离实例，不能猜测现场值。

每个公开工具对应 `ugv.zmq.<tool>` Skill、`vehicle.ugv.zmq.<tool>` Capability 和
`a2a.vehicle.ugv.zmq.<tool>` Exposure。装配返回实际版本；调用须使用该版本。
通过既有 A2A `message/send` 提交 JSON part 和以下 metadata（值为隔离示例）：

```json
{
  "idempotency_key": "unique-request-id",
  "io.sdar/requestedCapability": {
    "exposureId": "a2a.vehicle.ugv.zmq.vehicle_zmq_inspect_area",
    "versionConstraint": "1",
    "requestId": "unique-request-id"
  },
  "structured_input": {
    "resourceId": "vehicle:SIMULATED",
    "area": {
      "crs": "OGC:CRS84",
      "searchStrategy": "track",
      "vertices": [
        { "longitude": 106, "latitude": 29, "ellipsoidHeightM": 10 },
        { "longitude": 106.001, "latitude": 29, "ellipsoidHeightM": 10 },
        { "longitude": 106.001, "latitude": 29.001, "ellipsoidHeightM": 10 },
        { "longitude": 106, "latitude": 29.001, "ellipsoidHeightM": 10 }
      ]
    },
    "timeWindow": {
      "earliestStart": "2026-10-25T08:00:00.000Z",
      "deadline": "2026-10-25T08:05:00.000Z"
    }
  }
}
```

调用时填写当前有效时间窗。区域为 WGS84、经度在前、严格四点凸多边形，椭球高必须明确。
控制任务先等待计划确认；经既有 `sdar_action: confirm_plan` 流程确认当前 Task 后执行。
只读 Skill 没有 timeWindow。工具缺失、Schema/Profile/身份变化、过期和未知占用均拒绝。

输出为 `sdar.zmq-skill-report/1`，`providerResult` 保留原报告；`status: degraded` 与
`missingEvidence` 表示报告不完整。HTTP 成功、接纳或 SDAR 已完成均不代表空间覆盖完整。
取消必须核实远端终态和通道释放；回执丢失不重发控制。已有任务只恢复查询与订阅。

大 Agent Card 的 Evidence 内联 `card` 是明确的引用描述。按 ADR-167 从认证 revision 内容 API
取回完整 `card`，使用 `verifyNodeControlCardArtifact` 校验；不能将引用描述当完整卡片。

隔离复现：配置私有 PostgreSQL/Redis 文件后运行 `scripts/ugv-zmq/governance-joint.mts`。
环境变量为 `SMPP_ZMQ_GOVERNANCE_CONFIG_FILE`、`SMPP_ZMQ_SOURCE_ROOT` 和
`SMPP_ZMQ_GOVERNANCE_EVIDENCE_ROOT`；配置文件权限 0600，证据目录 0700。
夹具只创建自己拥有的数据库、回环端口和 Schema，结束导出证据并清理。
回退时通过既有 CAS suspend 本次 Exposure/Capability，重建卡片；保留版本、任务及报告。

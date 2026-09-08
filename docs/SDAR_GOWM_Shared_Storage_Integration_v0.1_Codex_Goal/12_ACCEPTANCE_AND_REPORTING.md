# D12 — 验收与交付口径

机器验收条目见 `acceptance.json`，测试设计见 `test-scenarios.json`。包内这些状态都是待执行设计，不是项目测试结果。

## Required核验

实现必须涵盖正常路径，不允许靠测试专用Writer代替业务Repository。检查、协议回归、已有Task authority、目标绑定、延迟canonical、设备领取、事件订阅与数据库事务均需有证据。

SOURCE_READY只适用于代码工作已完成且无已执行必需测试失败、但环境验证尚未运行。缺GOWM schema能力导致某项必需实现无法工作，应报告INCOMPLETE及准确缺口，不用环境NOT_RUN掩盖设计冲突。

INTEGRATION_DEV_READY要求本任务真实数据库和正常SDAR代码路径通过，但允许MCP同伴是明确标注的协议桩。真实SMPP互操作单列，不与桩结果混淆。

## 报告位置

```text
reports/sdar-gowm-shared-storage-integration-v0.1/
  FINAL_REPORT.md
  FINAL_REPORT.json
  schema-consumption-matrix.json
  worker-scope-inventory.json
  acceptance-results.json
  postgres-results.json
  runtime-smoke-results.json
  optional-smpp-interop.json
```

只记录真实命令、exit code、数量和运行范围；未运行报告NOT_RUN，不拷贝GOWM旧PASS作为本次证据。记录实现提交/树即可，不建立报告文件引用自身最终提交的循环门禁，不因上游HEAD变化反复重测。

## 后续消费者交接

输出 `docs/gowm-shared-storage/README.md`、配置示例、旧库保留/新库独立启动说明、并行边界、人工切换前检查、已知限制。不要生成自动DROP旧库、自动搬迁旧数据或启动真实控制的脚本。

给SMPP工作线的最小对接说明仅包括：双方使用的deviceId/service/provider/resource绑定、当前MCP合同、Remote ID到canonical的确定条件、各自写表范围和测试调用方式。SDAR不依赖SMPP代码目录、不强制等待SMPP新提交。

## 上游缺口处理

`UPSTREAM_STORAGE_GAP.md`记录具体DDL/触发器、失败SQL、实际参数结构、最小复现和缺少能力。不执行ALTER、不关闭约束、不增加shadow业务表。能通过本仓SQL/传参/事务修正的不是上游缺口，应自行完成。

## 交付动作

在单独分支提交并推送，创建Draft PR：

```text
feat(storage): integrate SDAR with GOWM shared device business storage
```

无网络/写权限时如实保存本地提交和PR说明，标注交付未完成，不虚构URL。不自动合并、发布、打Tag或部署。

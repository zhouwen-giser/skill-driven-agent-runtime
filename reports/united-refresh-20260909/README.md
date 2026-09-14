# 联合部署包上游更新 — 2026-09-09

已完成本地联合源码包刷新。本次不部署服务器，不执行设备动作。

## 脚本检查结论

`deploy/united/package.mjs` / `bundle.py` 和 SDAR 源码打包器无需修改。上游路径是显式参数，外层摘要、逐文件清单、嵌套身份和 Authority 校验均兼容最新 schemaVersion 1/live 输入。更新 README 示例和变更记录；没有更改业务代码、数据库或治理逻辑。

最新本地上游：`smpp-gowm-gdps-gsap-telemetry-1579eae9c89bfded.tar.gz`（2026-09-09 22:00 生成）。SHA256：`436c3706708daa5e2a20e4d2c3fecc595584ee2eed85ebcaafa8d38841b184b6`。原字节嵌入，GOWM/GDPS/GSAP/SMPP/Telemetry/ClickHouse 定义保留；491 项 Authority schema 和 release seed 与原 a2605b5999e8cd2f 包完全一致。嵌套 revision/摘要见 upstream-validation.json。

## 交付身份

- 归档：`/home/zhouwen/web-download/skill-driven-agent-runtime/artifacts/united/sdar-united-83214f815640f6688da1/sdar-united-83214f815640f6688da1.tar.gz`
- SHA256：`9f08a3c7aa7244d0e15223cdddc10dfaa8d87913a869403cf9de70dacbc2d34f`
- SDAR revision：`1cc74d698bedb813b637f69c03e8306e97144b13`
- SDAR sourceHash：`29fdcfe193d6da6f93c2ce191f904caf64e485ae26022f9e35cc5c0154e5ee99`（2780 个源码文件，含本次有效文档修改）。
- 外置清单和校验文件与归档在同一交付目录。

## 验证

- `python3 deploy/united/bundle_test.py`：4 个回归测试通过（含错误摘要、缺失文件、危险路径、源码遗漏、敏感文件排除、重复生成及输出冲突子场景）。
- `pnpm package:joint -- --upstream <上述上游绝对路径> --output artifacts/united`：生成成功，相同输入第二次运行结果逐字节一致。
- `python3 deploy/united/bundle.py verify <归档>`：独立校验通过；外层及所有嵌套身份、逐文件源码摘要通过。
- 干净解包目录 `pnpm build` 及共享存储配置生成通过。依赖采用本地完整副本，源码无原目录链接；临时构建目录已移除。
- 递归扫描 9083 个文件，对照 12 个本地私密值，匹配 0；文档测试公开示例不计为私密值。
- `git diff --check` 通过。

初次打包回归及生成被沙箱的 `spawnSync git EPERM` 阻止，原日志保留；相同代码与命令在获准的沙箱外执行通过。本次没有执行代码变更，未重新运行全仓业务门禁；此前门禁证据保留于 reports/resource-identity-20260909，不能视为本次新上游的现场业务验收。

新包与当前 sz-gowm 上游版本可能不同，本次未连接服务器确认或更新。巡逻等待 GOWM `embodied.inspect_area` 的已知阻塞仍有效；不声明完整业务验收。报告在源码输入外保存，避免把交付摘要写回其自身归档。

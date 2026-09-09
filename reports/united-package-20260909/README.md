# 联合源码包交付验证（2026-09-09）

范围：本地实现与生成源码交付物，不连接或更新 sz-gowm。上游固定为带 Authority 的 a2605b5999e8cd2f 联合包，原字节 SHA256 为 `071abb75bf8d231b4d794e5681611ab0f00e26076a73efb3ebe82beccc3ba0d5`。

## 实现与证据

- 入口：`pnpm package:joint -- --upstream PATH [--output DIR]`。
- 包结构、外部配置要求及正式部署顺序：`deploy/united/README.md`。
- 历史现场事项、修复与恢复边界：`deploy/united/DEPLOYMENT_HISTORY.md`。
- 回归：`apps/server/test/united-package.unit.test.ts` 调用 Python 标准库 4 组回归，覆盖嵌套身份、Authority、路径/链接/重复条目、缺失源码、敏感文件、稳定归档及输出冲突；已有 development-deployment 回归同时运行。
- 完整 gate 原始结果：`gate.json` 与逐项日志。首次 lint 发现入口 URL 及历史现场辅助脚本的全局声明缺失；补充显式引用，不关闭规则，重跑结果见 `lint-final.log`。
- 沙箱 Node 子进程曾返回 EPERM，相关检查在宿主环境重跑，未降低断言。
- 干净源码构建：`clean-validation.json`、`clean-build.log`、`clean-config.log`。从验证后的归档解包，依赖使用本地副本，源码不链接原工作区；不等同断网安装依赖验收。
- 敏感值扫描：`secret-scan.json`。真实私密配置值与公开开发测试常量分开统计；不输出任何实际私密值。

## 限制

不附离线镜像，不进行远端重建、数据库迁移或设备调用；不声明新机全栈部署及模型驱动完整业务 Task 验收。上游包按原身份固定，后续现场部署仍须核对实际运行版本。

最终交付身份与完整结果在验证完成后写入本目录的 `package-final.json`、`validation-summary.json`。

## 最终验证结果

格式、完整 lint 重跑、类型、单元/性能 2534、集成 242、协议 534、E2E 75、production build、本地 smoke 均通过。最后的打包边界调整通过 6 个部署回归和受影响 lint。E2E 驱动分两次运行性能用例，日志中的过滤 skipped 不代表遗漏；所有 75 项均已执行。

最终复核额外修正：自定义输出目录整体排除，防止旧 delivery.json 被重新收入源码；已删除工作区文件跳过；相关专项回归和 lint 重跑通过。最终归档重新构建、扫描并重复生成验证。

最终归档：`/home/zhouwen/web-download/skill-driven-agent-runtime/artifacts/united/sdar-united-34cc46c4e334d8c35d99/sdar-united-34cc46c4e334d8c35d99.tar.gz`

SHA256：`01483f39eac04a555d4868c44cc6b94b269a9266bb3db83206698f6534b5f408`。大小 29930836 bytes；重复生成 IDENTICAL，随包独立校验器 PASS；最终解包构建与配置 PASS。临时构建目录及本次专属测试容器已清理，原本地开发服务保留。

# SDAR 源码联合部署包

一键生成（Node.js 22、pnpm 11、Python 3、Git、GNU tar）：

```sh
pnpm package:joint -- --upstream /absolute/path/smpp-gowm-gdps-gsap-telemetry-a2605b5999e8cd2f.tar.gz --output artifacts/united
```

上游文件旁必须有同名 `.sha256`。默认输出 `artifacts/united/sdar-united-<内容摘要>/`，内含归档、SHA256、UNION.json、SHA256SUMS、delivery.json。自定义输出目录也会从源码输入中排除，不能将仓库根目录作为输出目录。相同输入重复生成复用完全一致的交付目录；发生冲突立即退出。源码包括 Git 枚举的有效未提交文件，身份由 revision 与逐文件 sourceHash 共同确定。

沿用 Development 的可信内网基线：管理接口不提供外部认证，不应暴露到公网。

本入口只生成源码包，不执行部署，不复制模型密钥，不包含离线镜像。目标默认 linux/amd64；目标机需有依赖和镜像获取能力。SHA256 用于完整性核对，输入归档应来自可信交付渠道。

## 校验与解包

先在归档所在目录运行 `sha256sum -c sdar-united-<摘要>.tar.gz.sha256`，再解压。包内校验器可校验原归档及所有嵌套身份：

```sh
python3 <解包目录>/bundle.py verify /absolute/path/sdar-united-<摘要>.tar.gz
```

`UNION.json` 记录上游原归档摘要、完整上游清单、SDAR 源码身份。`SHA256SUMS` 是归档根目录的逐文件清单；外置同名文件为该清单副本。

## 部署顺序与边界

1. 将 `upstream/telemetry-united.tar.gz` 解压到独立 release 目录，按其 README 使用正式入口。GOWM/GDPS/GSAP 基础包和 SMPP 仍按内层正式入口部署，Telemetry 的 `deploy.sh up --smpp-root ...` 接入已有、身份匹配的 SMPP。Authority 的原 schema 与 release metadata 原样保留。
2. 将 `sdar/source.tar.gz` 解压到新的 SDAR source 目录。按其中 `deploy/sz-gowm/README.md` 准备 GOWM 共享业务存储、pgvector、独立 Control 库以及外部网络；沿用 `deploy/development/README.zh-CN.md` 的构建和部署入口。
3. 现场私密配置由运维在包外提供，权限 0600；模型密钥不进入归档。默认使用 ugv-agent-profile、非武器副作用 YES 和 auto_non_weapon；保留已有显式运维配置，武器/效应器执行仍排除。SMPP 保持实际部署模式。
4. 配置正式 PMS Registry 身份，SDAR 默认执行治理 bootstrap；检查共享存储合同、设备绑定只读预检、健康和逐项公开能力清单。缺失 Registry、初始化失败或预期项未发布时返回非零。设备继任绑定与数据库重建属于显式运维变更，不能仅因执行打包或校验触发。

已有 sz-gowm 部署不应重新执行基础设施初始化。升级前核对现场上游身份、在途任务、数据库备份及卷；数据库已经使用 vector 后，恢复镜像必须保留扩展文件。SDAR 回退仅停止自身 Compose 并保留状态，不删除共享 schema 或上游数据卷。现有 attach-device 工具拒绝有 UGV execution 历史的场景，不把它当作通用在线迁移工具。

本包通过打包、解包与源码验证不等于全栈新机部署验收。历史现场验证见 DEPLOYMENT_HISTORY.md。

内置巡逻 `embodied.area_patrol` 当前等待后续 GOWM 提供 `embodied.inspect_area`，保留明确阻塞；其他 12 项已在 sz-gowm 公开。完整清单验收仍未完成。包内不携带 PMS 或 SDAR 离线镜像。

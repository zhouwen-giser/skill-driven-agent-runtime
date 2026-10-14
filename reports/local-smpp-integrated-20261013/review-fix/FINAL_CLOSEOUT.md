# 本地联合部署交付核验（审查修复后）

本地核心部署已验证；完整 13 项初始化仍缺少 `embodied.inspect_area`，`embodied.area_patrol` 未发布。全项目验收、设备生成历史完整性、生产耐久性及完整演化范围保持开放，现场动作和远程部署为 NOT_RUN。

| 核验 | 实测结果 | 证据 |
| --- | --- | --- |
| 深层包清单 | 10 个 Python 方法，6 个新增反例；真实源联合包校验通过 | PYTHON_COMMAND.json、OPERATION_COMMANDS.json |
| 完整隔离 | 30 项通过，2695 单元 / 553 合同 / 272 集成 / 77 E2E，安装/退出/清理 0 | VALIDATION.json、final-full/sdar-verify-38c4b6b9-6e95-40bd-a92e-f1f8d245c929/ |
| 受限 GOWM | 8 步 / 2 正式流程 / 32 原生场景；同一冻结输入、真实独立数据库与受限角色，模型/MCP 模拟 | GOWM_VALIDATION.json、GOWM/ |
| 包重现 | 两次归档逐字节相同，2921 个源码文件 | FINAL_PACKAGE.json |
| 实際容器版本 | Runtime、Control API、Worker 各 2921 文件及部署元数据/标签均匹配 | CONTAINER_SOURCE.json |
| 本地公开接口 | 13 个 GET 通过，12 个 Skill、12 个工具、0 Task；模型调用 NOT_RUN | LIVE_APIS.json |
| 共享合同 | ugv_sdar_app 非超级用户/非建库/非建角色；合同与 vector 0.8.5 一致；0 活动 Provider Task | LIVE_RESTRICTED_STORAGE.json |
| 保护数据 | 原卷、PostgreSQL 二进制/环境、旧绑定历史保留；38 个无关容器身份/镜像保留，12 次重启如实记录 | ../POSTGRES_PRESERVATION.json、../UPSTREAM_PRESERVATION.json |
| 备份 | DDL/角色及受影响共享业务、安装和任务历史；快照数据排除但原数据保留；完整恢复演练 NOT_RUN | ../BACKUP.json |

冻结源码：`ac7838dae447955fb7410aaad705530077fc030a`。完整运行输入：`5979cc1859d9eebf321fb0a45fb3c777849347568bc5092949bda5adf8e9ad7b`；冻结基线：`1f615c8f50683a81d819beef7c3c25e9ce462efed5620181d2608af6c906f8dc`。主隔离 PostgreSQL 采用本次专有的 2GiB 内存卷，代码、阈值和超时不变；这不构成生产耐久性验收。真实持久 GOWM 单独核验。早期 4112a90b 的持久集成证据保留为 PRE_REVIEW，不能替代当前完整门禁。官方 TCK 的传输/可选项排除不认证被排除路径。

联合源包 SHA256：`ab698966b3e37f54fc9fe342f4e8bb39b8834794c86a1abaca485cf90f80d2d5`，源码内容哈希：`066963ddfbd51194580f498c86103690775254afee0ff2b0856a243c12922072`。它保持上游 Telemetry 13361e5b82c6acd7 归档的原字节，补充官方 PMS cfda8c7f 完整源码和 GOWM dca0fcd owner 安装器。交付为源码包，不含离线镜像、数据卷、私有配置或凭据。

PR40 P2 的 WSGS/GOWM 内部清单遗漏已修复并解决审查线程。修复版本兼容 CI 38486905947 实测 merge ref ded3efda，树与 ac7838da 一致。结果文档随后附加到原追踪矩阵；原段落只有 Markdown 对齐与空白格式变化，程序核对其格式化结果等于冻结原文。STATUS_BASELINE_DELTA.json 单独记录基线差异。最终证据提交的 CI、普通合并事件及外层交付 ZIP 哈希由 PR40 和交付旁 PUBLISHED.json / DELIVERY.json 记录；本报告不预先断言未发生的合并。

首个审查后完整运行 b0a5874e 的官方 TCK GitHub 下载超时为 NOT_PASS；25 个已通过阶段不能把整次运行改成通过。所有早期超时/性能失败/取消保留原始日志。首次新镜像的生成元数据仍为旧值，被校验拒绝；仅更新外部释放目录中该生成文件的时间戳后重新执行官方升级，源码字节不变且三容器身份通过。两次 CLI 最后均因巡检依赖缺失退出 1，未伪造完整初始化成功。

Console：[本机控制台](http://127.0.0.1:10998/console/)。完整治理仍返回 BUILTIN_CAPABILITY_DEPENDENCY_MISSING；不能将 12 项已发布清单报告成完整 13 项通过。

# 开发包聚焦验证记录（2026-09-07）

此记录只覆盖本次开发部署功能，不代表 qualification/production 或真实车辆验收。

| 验证 | 实测结果 |
| --- | --- |
| 配置、确认、恢复、环境及治理聚焦选择 | 11 文件 / 104 项通过 |
| MCP registry（含 response-loss 已消费确认恢复） | 74 项通过 |
| 真实 PostgreSQL + 有密码 Redis + 假 Provider + 公共 A2A | 2 项通过；人工/部署自动确认，重复请求同 Task，唯一派发 |
| 软件演示 HTTP 合同 | 选中 1 项通过；其他 80 项未选中 |
| 配置/演示变更复测 | 4 文件 / 6 项通过 |
| 必要编译 | TypeScript、Runtime 和 Console 构建通过 |
| Docker 工具链 | 应用镜像、无宿主 Node 的工具镜像构建通过，Compose v2.40.3 可运行 |
| 空库启动与升级 | 两个独立空 PG 库完成迁移；升级后 21 个 Prompt、2 条演示审计保留 |
| 接口 | Management、Console、A2A、Control HTTP 200；internal 匿名 401，生成服务身份可用 |
| 持久化与活动状态 | 0178 生效；审计禁止修改；AOF enabled/writable；Task、RemoteTask、pending dispatch、Bull active/lease 均 0 |

隔离 Compose 名称为 `sdar-development-validation`。测试凭据只存在私有 `.state`，不写入本记录或压缩包。
软件演示只改变 `demo:indicator` 的软件状态；部署自检没有创建 Task、调用 Provider tools/call 或操作设备。

## 明确保留的验证限制

- 默认 PostgreSQL 联网构建先遇到 Docker Hub EOF，重试时又遇到 Alpine gcc 安装 I/O 错误。空库/升级验证使用同配方已有 PG17.10 / pgvector0.8.5 镜像，因此不把默认联网构建称为已通过。
- 外部模型和 UGV Provider 没有注入真实地址或密钥。未配置 Provider 时准确报告 `DEVELOPMENT_PROVIDER_NOT_CONFIGURED`。治理空库初始化和相同内容复用由 API fixture 验证。
- 已知非武器 UGV 计划自动确认；未分类及嵌套自定义计划仍为人工确认。缺少业务输入不会自动补造。
- 构建期间可能有其他客户端提交任务，升级在构建前后都检查活动；调用方仍须保持滚动窗口不提交新任务。
- 交付压缩包记录 Git 基础 revision 和逐文件 sourceHash。工作树内容的精确身份以 sourceHash 为准，不用旧 Git revision 冒充新实现提交。

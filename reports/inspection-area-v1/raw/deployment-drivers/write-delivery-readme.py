import pathlib,json,hashlib,shutil
repo=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');r=repo/'reports/inspection-area-v1';dest=pathlib.Path('/mnt/data/inspection-area-v1-20261014');v=json.loads((r/'FINAL_VALIDATION.json').read_text());assert v['status']=='LOCAL_DEPLOYED_READONLY_ACCEPTED';delivery=json.loads((r/'DURABLE_DELIVERY.json').read_text());archive=json.loads((r/'EVIDENCE_ARCHIVE.json').read_text());image=json.loads((r/'IMAGES.json').read_text());source=json.loads((r/'CONTAINER_SOURCE.json').read_text());smpp=json.loads(pathlib.Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/reports/inspection-area-v1/IMAGES.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();pkg=next(x for x in delivery['packages'] if x['component']=='sdar');upstream=next(x for x in delivery['packages'] if x['component']=='smpp')
for x in [pkg,upstream,archive]:assert sha(pathlib.Path(x['path']))==x['sha256']
text=f"""# 区域检查与 SDAR 巡逻联合交付（2026-10-15）

## 使用本次交付

- 完整联合部署包：[{pathlib.Path(pkg['path']).name}]({pkg['path']})，包含 SDAR、SMPP、Telemetry、WSGS、GSAP、GDPS 和 GOWM 的固定源码及逐层校验清单。
- 上游原包：[{pathlib.Path(upstream['path']).name}]({upstream['path']})。
- 验收证据：[inspection-area-v1-evidence.tar.gz]({archive['path']})；固定源码、命令、退出码、日志和现场只读验收均在索引中。
- Git 合并结果另见交付目录中的 PUBLICATION.json；证据归档生成后不再修改。

SHA256：

| 交付项 | SHA256 |
| --- | --- |
| 完整联合包 | `{pkg['sha256']}` |
| 上游原包 | `{upstream['sha256']}` |
| 验收证据 | `{archive['sha256']}` |

在本目录运行对应的 `sha256sum -c <文件名>.sha256`，解包后按包内 README 及 bundle.py 校验入口操作。本包是源码交付，未携带离线容器镜像和现场私密配置。

## 当前本地验收

端口 19100 的 SMPP 已更新，精确提供 13 个工具，包含 `vehicle_inspect_area`，检查开关已按本次部署启用。SDAR 的 Runtime、Control API、Control Worker 已更新到 `{image['sourceRevision']}`；检查与巡逻后继版本通过正式治理发布，站点 14 项 Skill/Capability 清单及只读可组合性验收通过。真实现场巡逻任务未提交，状态为 **NOT_RUN**。

- SMPP 固定源码：`{smpp['sourceRevision']}`。
- SDAR 源码摘要：`{image['sourceHash']}`；三容器各 {image['packageFiles']} 项源码哈希与包一致。
- SDAR 完整隔离门禁：30 阶段及清理通过；其后仅纠正联合包 README，差异前后哈希单独记录，生产代码、测试、合同及迁移保持门禁字节。
- 真实隔离 PostgreSQL、MQTT 与设备 MCP 的八个检查/巡逻场景通过，覆盖完整、降级、失败及取消；这些属于隔离仿真验收。
- 原数据库卷、绑定身份与版本历史、轨迹签名密钥、PMS 配置及 48 个上游实例的保留检查通过。
- 性能验收使用记录在证据中的 CPU 亲和性范围和临时 PostgreSQL 存储；测试和阈值未改，不据此声明生产 SLO 或耐久性。

现场配置和回退备份保留在私密目录，未放入交付包。回退步骤见 [ROLLBACK.md](ROLLBACK.md)：先撤回新增发布，恢复旧 SMPP/目录并关闭开关，保留新版 SDAR 完成原生 CAS 谱系对齐后再恢复旧 SDAR；保留任务报告和历史。实际生产回退演练为 **NOT_RUN**。
"""
(dest/'README.md').write_text(text);shutil.copy2(r/'ROLLBACK.md',dest/'ROLLBACK.md');shutil.copy2(r/'FINAL_VALIDATION.json',dest/'FINAL_VALIDATION.json');shutil.copy2(r/'EVIDENCE_INDEX.json',dest/'EVIDENCE_INDEX.json');print(json.dumps({'status':'PASS','readme':str(dest/'README.md'),'jointPackage':pkg['path'],'evidenceArchive':archive['path']}))

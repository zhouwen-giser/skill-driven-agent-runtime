# SDAR → GOWM 共享业务存储并行接入 v0.1

**只修改SDAR；共享ugv_sdar；按device_id归属；不等待SMPP完成。**

## 开始

在SDAR工作区读取 `CODEX_MASTER_PROMPT.md`，再按 `FULL_CN.md` 执行。

```text
读取 SDAR_GOWM_Shared_Storage_Integration_v0.1_Codex_Goal/CODEX_MASTER_PROMPT.md
和 FULL_CN.md，完成SDAR正常业务路径接入GOWM共享ugv_sdar。
仅修改SDAR；按P0—P7执行，不停留在文档。
```

## 内容

- 14份分主题实施说明：00—13。
- 8个阶段、45项Required验收。
- 48个必需测试设计、1个可选真实SMPP互操作设计。
- 配置/上下文示例、并行接线约定、源码消费矩阵模板、最终报告模板。
- task.json、acceptance.json、test-scenarios.json及来源说明。
- 标准库校验脚本、清单和SHA256SUMS。

## 不包含

本包不是GOWM数据库安装包，不携带要覆盖上游的迁移，不实现SDAR代码，也没有执行SDAR项目测试。所有项目验证仍为待执行。源事实按sources.json记录，执行时读取最新明确有效基线。

## 完成标志

```text
SDAR_GOWM_SHARED_STORAGE_SOURCE_READY
SDAR_GOWM_SHARED_STORAGE_INTEGRATION_DEV_READY
SDAR_GOWM_SHARED_STORAGE_INCOMPLETE
```

前两个分别代表源码完成和独立消费者数据库集成通过；真实SMPP互操作单列，不能混淆。无设备控制、用户环境切换或生产资格声明。

## 包完整性

```bash
python3 scripts/verify_package.py
```

校验的是任务包内容，不是项目功能、上游合同真实性或数据库执行结果。ZIP外侧sha256文件用于传输完整性。

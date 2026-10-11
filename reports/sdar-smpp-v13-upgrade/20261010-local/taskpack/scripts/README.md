# 包级工具

这两个 Python 3 工具仅使用标准库，不联网，不控制设备，不切换分支，不安装依赖，不修改 SDAR 源码，不读取 `.env` 或凭据。

## 检查任务包

```bash
python3 scripts/check_taskpack.py
```

验证 JSON、50 个场景、需求覆盖、内部链接、固定 SHA 和 MANIFEST 中的 SHA-256。此结果只证明任务包结构完整，不证明 SDAR 实现通过。

## 审计实际工作树

```bash
python3 scripts/audit_repo.py --repo /absolute/path/to/skill-driven-agent-runtime
```

输出 git HEAD/status、基线提交在本地是否可用、关键源码文件摘要和 package script 名称。只输出 JSON，不自动写文件；如需保存，明确重定向到新建报告路径。缺提交时不会 fetch，工作树不对时会返回错误，不自动 clone 或 reset。

## 工具自测

```bash
python3 -m unittest discover -s selftests -p 'test_*.py' -v
```

只创建临时合成 Git 仓库与临时包副本，测试工具正确性，不连接真实 SDAR/PG/Redis/现场服务。

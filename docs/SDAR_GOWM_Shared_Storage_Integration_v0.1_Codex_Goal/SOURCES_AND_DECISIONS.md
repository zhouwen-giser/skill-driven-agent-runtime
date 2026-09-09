# 来源与证据范围

设计生成日期：2026-09-08。

本包依据本轮GitHub连接器读取的GOWM共享存储分支、SDAR main，以及当前对话的SMPP任务书范围进行设计。没有执行SDAR测试、没有连接用户数据库、没有修改任何远端仓库。

sources.json列出实际来源与读取范围。当前包不完整复制上游合同；Codex执行时必须摄取当次实际合同、全部overlay和必要源码。禁止把来源SHA当成永久运行资格或为了追HEAD反复加门禁。

优先关系：用户明确并行单仓和共享存储要求 → 当前GOWM最终安装DDL/约束 → 本包任务范围 → 旧设计参考。发现冲突先判定是否能在消费者实现解决；不能解决再报告最小上游缺口。

已核实的设计落点：

- GOWM为设备/非设备初始Admission提供两组不同的partial unique key。
- Remote Binding canonical_id只可在真实同设备/服务MCP父记录存在时填写。
- Goal/user_goal_plan/skill_goal不应因共享存储被强制变成单车定义。
- 公共workflow_steps将Native Event与Remote Node Run分开，避免按nodeId连接产生虚假对应。
- SDAR工具链使用pnpm，不能使用GOWM的npm check命令替代。

本包明确补充的设计选择（不是声称当前源码已经实现）：

- 新的SDAR共享存储模式和设备context贯穿。
- 正常SDAR代码+MCP协议桩+真实数据库的独立并行验收。
- SDAR生产运行时不写SMPP/Mission；独立测试同伴只在隔离库发布合成父数据。
- 终态后的canonical关联补齐不重新执行原任务。
- 同步MCP没有Remote Binding时保留原参数，不伪造Node Run owner。

技术实现依据采用官方PostgreSQL与node-postgres文档；URL见sources.json。引用摘要仅用于说明固定Schema和同连接事务，不涉及库版本升级建议。

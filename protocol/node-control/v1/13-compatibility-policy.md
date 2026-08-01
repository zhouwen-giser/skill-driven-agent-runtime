# 13. 兼容策略

## 非破坏变更

- 新增可选字段；
- 新增 Endpoint；
- 新增 Event Type；
- 新增 Error Code；
- Enum 客户端支持 unknown 后新增值。

## 破坏变更

- 删除或重命名字段/路径；
- 改变状态语义；
- 将可选改必填；
- 改变 ID 或 Revision 规则；
- 改变 HTTP Status；
- 让 Event 从 Hint 变成 Authority；
- 将遥测查询纳入 Node API。

破坏变更必须提升 Major Contract Version，不能静默修改 V1。

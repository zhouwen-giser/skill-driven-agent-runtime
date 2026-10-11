# PR：SDAR TaskBusiness 受管业务闭环 / 本批名称

## Scope

本批工作包、真实实现 SHA、上游兼容 SHA、哪些原能力被复用。不得把任务包的拟实现清单写成已经完成。

## User-visible behavior

通过什么正式入口读取/修改/核对原任务，如何表现业务事实和证据质量。

## Verification

真实命令与结果；AC 映射；同源完整 gate 状态；失败和未执行项。CI 链接必须指向该次实现，而非旧 PR34。

## Safety / compatibility / recovery

原冻结 authority、历史任务、事件游标与 GOWM 边界；发送前持久化和不确定结果处理；发射仍禁用、不新增独立锁定。

## Deployment

是否有授权、是否真正部署；无则 NOT_RUN。禁止将 PR 合并等同于现场验收。

export type CognitiveEntryRoute =
  | Readonly<{ kind: 'explicit_goal_ready'; reason: string }>
  | Readonly<{ kind: 'generic_task'; reason: string }>;

export class CognitiveEntryRouter {
  route(input: Readonly<{ requestText: string }>): CognitiveEntryRoute {
    const request = input.requestText.trim();
    if (request.length === 0) {
      return { kind: 'generic_task', reason: 'empty_request' };
    }

    const vagueReference = /\b(?:this|that|it|something|anything)\b/iu.test(request);
    const genericOpening =
      /^(?:help|assist|handle|deal with|take care of|帮|处理|弄)(?:\s|我|一下|这个|那个)/iu.test(
        request,
      );
    const hasConcreteTarget =
      /\b[A-Za-z][A-Za-z0-9._-]*[-_.][A-Za-z0-9._-]+\b/u.test(request) ||
      /(?:文件|设备|任务|项目|仓库|报告|接口|数据库|服务)[：:\s]*[A-Za-z0-9._/-]+/u.test(request);
    const hasDeliverable =
      /\b(?:return|produce|create|write|inspect|analyze|report|json|csv|status)\b/iu.test(
        request,
      ) || /(?:返回|生成|创建|编写|检查|分析|报告|状态|格式)/u.test(request);

    if ((genericOpening || vagueReference) && !(hasConcreteTarget && hasDeliverable)) {
      return { kind: 'generic_task', reason: 'underspecified_request' };
    }
    return { kind: 'explicit_goal_ready', reason: 'concrete_request' };
  }
}

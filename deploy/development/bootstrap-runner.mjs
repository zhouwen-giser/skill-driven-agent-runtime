// Deployment orchestration only. Stage adapters own validation and official API mutations.
export async function runGovernanceBootstrap(configuration, stages) {
  const result = { status: 'failed', completedStages: [], blocked: [], deviceCalls: 0 };
  if (configuration.SDAR_UGV_BOOTSTRAP_ENABLED !== 'YES')
    return {
      ...result,
      status: 'disabled',
      reasonCode: 'DEVELOPMENT_BOOTSTRAP_EXPLICITLY_DISABLED',
    };
  const required = [
    'SDAR_UGV_REGISTRY_ENDPOINT',
    'SDAR_UGV_SOURCE_ID',
    'SDAR_UGV_EXTERNAL_PROVIDER_ID',
    'SDAR_UGV_EXTERNAL_SERVER_ID',
  ];
  const missing = required.filter((key) => !configuration[key]);
  if (missing.length)
    return {
      ...result,
      reasonCode: 'DEVELOPMENT_BOOTSTRAP_CONFIGURATION_MISSING',
      blocked: missing.map((key) => ({ key })),
    };
  for (const name of ['source', 'provider', 'governance', 'builtins', 'verify']) {
    try {
      const stage = await stages[name]();
      result[name] = stage;
      if (stage?.blocked?.length) {
        result.blocked = stage.blocked;
        result.reasonCode = 'DEVELOPMENT_CAPABILITY_DEPENDENCIES_UNAVAILABLE';
        result.failedStage = name;
        return result;
      }
      result.completedStages.push(name);
    } catch (error) {
      result.failedStage = name;
      result.reasonCode =
        typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
          ? error.code
          : 'DEVELOPMENT_GOVERNANCE_BOOTSTRAP_FAILED';
      return result;
    }
  }
  return { ...result, status: 'registered' };
}

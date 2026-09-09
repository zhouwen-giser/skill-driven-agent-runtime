import { verifyGowmRuntimeExecution } from '../apps/server/test/gowm-runtime-execution.js';
if (process.argv.includes('--help')) {
  process.stdout.write(
    'Usage: test:gowm-storage:runtime [--remote | --cancel | --parent-cancel]\nRequires explicit isolated GOWM runtime test environment. Uses local Model/MCP fixtures.\n',
  );
  process.exit(0);
}
process.exit(
  await verifyGowmRuntimeExecution(
    process.argv.includes('--remote') ||
      process.argv.includes('--cancel') ||
      process.argv.includes('--parent-cancel')
      ? 'task_success'
      : 'immediate_success',
    process.argv.includes('--parent-cancel')
      ? 'parent-cancel'
      : process.argv.includes('--cancel')
        ? 'cancel'
        : 'success',
  ),
);

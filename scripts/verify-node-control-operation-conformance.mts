import process from 'node:process';

import { verifyNodeControlOperationConformance } from './lib/node-control-operation-conformance.mjs';

const summary = await verifyNodeControlOperationConformance();
process.stdout.write(
  `NODE_CONTROL_PUBLIC_IMPLEMENTATION_CONFORMANCE_PASSED: ${String(summary.operationCount)} operations ` +
    `(${String(summary.publicOperationCount)} public, ${String(summary.internalOperationCount)} internal), ` +
    `${String(summary.rbacDecisionCount)} RBAC decisions, ${String(summary.coveredOperationCount)} contract-covered.\n`,
);

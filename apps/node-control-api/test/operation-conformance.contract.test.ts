import { describe, expect, it } from 'vitest';

import {
  type ConformanceModel,
  type FrozenOperation,
  validateOperationConformance,
  verifyNodeControlOperationConformance,
} from '../../../scripts/lib/node-control-operation-conformance.mjs';

const operation: FrozenOperation = Object.freeze({
  operationId: 'getFixture',
  method: 'GET',
  path: '/api/v1/fixtures/{fixtureId}',
  surface: 'public',
  authMode: 'public_rbac',
  permission: 'fixture.read',
});

describe('Node Control operation conformance gate', () => {
  it('matches the complete frozen inventory to production routes, RBAC, and executed coverage', async () => {
    await expect(verifyNodeControlOperationConformance()).resolves.toMatchObject({
      operationCount: 131,
      publicOperationCount: 94,
      internalOperationCount: 37,
      coveredOperationCount: 131,
    });
  });

  it('fails closed when a production handler is omitted', () => {
    expect(validateOperationConformance(model({ actualRoutes: [] }))).toContain(
      'PRODUCTION_HANDLER_MISSING: getFixture GET /api/v1/fixtures/{fixtureId}',
    );
  });

  it('fails closed on production path or method drift', () => {
    const errors = validateOperationConformance(
      model({ actualRoutes: [{ method: 'POST', path: operation.path }] }),
    );
    expect(errors).toContain(
      'PRODUCTION_ROUTE_DRIFT: getFixture expected GET /api/v1/fixtures/{fixtureId}',
    );
  });

  it('fails closed when OpenAPI documents a path typo', () => {
    const documentedWithTypo: FrozenOperation = Object.freeze({
      ...operation,
      path: '/api/v1/fixture/{fixtureId}',
    });
    expect(
      validateOperationConformance(model({ documentedOperations: [documentedWithTypo] })),
    ).toContain(
      'OPENAPI_OPERATION_ROUTE_DRIFT: getFixture expected GET /api/v1/fixtures/{fixtureId}, documented GET /api/v1/fixture/{fixtureId}',
    );
  });

  it('fails closed when an operation has no RBAC permission authority', () => {
    const withoutPermission: FrozenOperation = Object.freeze({
      operationId: operation.operationId,
      method: operation.method,
      path: operation.path,
      surface: operation.surface,
      authMode: operation.authMode,
    });
    expect(
      validateOperationConformance(
        model({
          expectedOperations: [withoutPermission],
          documentedOperations: [withoutPermission],
        }),
      ),
    ).toContain('RBAC_PERMISSION_MISSING: getFixture');
  });

  it('fails closed when explicit contract-test coverage omits an operation', () => {
    expect(validateOperationConformance(model({ coveredOperationIds: new Set() }))).toContain(
      'CONTRACT_TEST_COVERAGE_MISSING: getFixture',
    );
  });
});

function model(overrides: Partial<ConformanceModel> = {}): ConformanceModel {
  return {
    expectedOperations: [operation],
    documentedOperations: [operation],
    actualRoutes: [{ method: operation.method, path: operation.path }],
    coveredOperationIds: new Set([operation.operationId]),
    exercisedOperationIds: new Set([operation.operationId]),
    rbacPermissions: new Set(['fixture.read']),
    rbacDecisions: new Map([['node_admin:getFixture', true]]),
    expectedRbacDecisions: new Map([['node_admin:getFixture', true]]),
    ...overrides,
  };
}

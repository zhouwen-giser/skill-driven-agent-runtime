import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import express from 'express';

import { createNodeControlHttpApp } from '../../apps/node-control-api/src/http-endpoint.js';
import { startManagementHttpEndpoint } from '../../packages/management-api/src/http-endpoint.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const PUBLIC_ROLES = [
  'node_admin',
  'node_operator',
  'node_viewer',
  'security_admin',
  'organization_service',
] as const;

type HttpMethod = Uppercase<(typeof HTTP_METHODS)[number]>;
type PublicRole = (typeof PUBLIC_ROLES)[number];
type OperationSurface = 'public' | 'internal';
type OperationAuthMode = 'anonymous' | 'public_rbac' | 'runtime_service';

export interface FrozenOperation {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly surface: OperationSurface;
  readonly authMode: OperationAuthMode;
  readonly tag?: string;
  readonly kind?: 'query' | 'command';
  readonly permission?: string;
}

export interface RouteRegistration {
  readonly method: HttpMethod;
  readonly path: string;
}

export interface ConformanceModel {
  readonly expectedOperations: readonly FrozenOperation[];
  readonly documentedOperations: readonly FrozenOperation[];
  readonly actualRoutes: readonly RouteRegistration[];
  readonly coveredOperationIds: ReadonlySet<string>;
  readonly exercisedOperationIds: ReadonlySet<string>;
  readonly rbacPermissions: ReadonlySet<string>;
  readonly rbacDecisions: ReadonlyMap<string, boolean>;
  readonly expectedRbacDecisions: ReadonlyMap<string, boolean>;
}

export interface OperationConformanceSummary {
  readonly operationCount: number;
  readonly publicOperationCount: number;
  readonly internalOperationCount: number;
  readonly routeCount: number;
  readonly rbacDecisionCount: number;
  readonly coveredOperationCount: number;
}

interface OpenApiOperation {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly tag?: string;
  readonly permission?: string;
  readonly anonymous: boolean;
}

interface OpenApiOperationDraft {
  operationId?: string;
  method?: HttpMethod;
  path?: string;
  tag?: string;
  permission?: string;
  anonymous?: boolean;
}

interface PublicInventoryRow {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly tag: string;
  readonly kind: 'query' | 'command';
}

interface FrozenRbac {
  readonly permissions: ReadonlySet<string>;
  readonly roles: ReadonlyMap<string, ReadonlySet<string>>;
}

interface OrganizationProfile {
  readonly allowed: ReadonlySet<string>;
  readonly conditional: ReadonlySet<string>;
}

interface ProductionSnapshot {
  readonly actualRoutes: readonly RouteRegistration[];
  readonly exercisedOperationIds: ReadonlySet<string>;
  readonly rbacDecisions: ReadonlyMap<string, boolean>;
}

export async function verifyNodeControlOperationConformance(
  repositoryRoot = process.cwd(),
): Promise<OperationConformanceSummary> {
  const contractRoot = path.join(repositoryRoot, 'protocol', 'node-control', 'v1');
  const manifest = parseObject(
    await readFile(path.join(contractRoot, 'MANIFEST.json'), 'utf8'),
    'NODE_CONTROL_MANIFEST_INVALID',
  );
  const counts = parseObject(manifest['counts'], 'NODE_CONTROL_MANIFEST_COUNTS_INVALID');
  const publicCount = positiveInteger(
    counts['publicOperations'],
    'NODE_CONTROL_PUBLIC_OPERATION_COUNT_INVALID',
  );
  const internalCount = positiveInteger(
    counts['internalOperations'],
    'NODE_CONTROL_INTERNAL_OPERATION_COUNT_INVALID',
  );

  const publicInventory = parsePublicInventory(
    await readFile(path.join(contractRoot, 'matrices', 'operation-inventory.csv'), 'utf8'),
  );
  const publicOpenApi = parseOpenApiOperations(
    await readFile(path.join(contractRoot, 'openapi', 'node-control.openapi.yaml'), 'utf8'),
    'public',
  );
  const internalOpenApi = parseOpenApiOperations(
    await readFile(path.join(contractRoot, 'openapi', 'runtime-control.openapi.yaml'), 'utf8'),
    'internal',
  );
  if (publicInventory.length !== publicCount)
    throw new Error(
      `NODE_CONTROL_PUBLIC_OPERATION_COUNT_DRIFT: expected ${String(publicCount)}, observed ${String(publicInventory.length)}`,
    );
  if (internalOpenApi.length !== internalCount)
    throw new Error(
      `NODE_CONTROL_INTERNAL_OPERATION_COUNT_DRIFT: expected ${String(internalCount)}, observed ${String(internalOpenApi.length)}`,
    );

  const publicDocumentedById = new Map(
    publicOpenApi.map((operation) => [operation.operationId, operation]),
  );
  const expectedPublic = publicInventory.map((operation): FrozenOperation => {
    const documented = publicDocumentedById.get(operation.operationId);
    const anonymous = documented?.anonymous ?? false;
    return Object.freeze({
      ...operation,
      surface: 'public',
      authMode: anonymous ? 'anonymous' : 'public_rbac',
      ...(anonymous
        ? {}
        : {
            permission: inferPermission(operation, documented?.permission),
          }),
    });
  });
  const expectedInternal = internalOpenApi.map((operation): FrozenOperation =>
    Object.freeze({
      operationId: operation.operationId,
      method: operation.method,
      path: operation.path,
      surface: 'internal',
      authMode: 'runtime_service',
      ...(operation.tag === undefined ? {} : { tag: operation.tag }),
    }),
  );
  const documentedOperations = Object.freeze([
    ...publicOpenApi.map((operation): FrozenOperation =>
      Object.freeze({
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
        surface: 'public',
        authMode: operation.anonymous ? 'anonymous' : 'public_rbac',
        ...(operation.tag === undefined ? {} : { tag: operation.tag }),
        ...(operation.permission === undefined ? {} : { permission: operation.permission }),
      }),
    ),
    ...expectedInternal,
  ]);
  const expectedOperations = Object.freeze([...expectedPublic, ...expectedInternal]);

  const rbac = parseRbac(
    await readFile(path.join(contractRoot, 'matrices', 'rbac-matrix.csv'), 'utf8'),
  );
  const organizationProfile = parseOrganizationProfile(
    await readFile(
      path.join(contractRoot, 'contracts', 'organization-facing-api-profile.yaml'),
      'utf8',
    ),
  );
  const coverage = parseCoverage(
    await readFile(
      path.join(repositoryRoot, 'scripts', 'fixtures', 'node-control-operation-coverage.json'),
      'utf8',
    ),
  );
  const expectedRbacDecisions = buildExpectedRbacDecisions(
    expectedPublic,
    rbac,
    organizationProfile,
  );
  const production = await collectProductionSnapshot(expectedOperations);
  const errors = validateOperationConformance({
    expectedOperations,
    documentedOperations,
    actualRoutes: production.actualRoutes,
    coveredOperationIds: coverage,
    exercisedOperationIds: production.exercisedOperationIds,
    rbacPermissions: rbac.permissions,
    rbacDecisions: production.rbacDecisions,
    expectedRbacDecisions,
  });
  if (errors.length > 0)
    throw new Error(`NODE_CONTROL_OPERATION_CONFORMANCE_FAILED\n${errors.join('\n')}`);

  return Object.freeze({
    operationCount: expectedOperations.length,
    publicOperationCount: expectedPublic.length,
    internalOperationCount: expectedInternal.length,
    routeCount: production.actualRoutes.length,
    rbacDecisionCount: production.rbacDecisions.size,
    coveredOperationCount: coverage.size,
  });
}

export function validateOperationConformance(model: ConformanceModel): readonly string[] {
  const errors: string[] = [];
  const expectedById = uniqueOperations(model.expectedOperations, 'EXPECTED_OPERATION', errors);
  const documentedById = uniqueOperations(model.documentedOperations, 'OPENAPI_OPERATION', errors);
  const expectedRouteKeys = new Set<string>();
  for (const operation of model.expectedOperations) {
    const key = routeKey(operation);
    if (expectedRouteKeys.has(key)) errors.push(`EXPECTED_ROUTE_DUPLICATE: ${key}`);
    expectedRouteKeys.add(key);
    const documented = documentedById.get(operation.operationId);
    if (documented === undefined) {
      errors.push(`OPENAPI_OPERATION_MISSING: ${operation.operationId}`);
    } else if (routeKey(documented) !== key) {
      errors.push(
        `OPENAPI_OPERATION_ROUTE_DRIFT: ${operation.operationId} expected ${key}, documented ${routeKey(documented)}`,
      );
    }
    if (operation.authMode === 'public_rbac') {
      if (operation.permission === undefined) {
        errors.push(`RBAC_PERMISSION_MISSING: ${operation.operationId}`);
      } else if (!model.rbacPermissions.has(operation.permission)) {
        errors.push(`RBAC_PERMISSION_UNKNOWN: ${operation.operationId} -> ${operation.permission}`);
      }
    }
  }
  for (const documented of model.documentedOperations)
    if (!expectedById.has(documented.operationId))
      errors.push(`OPENAPI_OPERATION_UNINVENTORIED: ${documented.operationId}`);

  const actualRouteKeys = new Set(model.actualRoutes.map(routeKey));
  for (const operation of model.expectedOperations) {
    const key = routeKey(operation);
    if (actualRouteKeys.has(key)) continue;
    const methodDrift = model.actualRoutes.find((route) => route.path === operation.path);
    if (methodDrift !== undefined) {
      errors.push(`PRODUCTION_ROUTE_DRIFT: ${operation.operationId} expected ${key}`);
    } else {
      errors.push(`PRODUCTION_HANDLER_MISSING: ${operation.operationId} ${key}`);
    }
  }
  for (const route of model.actualRoutes) {
    const key = routeKey(route);
    if (!expectedRouteKeys.has(key)) errors.push(`PRODUCTION_ROUTE_UNDOCUMENTED: ${key}`);
  }

  for (const operation of model.expectedOperations) {
    if (!model.coveredOperationIds.has(operation.operationId))
      errors.push(`CONTRACT_TEST_COVERAGE_MISSING: ${operation.operationId}`);
    if (!model.exercisedOperationIds.has(operation.operationId))
      errors.push(`CONTRACT_TEST_NOT_EXECUTED: ${operation.operationId}`);
  }
  for (const operationId of model.coveredOperationIds)
    if (!expectedById.has(operationId)) errors.push(`CONTRACT_TEST_COVERAGE_STALE: ${operationId}`);

  for (const [decisionKey, expected] of model.expectedRbacDecisions) {
    const actual = model.rbacDecisions.get(decisionKey);
    if (actual === undefined) errors.push(`RBAC_DECISION_NOT_EXECUTED: ${decisionKey}`);
    else if (actual !== expected)
      errors.push(
        `RBAC_DECISION_DRIFT: ${decisionKey} expected ${expected ? 'allow' : 'deny'}, observed ${actual ? 'allow' : 'deny'}`,
      );
  }
  for (const decisionKey of model.rbacDecisions.keys())
    if (!model.expectedRbacDecisions.has(decisionKey))
      errors.push(`RBAC_DECISION_UNINVENTORIED: ${decisionKey}`);
  return Object.freeze(errors);
}

async function collectProductionSnapshot(
  operations: readonly FrozenOperation[],
): Promise<ProductionSnapshot> {
  const service = blackHole<Parameters<typeof createNodeControlHttpApp>[0]>({
    getNodeProfile: () =>
      Promise.resolve({
        nodeId: 'operation-conformance-node',
        nodeType: 'sdar-runtime',
        displayName: 'Operation conformance node',
        environment: 'test',
      }),
    getReadiness: () =>
      Promise.resolve({
        status: 'ready',
        checks: [],
        observedAt: '2026-08-13T00:00:00.000Z',
      }),
  });
  const configurations = blackHole<Parameters<typeof createNodeControlHttpApp>[1]>();
  const tokens = Object.freeze({
    node_admin: 'conformance-node-admin-token',
    node_operator: 'conformance-node-operator-token',
    node_viewer: 'conformance-node-viewer-token',
    security_admin: 'conformance-security-admin-token',
    organization_service: 'conformance-organization-token',
  });
  const nodeApp = createNodeControlHttpApp(service, configurations, {
    bearerToken: tokens.node_admin,
    operatorBearerToken: tokens.node_operator,
    viewerBearerToken: tokens.node_viewer,
    securityBearerToken: tokens.security_admin,
    organizationBearerToken: tokens.organization_service,
    organizationTenantId: 'operation-conformance',
    rateLimitPerMinute: 2_000,
    runtimeServiceToken: 'conformance-runtime-service-token',
    nodeControlApiUrl: 'http://127.0.0.1:10080',
    nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
    a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
    taskControl:
      blackHole<NonNullable<Parameters<typeof createNodeControlHttpApp>[2]['taskControl']>>(),
  });
  const nodeRoutes = collectExpressStackRoutes(nodeApp);
  installPublicRbacProbeTerminator(nodeApp);
  const nodeServer = await listen(nodeApp);
  const nodeBaseUrl = serverBaseUrl(nodeServer);
  const runtimeCapture = await startRuntimeEndpointWithRouteCapture();
  try {
    const runtimeRoutes = runtimeCapture.routes.filter((route) =>
      route.path.startsWith('/internal/v1/'),
    );
    const expectedInternalRouteKeys = new Set(
      operations
        .filter((operation) => operation.surface === 'internal')
        .map((operation) => routeKey(operation)),
    );
    const actualRoutes = uniqueRoutes(
      [...nodeRoutes, ...runtimeRoutes].filter(
        (route) =>
          isPublicContractNamespace(route) || expectedInternalRouteKeys.has(routeKey(route)),
      ),
    );
    const rbacDecisions = new Map<string, boolean>();
    const exercised = new Set<string>();
    for (const operation of operations) {
      const concretePath = concreteOperationPath(operation.path);
      if (operation.authMode === 'anonymous') {
        const response = await request(nodeBaseUrl, operation.method, concretePath);
        if (response.code === 'AUTHENTICATION_REQUIRED')
          throw new Error(
            `NODE_CONTROL_ANONYMOUS_OPERATION_AUTHENTICATED: ${operation.operationId}`,
          );
        if (hasRoute(actualRoutes, operation)) exercised.add(operation.operationId);
        continue;
      }
      if (operation.authMode === 'public_rbac') {
        const unauthenticated = await request(nodeBaseUrl, operation.method, concretePath);
        if (unauthenticated.code !== 'AUTHENTICATION_REQUIRED')
          throw new Error(`NODE_CONTROL_PUBLIC_AUTHENTICATION_DRIFT: ${operation.operationId}`);
        for (const role of PUBLIC_ROLES) {
          const response = await request(nodeBaseUrl, operation.method, concretePath, tokens[role]);
          rbacDecisions.set(
            rbacDecisionKey(role, operation.operationId),
            response.code !== 'CONTROL_SCOPE_FORBIDDEN',
          );
        }
        if (hasRoute(actualRoutes, operation)) exercised.add(operation.operationId);
        continue;
      }
      const nodeOwnsRoute = hasRoute(nodeRoutes, operation);
      const response = await request(
        nodeOwnsRoute ? nodeBaseUrl : runtimeCapture.baseUrl,
        operation.method,
        concretePath,
      );
      if (
        response.status === 401 &&
        (response.code === 'AUTHENTICATION_REQUIRED' ||
          response.code === 'RUNTIME_CONTROL_UNAUTHORIZED') &&
        hasRoute(actualRoutes, operation)
      )
        exercised.add(operation.operationId);
    }
    return Object.freeze({
      actualRoutes,
      exercisedOperationIds: exercised,
      rbacDecisions,
    });
  } finally {
    await Promise.all([close(nodeServer), runtimeCapture.close()]);
  }
}

function buildExpectedRbacDecisions(
  operations: readonly FrozenOperation[],
  rbac: FrozenRbac,
  organization: OrganizationProfile,
): ReadonlyMap<string, boolean> {
  const decisions = new Map<string, boolean>();
  for (const operation of operations) {
    if (operation.authMode !== 'public_rbac') continue;
    for (const role of PUBLIC_ROLES) {
      const organizationRead = organization.allowed.has(operation.operationId);
      const organizationControl = organization.conditional.has(operation.operationId);
      let allowed = false;
      if (role === 'node_admin') allowed = true;
      else if (role === 'organization_service') allowed = organizationRead || organizationControl;
      else
        allowed =
          organizationRead ||
          (operation.permission !== undefined &&
            (rbac.roles.get(role)?.has(operation.permission) ?? false));
      decisions.set(rbacDecisionKey(role, operation.operationId), allowed);
    }
  }
  return decisions;
}

function inferPermission(
  operation: PublicInventoryRow,
  documentedPermission: string | undefined,
): string {
  if (documentedPermission !== undefined) return documentedPermission;
  const readOrManage = (resource: string): string =>
    `${resource}.${operation.kind === 'query' ? 'read' : 'manage'}`;
  switch (operation.tag) {
    case 'Node':
      return operation.kind === 'query' ? 'node.read' : 'node.write';
    case 'Configuration':
      return 'configuration.manage';
    case 'LLM':
      return 'llm.manage';
    case 'SMPP':
      return 'smpp.manage';
    case 'MCP':
      return 'mcp.manage';
    case 'Skills':
      return readOrManage('skill');
    case 'PlanTemplates':
      return readOrManage('artifact');
    case 'Capabilities':
      return readOrManage('capability');
    case 'A2A':
      return readOrManage('a2a');
    case 'Tasks':
      return operation.kind === 'query' ? 'task.read' : 'task.control';
    case 'EvidenceExport':
      return readOrManage('evidence_export');
    case 'Operations':
      return 'operation.read';
    case 'Audit':
      return 'audit.read';
    case 'Events':
      return 'events.read';
    default:
      throw new Error(`NODE_CONTROL_OPERATION_PERMISSION_UNMAPPED: ${operation.operationId}`);
  }
}

function parsePublicInventory(source: string): readonly PublicInventoryRow[] {
  const rows = parseCsv(source);
  return Object.freeze(
    rows.map((row): PublicInventoryRow => {
      const method = httpMethod(row['method'], 'NODE_CONTROL_INVENTORY_METHOD_INVALID');
      const kind = row['kind'];
      if (kind !== 'query' && kind !== 'command')
        throw new Error(`NODE_CONTROL_INVENTORY_KIND_INVALID: ${String(kind)}`);
      return Object.freeze({
        operationId: requiredText(row['operationId'], 'NODE_CONTROL_INVENTORY_ID_INVALID'),
        method,
        path: requiredPath(row['path'], 'NODE_CONTROL_INVENTORY_PATH_INVALID'),
        tag: requiredText(row['tag'], 'NODE_CONTROL_INVENTORY_TAG_INVALID'),
        kind,
      });
    }),
  );
}

function parseOpenApiOperations(
  source: string,
  surface: OperationSurface,
): readonly OpenApiOperation[] {
  const operations: OpenApiOperation[] = [];
  let currentPath: string | undefined;
  let currentMethod: HttpMethod | undefined;
  let current: OpenApiOperationDraft | undefined;
  let readingTags = false;
  const finish = (): void => {
    if (current === undefined) return;
    operations.push(
      Object.freeze({
        operationId: requiredText(current.operationId, 'NODE_CONTROL_OPENAPI_ID_INVALID'),
        method: httpMethod(current.method, 'NODE_CONTROL_OPENAPI_METHOD_INVALID'),
        path: requiredPath(current.path, 'NODE_CONTROL_OPENAPI_PATH_INVALID'),
        anonymous: current.anonymous ?? false,
        ...(current.tag === undefined ? {} : { tag: current.tag }),
        ...(current.permission === undefined ? {} : { permission: current.permission }),
      }),
    );
    current = undefined;
  };
  for (const line of source.split(/\r?\n/u)) {
    if (/^\S/u.test(line)) {
      finish();
      currentPath = undefined;
      currentMethod = undefined;
      readingTags = false;
      continue;
    }
    const pathMatch = /^  (\/[^:]+):\s*$/u.exec(line);
    if (pathMatch !== null) {
      finish();
      currentPath = pathMatch[1];
      currentMethod = undefined;
      readingTags = false;
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete):\s*$/u.exec(line);
    if (methodMatch !== null && currentPath !== undefined) {
      finish();
      currentMethod = httpMethod(methodMatch[1], 'NODE_CONTROL_OPENAPI_METHOD_INVALID');
      current = { method: currentMethod, path: currentPath, anonymous: false };
      readingTags = false;
      continue;
    }
    if (current === undefined || currentMethod === undefined) continue;
    const operationIdMatch = /^      operationId:\s*(\S+)\s*$/u.exec(line);
    if (operationIdMatch !== null) {
      current.operationId = requiredText(operationIdMatch[1], 'NODE_CONTROL_OPENAPI_ID_INVALID');
      continue;
    }
    const permissionMatch = /^      x-sdar-permission:\s*(\S+)\s*$/u.exec(line);
    if (permissionMatch !== null) {
      current.permission = requiredText(
        permissionMatch[1],
        'NODE_CONTROL_OPENAPI_PERMISSION_INVALID',
      );
      continue;
    }
    if (/^      security:\s*\[\]\s*$/u.test(line)) {
      current.anonymous = true;
      continue;
    }
    if (/^      tags:\s*$/u.test(line)) {
      readingTags = true;
      continue;
    }
    const tagMatch = readingTags ? /^      -\s*(\S+)\s*$/u.exec(line) : null;
    if (tagMatch !== null) {
      current.tag ??= requiredText(tagMatch[1], 'NODE_CONTROL_OPENAPI_TAG_INVALID');
      readingTags = false;
    } else if (/^      \S/u.test(line)) {
      readingTags = false;
    }
  }
  finish();
  if (surface === 'public') {
    const anonymous = operations.filter((operation) => operation.anonymous);
    if (anonymous.length !== 3)
      throw new Error(
        `NODE_CONTROL_ANONYMOUS_OPERATION_COUNT_INVALID: ${String(anonymous.length)}`,
      );
  } else if (operations.some((operation) => operation.anonymous)) {
    throw new Error('NODE_CONTROL_INTERNAL_OPERATION_ANONYMOUS');
  }
  return Object.freeze(operations);
}

function parseRbac(source: string): FrozenRbac {
  const rows = parseCsv(source);
  const header = parseCsvRows(source)[0] ?? [];
  const permissions = new Set(header.slice(1));
  const roles = new Map<string, ReadonlySet<string>>();
  for (const row of rows) {
    const role = requiredText(row['role'], 'NODE_CONTROL_RBAC_ROLE_INVALID');
    if (roles.has(role)) throw new Error(`NODE_CONTROL_RBAC_ROLE_DUPLICATE: ${role}`);
    const allowed = new Set<string>();
    for (const permission of permissions) {
      const value = row[permission] ?? '';
      if (value !== '' && value !== 'allow')
        throw new Error(`NODE_CONTROL_RBAC_VALUE_INVALID: ${role}.${permission}=${value}`);
      if (value === 'allow') allowed.add(permission);
    }
    roles.set(role, allowed);
  }
  for (const role of PUBLIC_ROLES)
    if (!roles.has(role)) throw new Error(`NODE_CONTROL_RBAC_REQUIRED_ROLE_MISSING: ${role}`);
  return Object.freeze({ permissions, roles });
}

function parseOrganizationProfile(source: string): OrganizationProfile {
  const sections = new Map<string, Set<string>>();
  let section: string | undefined;
  for (const line of source.split(/\r?\n/u)) {
    const heading = /^([A-Za-z][A-Za-z0-9]*):\s*$/u.exec(line);
    if (heading !== null) {
      section = requiredText(heading[1], 'NODE_CONTROL_ORGANIZATION_PROFILE_SECTION_INVALID');
      sections.set(section, new Set());
      continue;
    }
    const item = /^-\s*(\S+)\s*$/u.exec(line);
    if (item !== null && section !== undefined) sections.get(section)?.add(item[1] ?? '');
  }
  return Object.freeze({
    allowed: sections.get('allowedOperations') ?? new Set<string>(),
    conditional: sections.get('conditionalOperations') ?? new Set<string>(),
  });
}

function parseCoverage(source: string): ReadonlySet<string> {
  const value = parseObject(source, 'NODE_CONTROL_COVERAGE_INVALID');
  if (value['schemaVersion'] !== 1 || value['suite'] !== 'node-control-operation-conformance')
    throw new Error('NODE_CONTROL_COVERAGE_HEADER_INVALID');
  const operationIds = value['coveredOperationIds'];
  if (!Array.isArray(operationIds) || operationIds.some((entry) => typeof entry !== 'string'))
    throw new Error('NODE_CONTROL_COVERAGE_OPERATIONS_INVALID');
  const coverage = new Set(operationIds);
  if (coverage.size !== operationIds.length)
    throw new Error('NODE_CONTROL_COVERAGE_OPERATION_DUPLICATE');
  return coverage;
}

function collectExpressStackRoutes(app: express.Express): readonly RouteRegistration[] {
  interface RouteLayer {
    readonly route?: Readonly<{
      path: unknown;
      methods: Readonly<Record<string, unknown>>;
    }>;
  }
  const router = Reflect.get(app, 'router') as unknown as
    Readonly<{ stack?: readonly RouteLayer[] }> | undefined;
  const routes: RouteRegistration[] = [];
  for (const layer of router?.stack ?? []) {
    if (layer.route === undefined || typeof layer.route.path !== 'string') continue;
    for (const method of HTTP_METHODS)
      if (layer.route.methods[method])
        routes.push(
          Object.freeze({
            method: method.toUpperCase() as HttpMethod,
            path: normalizePath(layer.route.path),
          }),
        );
  }
  return Object.freeze(routes);
}

/**
 * Public conformance probes need the production authentication/RBAC middleware but not the
 * downstream business handler. Insert a test-only 204 terminator immediately after that middleware
 * so an allow decision is observable without invoking databases, providers, or physical adapters.
 */
function installPublicRbacProbeTerminator(app: express.Express): void {
  interface MutableRouteLayer {
    readonly route?: Readonly<{ path: unknown }>;
  }
  app.use('/api/v1', (_request, response) => {
    response.status(204).end();
  });
  const router = Reflect.get(app, 'router') as unknown as { stack?: MutableRouteLayer[] };
  const stack = router.stack;
  const terminator = stack?.pop();
  if (stack === undefined || terminator === undefined)
    throw new Error('NODE_CONTROL_RBAC_PROBE_TERMINATOR_UNAVAILABLE');
  const firstPublicRoute = stack.findIndex(
    (layer) =>
      layer.route !== undefined &&
      typeof layer.route.path === 'string' &&
      layer.route.path.startsWith('/api/v1/'),
  );
  if (firstPublicRoute < 0) throw new Error('NODE_CONTROL_PUBLIC_ROUTE_STACK_UNAVAILABLE');
  stack.splice(firstPublicRoute, 0, terminator);
}

async function startRuntimeEndpointWithRouteCapture(): Promise<
  Readonly<{
    baseUrl: string;
    routes: readonly RouteRegistration[];
    close(): Promise<void>;
  }>
> {
  const application = express.application;
  const originals = new Map<string, unknown>();
  const routes: RouteRegistration[] = [];
  for (const method of HTTP_METHODS) {
    const original = Reflect.get(application, method);
    if (typeof original !== 'function')
      throw new Error(`EXPRESS_ROUTE_REGISTRAR_MISSING: ${method}`);
    originals.set(method, original);
    Reflect.set(
      application,
      method,
      function routeCapture(this: unknown, ...args: unknown[]): unknown {
        const registeredPath = args[0];
        if (typeof registeredPath === 'string' && args.length > 1)
          routes.push(
            Object.freeze({
              method: method.toUpperCase() as HttpMethod,
              path: normalizePath(registeredPath),
            }),
          );
        return Reflect.apply(original, this, args);
      },
    );
  }
  try {
    const blackHoleOperations =
      blackHole<Parameters<typeof startManagementHttpEndpoint>[0]['operations']>();
    const endpoint = await startManagementHttpEndpoint({
      operations: blackHoleOperations,
      runtimeControl: {
        bearerToken: 'conformance-runtime-token',
        skills:
          blackHole<
            NonNullable<
              Parameters<typeof startManagementHttpEndpoint>[0]['runtimeControl']
            >['skills']
          >(),
      },
    });
    return Object.freeze({
      baseUrl: endpoint.baseUrl,
      routes: Object.freeze(routes),
      close: endpoint.close,
    });
  } finally {
    for (const [method, original] of originals) Reflect.set(application, method, original);
  }
}

function blackHole<T>(overrides: Readonly<Record<string, unknown>> = {}): T {
  let proxy: unknown;
  const callable = Object.assign((): Promise<undefined> => Promise.resolve(undefined), overrides);
  proxy = new Proxy(callable, {
    get: (target, property) => {
      if (property === 'then') return undefined;
      return Reflect.has(target, property) ? Reflect.get(target, property) : proxy;
    },
    apply: () => Promise.resolve(undefined),
  });
  return proxy as T;
}

async function request(
  baseUrl: string,
  method: HttpMethod,
  operationPath: string,
  bearerToken?: string,
): Promise<Readonly<{ status: number; code?: string }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}${operationPath}`, {
      method,
      headers: {
        ...(bearerToken === undefined ? {} : { authorization: `Bearer ${bearerToken}` }),
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      },
      ...(method === 'GET' ? {} : { body: '{}' }),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return Object.freeze({ status: response.status });
    const responseText = await response.text();
    if (responseText === '') return Object.freeze({ status: response.status });
    let body: unknown;
    try {
      body = JSON.parse(responseText) as unknown;
    } catch {
      return Object.freeze({ status: response.status });
    }
    const code =
      typeof body === 'object' && body !== null && typeof Reflect.get(body, 'code') === 'string'
        ? (Reflect.get(body, 'code') as string)
        : undefined;
    return Object.freeze({ status: response.status, ...(code === undefined ? {} : { code }) });
  } finally {
    clearTimeout(timeout);
  }
}

async function listen(app: express.Express): Promise<Server> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function serverBaseUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('NODE_CONTROL_CONFORMANCE_SERVER_ADDRESS_INVALID');
  return `http://127.0.0.1:${String(address.port)}`;
}

function isPublicContractNamespace(route: RouteRegistration): boolean {
  return (
    route.path === '/.well-known/sdar-node' ||
    route.path === '/health/live' ||
    route.path === '/health/ready' ||
    route.path.startsWith('/api/v1/')
  );
}

function concreteOperationPath(value: string): string {
  return value.replace(/\{(?:version|revision)\}/gu, '1').replace(/\{[^}]+\}/gu, 'conformance');
}

function normalizePath(value: string): string {
  const normalized = value.replace(/:([A-Za-z][A-Za-z0-9_]*)/gu, '{$1}');
  return normalized.length > 1 ? normalized.replace(/\/+$/u, '') : normalized;
}

function routeKey(value: Pick<RouteRegistration, 'method' | 'path'>): string {
  return `${value.method} ${normalizePath(value.path)}`;
}

function rbacDecisionKey(role: PublicRole, operationId: string): string {
  return `${role}:${operationId}`;
}

function hasRoute(routes: readonly RouteRegistration[], operation: FrozenOperation): boolean {
  const expected = routeKey(operation);
  return routes.some((route) => routeKey(route) === expected);
}

function uniqueRoutes(routes: readonly RouteRegistration[]): readonly RouteRegistration[] {
  const byKey = new Map<string, RouteRegistration>();
  for (const route of routes) byKey.set(routeKey(route), route);
  return Object.freeze(
    [...byKey.values()].sort((left, right) => routeKey(left).localeCompare(routeKey(right))),
  );
}

function uniqueOperations(
  operations: readonly FrozenOperation[],
  label: string,
  errors: string[],
): ReadonlyMap<string, FrozenOperation> {
  const byId = new Map<string, FrozenOperation>();
  for (const operation of operations) {
    if (byId.has(operation.operationId))
      errors.push(`${label}_ID_DUPLICATE: ${operation.operationId}`);
    else byId.set(operation.operationId, operation);
  }
  return byId;
}

function parseCsv(source: string): readonly Readonly<Record<string, string>>[] {
  const rows = parseCsvRows(source);
  const header = rows[0];
  if (header === undefined || header.length === 0) throw new Error('CSV_HEADER_MISSING');
  return Object.freeze(
    rows
      .slice(1)
      .map((values) =>
        Object.freeze(Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']))),
      ),
  );
}

function parseCsvRows(source: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (quoted) throw new Error('CSV_QUOTE_UNTERMINATED');
  return Object.freeze(rows.map((values) => Object.freeze(values)));
}

function parseObject(value: unknown, code: string): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(code);
  return parsed as Record<string, unknown>;
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(code);
  return Number(value);
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
  return value;
}

function requiredPath(value: unknown, code: string): string {
  const result = requiredText(value, code);
  if (!result.startsWith('/')) throw new Error(code);
  return normalizePath(result);
}

function httpMethod(value: unknown, code: string): HttpMethod {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.toUpperCase();
  if (!HTTP_METHODS.some((method) => method.toUpperCase() === normalized)) throw new Error(code);
  return normalized as HttpMethod;
}

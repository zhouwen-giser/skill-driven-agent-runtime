import { describe, expect, it } from 'vitest';

import { parseMcpProviderBindingPolicyOverride } from '../src/index.js';

const light = Object.freeze({
  selection: 'required' as const,
  mcpProviderBindingId: 'mcp-binding-ha-light-lab',
  localServerId: 'home-lab-light-mcp',
  mcpToolName: 'light_get_state',
  requireActive: true as const,
  requireAvailable: true as const,
  requireUnexpiredFreshness: true as const,
  denyFallback: true as const,
});
const climate = Object.freeze({
  selection: 'required' as const,
  mcpProviderBindingId: 'mcp-binding-ha-climate-lab',
  localServerId: 'home-lab-climate-mcp',
  mcpToolName: 'climate_get_state',
  requireActive: true as const,
  requireAvailable: true as const,
  requireUnexpiredFreshness: true as const,
  denyFallback: true as const,
});

describe('parseMcpProviderBindingPolicyOverride', () => {
  it('preserves the exact single-Binding policy shape with valid public resource ids', () => {
    expect(
      parseMcpProviderBindingPolicyOverride({
        ...light,
        allowedResourceIds: ['living-room-main-light', 'living-room-side-light'],
      }),
    ).toEqual({ mode: 'single', requirements: [light] });
  });

  it('accepts only an explicit exact-two required_all policy with valid nested resource ids', () => {
    expect(
      parseMcpProviderBindingPolicyOverride({
        selection: 'required_all',
        requirements: [
          { ...light, allowedResourceIds: ['living-room-main-light'] },
          { ...climate, allowedResourceIds: ['living-room-climate'] },
        ],
      }),
    ).toEqual({ mode: 'required_all', requirements: [light, climate] });
  });

  it.each([
    ['null', null],
    ['bare-array', [light, climate]],
    ['one-requirement', { selection: 'required_all', requirements: [light] }],
    [
      'unknown-required-all-key',
      { selection: 'required_all', requirements: [light, climate], fallback: 'deny' },
    ],
    ['unknown-single-key', { ...light, fallback: 'deny' }],
    ['empty-resource-list', { ...light, allowedResourceIds: [] }],
    [
      'duplicate-resource-id',
      { ...light, allowedResourceIds: ['living-room-main-light', 'living-room-main-light'] },
    ],
    ['non-array-resource-list', { ...light, allowedResourceIds: 'living-room-main-light' }],
    ['blank-resource-id', { ...light, allowedResourceIds: ['living-room-main-light', ''] }],
    [
      'whitespace-padded-resource-id',
      { ...light, allowedResourceIds: [' living-room-main-light'] },
    ],
    ['non-string-resource-id', { ...light, allowedResourceIds: ['living-room-main-light', 7] }],
    [
      'duplicate-binding',
      {
        selection: 'required_all',
        requirements: [light, { ...climate, mcpProviderBindingId: light.mcpProviderBindingId }],
      },
    ],
    [
      'duplicate-server',
      {
        selection: 'required_all',
        requirements: [light, { ...climate, localServerId: light.localServerId }],
      },
    ],
    [
      'missing-hard-gate',
      {
        selection: 'required_all',
        requirements: [light, { ...climate, denyFallback: false }],
      },
    ],
  ] as const)('rejects %s', (_case, value) => {
    expect(parseMcpProviderBindingPolicyOverride(value)).toEqual({
      mode: 'invalid',
      requirements: [],
    });
  });

  it('distinguishes an absent legacy policy from a declared invalid policy', () => {
    expect(parseMcpProviderBindingPolicyOverride(undefined)).toEqual({
      mode: 'absent',
      requirements: [],
    });
  });
});

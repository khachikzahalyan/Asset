/**
 * Wave-A Fix 4 — assertNoAssignmentCycle tests.
 *
 * Tests cover:
 *   - self-reference rejected (AssignmentSelfError).
 *   - A→B then B→A circular chain rejected (AssignmentCycleError).
 *   - long chain A→B→C→D allowed (no cycle).
 *   - chain hitting maxHops with a continuing link rejected as cycle.
 */

import { describe, it, expect } from 'vitest';
import {
  assertNoAssignmentCycle,
  AssignmentCycleError,
  AssignmentSelfError,
} from '@/domain/assets.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a lookup function from a map of assetId → assignedTo. */
function makeLookup(graph) {
  return async (id) => {
    if (!(id in graph)) return null;
    const assignedTo = graph[id];
    return { assignedTo };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assertNoAssignmentCycle — self-reference', () => {
  it('throws AssignmentSelfError when hostAssetId === targetAssetId', async () => {
    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'asset-A',
        targetAssetId: 'asset-A',
        lookup: makeLookup({}),
      })
    ).rejects.toBeInstanceOf(AssignmentSelfError);
  });

  it('AssignmentSelfError carries the correct assetId', async () => {
    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'asset-A',
        targetAssetId: 'asset-A',
        lookup: makeLookup({}),
      })
    ).rejects.toMatchObject({ assetId: 'asset-A' });
  });
});

describe('assertNoAssignmentCycle — circular chain (A → B → A)', () => {
  it('throws AssignmentCycleError when B points back to A', async () => {
    // A is being assigned to B. B's current assignedTo points to A.
    const lookup = makeLookup({
      'asset-B': { kind: 'asset', id: 'asset-A' },
    });

    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'asset-A',
        targetAssetId: 'asset-B',
        lookup,
      })
    ).rejects.toBeInstanceOf(AssignmentCycleError);
  });

  it('AssignmentCycleError has the right i18nKey', async () => {
    const lookup = makeLookup({
      'asset-B': { kind: 'asset', id: 'asset-A' },
    });

    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'asset-A',
        targetAssetId: 'asset-B',
        lookup,
      })
    ).rejects.toMatchObject({ i18nKey: 'errorAssignmentCycle' });
  });
});

describe('assertNoAssignmentCycle — long non-cyclic chain', () => {
  it('allows A → B → C → D (no cycle)', async () => {
    // A is being assigned to B. B→C, C→D, D has no asset assignment.
    const lookup = makeLookup({
      'asset-B': { kind: 'asset', id: 'asset-C' },
      'asset-C': { kind: 'asset', id: 'asset-D' },
      'asset-D': { kind: 'employee', id: 'emp-1' }, // terminates the chain
    });

    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'asset-A',
        targetAssetId: 'asset-B',
        lookup,
      })
    ).resolves.toBeUndefined();
  });

  it('allows when target has no assignedTo at all', async () => {
    const lookup = makeLookup({
      'asset-B': { kind: 'warehouse', id: null },
    });

    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'asset-A',
        targetAssetId: 'asset-B',
        lookup,
      })
    ).resolves.toBeUndefined();
  });

  it('allows when lookup returns null (asset not found in db)', async () => {
    const lookup = makeLookup({}); // asset-B not in graph

    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'asset-A',
        targetAssetId: 'asset-B',
        lookup,
      })
    ).resolves.toBeUndefined();
  });
});

describe('assertNoAssignmentCycle — maxHops exceeded treated as cycle', () => {
  it('throws AssignmentCycleError when chain exceeds maxHops with a continuing link', async () => {
    // Build a chain of length maxHops+1 with no actual cycle,
    // but long enough to exceed the default maxHops=16.
    // node-0 → node-1 → ... → node-17, and node-17 → node-18.
    const graph = {};
    for (let i = 0; i <= 17; i++) {
      graph[`node-${i}`] = { kind: 'asset', id: `node-${i + 1}` };
    }
    graph['node-18'] = { kind: 'employee', id: 'emp-1' }; // terminal

    const lookup = makeLookup(graph);

    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'host',
        targetAssetId: 'node-0',
        lookup,
        maxHops: 16,
      })
    ).rejects.toBeInstanceOf(AssignmentCycleError);
  });

  it('accepts a chain exactly at maxHops boundary (no continuing link)', async () => {
    // Chain of exactly maxHops nodes, last one terminates.
    const graph = {};
    for (let i = 0; i < 15; i++) {
      graph[`node-${i}`] = { kind: 'asset', id: `node-${i + 1}` };
    }
    graph['node-15'] = { kind: 'warehouse', id: null }; // terminal

    const lookup = makeLookup(graph);

    await expect(
      assertNoAssignmentCycle({
        hostAssetId: 'host',
        targetAssetId: 'node-0',
        lookup,
        maxHops: 16,
      })
    ).resolves.toBeUndefined();
  });
});

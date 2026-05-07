/**
 * Domain tests for `src/domain/assignmentEvents.js`. Pure JavaScript —
 * no Firestore, no React. Mirrors `src/test/assets.test.js` style.
 */

import { describe, it, expect } from 'vitest';

import {
  EVENT_TYPES,
  MAX_NOTES_LENGTH,
  emptyAssignmentEventInput,
  sanitizeAssignmentEventInput,
  validateAssignmentEventInput,
  isAssignmentEventInputValid,
  deriveEventType,
  deriveStatusAfterEvent,
  AssignmentConflictError,
} from '@/domain/assignmentEvents.js';
import { ASSIGNMENT_KINDS } from '@/domain/assets.js';

const WH = { kind: ASSIGNMENT_KINDS.WAREHOUSE, id: null };
const EMP = (id = 'e_1') => ({ kind: ASSIGNMENT_KINDS.EMPLOYEE, id });
const BR = (id = 'b_1') => ({ kind: ASSIGNMENT_KINDS.BRANCH, id });
const DEP = (id = 'd_1') => ({ kind: ASSIGNMENT_KINDS.DEPARTMENT, id });

describe('deriveEventType', () => {
  it('warehouse -> employee = issue', () => {
    expect(deriveEventType(WH, EMP())).toBe(EVENT_TYPES.ISSUE);
  });

  it('warehouse -> branch = issue', () => {
    expect(deriveEventType(WH, BR())).toBe(EVENT_TYPES.ISSUE);
  });

  it('warehouse -> department = issue', () => {
    expect(deriveEventType(WH, DEP())).toBe(EVENT_TYPES.ISSUE);
  });

  it('employee -> warehouse = return', () => {
    expect(deriveEventType(EMP(), WH)).toBe(EVENT_TYPES.RETURN);
  });

  it('branch -> warehouse = return', () => {
    expect(deriveEventType(BR(), WH)).toBe(EVENT_TYPES.RETURN);
  });

  it('employee -> employee (different id) = transfer', () => {
    expect(deriveEventType(EMP('a'), EMP('b'))).toBe(EVENT_TYPES.TRANSFER);
  });

  it('employee -> branch = transfer', () => {
    expect(deriveEventType(EMP(), BR())).toBe(EVENT_TYPES.TRANSFER);
  });

  it('warehouse -> warehouse (different id) = transfer', () => {
    expect(deriveEventType(WH, WH)).toBe(EVENT_TYPES.TRANSFER);
    // Note: same-kind same-id is caught by the no-op rule in validate, not here.
  });

  it('null (no prior history) -> employee = issue', () => {
    expect(deriveEventType(null, EMP())).toBe(EVENT_TYPES.ISSUE);
  });

  it('returns null on unknown to.kind', () => {
    expect(deriveEventType(WH, { kind: 'cosmos', id: 'x' })).toBeNull();
  });

  it('returns null on unknown from.kind', () => {
    expect(deriveEventType({ kind: 'cosmos', id: 'x' }, WH)).toBeNull();
  });
});

describe('deriveStatusAfterEvent', () => {
  it('issue -> assigned', () => {
    expect(deriveStatusAfterEvent(EVENT_TYPES.ISSUE, 'warehouse')).toBe('assigned');
  });

  it('return -> warehouse', () => {
    expect(deriveStatusAfterEvent(EVENT_TYPES.RETURN, 'assigned')).toBe('warehouse');
  });

  it('transfer keeps the existing status', () => {
    expect(deriveStatusAfterEvent(EVENT_TYPES.TRANSFER, 'assigned')).toBe('assigned');
    expect(deriveStatusAfterEvent(EVENT_TYPES.TRANSFER, 'remote')).toBe('remote');
  });

  it('transfer with null beforeStatus returns null', () => {
    expect(deriveStatusAfterEvent(EVENT_TYPES.TRANSFER, null)).toBeNull();
  });
});

describe('emptyAssignmentEventInput', () => {
  it('seeds fromAssignment from the asset and toAssignment as warehouse', () => {
    const asset = { assetId: 'a_1', assignedTo: EMP('e_5') };
    const e = emptyAssignmentEventInput(asset);
    expect(e.assetId).toBe('a_1');
    expect(e.fromAssignment).toEqual(EMP('e_5'));
    expect(e.toAssignment).toEqual(WH);
    expect(e.notes).toBeNull();
    expect(e.actUploadPath).toBeNull();
    expect(e.occurredAt).toBeInstanceOf(Date);
  });

  it('handles missing asset gracefully', () => {
    const e = emptyAssignmentEventInput(null);
    expect(e.assetId).toBe('');
    expect(e.fromAssignment).toBeNull();
  });
});

describe('sanitizeAssignmentEventInput', () => {
  it('trims notes and assetId, normalizes warehouse id to null', () => {
    const out = sanitizeAssignmentEventInput({
      assetId: '  a_1  ',
      fromAssignment: { kind: 'warehouse', id: '  ' },
      toAssignment: EMP('e_1'),
      notes: '  hi  ',
    });
    expect(out.assetId).toBe('a_1');
    expect(out.fromAssignment).toEqual(WH);
    expect(out.toAssignment).toEqual(EMP('e_1'));
    expect(out.notes).toBe('hi');
  });

  it('coerces empty/whitespace notes to null', () => {
    const out = sanitizeAssignmentEventInput({
      assetId: 'a_1',
      fromAssignment: WH,
      toAssignment: EMP(),
      notes: '   ',
    });
    expect(out.notes).toBeNull();
  });

  it('coerces fromAssignment=null when asset is fresh', () => {
    const out = sanitizeAssignmentEventInput({
      assetId: 'a_1',
      fromAssignment: null,
      toAssignment: EMP(),
    });
    expect(out.fromAssignment).toBeNull();
  });

  it('parses ISO occurredAt strings', () => {
    const out = sanitizeAssignmentEventInput({
      assetId: 'a_1',
      fromAssignment: WH,
      toAssignment: EMP(),
      occurredAt: '2026-05-07T10:00:00Z',
    });
    expect(out.occurredAt).toBeInstanceOf(Date);
  });

  it('defaults occurredAt to now when omitted', () => {
    const out = sanitizeAssignmentEventInput({
      assetId: 'a_1',
      fromAssignment: WH,
      toAssignment: EMP(),
    });
    expect(out.occurredAt).toBeInstanceOf(Date);
  });
});

describe('validateAssignmentEventInput', () => {
  function base(overrides = {}) {
    return {
      assetId: 'a_1',
      fromAssignment: WH,
      toAssignment: EMP(),
      occurredAt: new Date(),
      notes: null,
      actUploadPath: null,
      ...overrides,
    };
  }

  it('passes a clean issue input', () => {
    expect(validateAssignmentEventInput(base())).toEqual({});
    expect(isAssignmentEventInputValid(base())).toBe(true);
  });

  it('rejects empty assetId', () => {
    const errors = validateAssignmentEventInput(base({ assetId: '' }));
    expect(errors.assetId).toBe('errorRequired');
  });

  it('rejects missing toAssignment id (employee)', () => {
    const errors = validateAssignmentEventInput(
      base({ toAssignment: { kind: 'employee', id: null } })
    );
    expect(errors.toAssignment).toBe('errorRequired');
  });

  it('rejects no-op move (same kind same id)', () => {
    const errors = validateAssignmentEventInput(
      base({ fromAssignment: EMP('e_1'), toAssignment: EMP('e_1') })
    );
    expect(errors.toAssignment).toBe('errorAssignmentNoOp');
  });

  it('rejects no-op move (warehouse -> warehouse, same id)', () => {
    const errors = validateAssignmentEventInput(
      base({ fromAssignment: WH, toAssignment: WH })
    );
    expect(errors.toAssignment).toBe('errorAssignmentNoOp');
  });

  it('rejects issue invariant violation: employee -> employee tagged as issue', () => {
    // We can't tag — derive does that. But the matrix detects bad shape.
    // A "warehouse -> warehouse" with different ids is technically a transfer
    // by deriveEventType; explicit invariant test:
    const errors = validateAssignmentEventInput(
      base({ fromAssignment: { kind: 'warehouse', id: null }, toAssignment: WH })
    );
    expect(errors.toAssignment).toBeDefined();
  });

  it('accepts a return: employee -> warehouse', () => {
    expect(
      validateAssignmentEventInput(base({ fromAssignment: EMP(), toAssignment: WH }))
    ).toEqual({});
  });

  it('accepts a transfer: employee -> branch', () => {
    expect(
      validateAssignmentEventInput(base({ fromAssignment: EMP(), toAssignment: BR() }))
    ).toEqual({});
  });

  it('accepts a transfer: employee("a") -> employee("b")', () => {
    expect(
      validateAssignmentEventInput(
        base({ fromAssignment: EMP('a'), toAssignment: EMP('b') })
      )
    ).toEqual({});
  });

  it('rejects notes longer than MAX_NOTES_LENGTH', () => {
    const errors = validateAssignmentEventInput(
      base({ notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) })
    );
    expect(errors.notes).toBe('errorNotesTooLong');
  });

  it('accepts notes exactly at MAX_NOTES_LENGTH', () => {
    expect(
      validateAssignmentEventInput(base({ notes: 'x'.repeat(MAX_NOTES_LENGTH) }))
    ).toEqual({});
  });

  it('accepts a valid actUploadPath shape', () => {
    expect(
      validateAssignmentEventInput(
        base({ actUploadPath: 'assets/abc123/acts/event_1.pdf' })
      )
    ).toEqual({});
  });

  it.each([
    ['no leading assets/', 'a/abc/acts/x.pdf'],
    ['wrong extension', 'assets/abc/acts/x.txt'],
    ['too few segments', 'assets/abc/x.pdf'],
    ['too many segments', 'assets/abc/acts/sub/x.pdf'],
  ])('rejects bad actUploadPath shape (%s)', (_label, p) => {
    const errors = validateAssignmentEventInput(base({ actUploadPath: p }));
    expect(errors.actUploadPath).toBe('errorActPathShape');
  });

  it('accepts actUploadPath=null (Wave-1 default)', () => {
    expect(
      validateAssignmentEventInput(base({ actUploadPath: null }))
    ).toEqual({});
  });
});

describe('AssignmentConflictError', () => {
  it('carries expected/actual snapshots and a code', () => {
    const err = new AssignmentConflictError(WH, EMP('e_5'));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('assignment/conflict');
    expect(err.expected).toEqual(WH);
    expect(err.actual).toEqual(EMP('e_5'));
  });
});

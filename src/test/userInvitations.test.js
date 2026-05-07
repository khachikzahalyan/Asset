// src/test/userInvitations.test.js
import { describe, it, expect } from 'vitest';
import {
  INVITE_ROLES,
  INVITE_ROLE_LIST,
  INVITE_STATUS,
  emptyInviteInput,
  sanitizeInviteInput,
  validateInviteInput,
  isInviteInputValid,
  normalizeEmail,
} from '@/domain/userInvitations.js';

describe('userInvitations domain', () => {
  it('exposes the three invitable admin roles', () => {
    expect(INVITE_ROLES).toEqual({
      SUPER_ADMIN: 'super_admin',
      ASSET_ADMIN: 'asset_admin',
      TECH_ADMIN: 'tech_admin',
    });
    expect(INVITE_ROLE_LIST).toEqual(['super_admin', 'asset_admin', 'tech_admin']);
  });

  it('exposes the three invitation statuses', () => {
    expect(INVITE_STATUS).toEqual({
      PENDING: 'pending',
      ACCEPTED: 'accepted',
      REVOKED: 'revoked',
    });
  });

  it('emptyInviteInput returns a fresh object with tech_admin default', () => {
    expect(emptyInviteInput()).toEqual({ email: '', role: 'tech_admin' });
  });

  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(null)).toBe('');
  });

  it('sanitizeInviteInput normalizes email and coerces role', () => {
    expect(sanitizeInviteInput({ email: ' Foo@Bar.com ', role: 'asset_admin' })).toEqual({
      email: 'foo@bar.com',
      role: 'asset_admin',
    });
    // unknown role -> default tech_admin
    expect(sanitizeInviteInput({ email: 'a@b.com', role: 'employee' })).toEqual({
      email: 'a@b.com',
      role: 'tech_admin',
    });
  });

  it('validateInviteInput flags empty email', () => {
    expect(validateInviteInput({ email: '', role: 'tech_admin' })).toEqual({
      email: 'errEmailRequired',
    });
  });

  it('validateInviteInput flags malformed email', () => {
    expect(validateInviteInput({ email: 'not-an-email', role: 'tech_admin' })).toEqual({
      email: 'errEmailInvalid',
    });
  });

  it('validateInviteInput passes a clean input', () => {
    expect(validateInviteInput({ email: 'kolya@gmail.com', role: 'tech_admin' })).toEqual({});
    expect(isInviteInputValid({ email: 'kolya@gmail.com', role: 'tech_admin' })).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { profileStatusCopy } from './profile-catalog-view';

describe('profile catalog view model', () => {
  it('maps backend profile states to operator-facing labels', () => {
    expect(profileStatusCopy('ACTIVE')).toEqual({ label: 'Activo', tone: 'active' });
    expect(profileStatusCopy('INACTIVE')).toEqual({ label: 'Inactivo', tone: 'available' });
    expect(profileStatusCopy('SUSPENDED')).toEqual({ label: 'Suspendido', tone: 'handoff' });
    expect(profileStatusCopy('RETIRED')).toEqual({ label: 'Retirado', tone: 'handoff' });
  });
});

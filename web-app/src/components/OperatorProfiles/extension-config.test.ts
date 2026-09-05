import { describe, expect, it } from 'vitest';
import { resolveExtensionId } from './extension-config';

describe('extension configuration', () => {
  it('accepts the fixed Chrome extension id used by the manifest', () => {
    expect(resolveExtensionId('fcniigapdfcoigmnkhkcgmhlhjdledbo')).toBe('fcniigapdfcoigmnkhkcgmhlhjdledbo');
  });

  it('fails closed when the frontend has no extension id', () => {
    expect(() => resolveExtensionId(undefined)).toThrow('La extensión segura no está configurada en este equipo.');
  });

  it('rejects ids that cannot identify a Chrome extension', () => {
    expect(() => resolveExtensionId('not-an-extension-id')).toThrow('La extensión segura no está configurada en este equipo.');
  });
});

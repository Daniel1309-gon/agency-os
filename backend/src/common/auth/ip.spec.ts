import { describe, expect, it } from 'vitest';
import { normalizeIp, parseCidr, parseTrustedProxyCidrs, resolveClientIp } from './ip.js';

describe('IP security helpers', () => {
  it('normalizes IPv4-mapped IPv6 addresses before authorization', () => {
    expect(normalizeIp('::ffff:192.0.2.10')).toBe('192.0.2.10');
    expect(normalizeIp('2001:DB8::10')).toBe('2001:db8::10');
    expect(normalizeIp('0:0:0:0:0:FFFF:C000:020A')).toBe('192.0.2.10');
  });

  it('accepts IPv4 and IPv6 CIDRs and rejects malformed values', () => {
    expect(parseCidr(' 192.0.2.0/24 ')).toBe('192.0.2.0/24');
    expect(parseCidr('2001:DB8::/32')).toBe('2001:db8:0:0:0:0:0:0/32');
    expect(() => parseCidr('192.0.2.1')).toThrow(/CIDR/);
    expect(() => parseCidr('192.0.2.0/33')).toThrow(/CIDR/);
    expect(() => parseCidr('192.0.2.10/24')).toThrow(/CIDR/);
    expect(() => parseCidr('not-an-ip/24')).toThrow(/CIDR/);
  });

  it('does not silently discard malformed trusted proxy entries', () => {
    expect(parseTrustedProxyCidrs('')).toEqual([]);
    expect(parseTrustedProxyCidrs('10.0.0.0/8, 2001:db8::/32')).toEqual([
      '10.0.0.0/8',
      '2001:db8:0:0:0:0:0:0/32',
    ]);
    expect(() => parseTrustedProxyCidrs('10.0.0.0/8,,192.0.2.0/24')).toThrow(/TRUSTED_PROXY_CIDRS/);
  });

  it('only uses forwarded IPs when the immediate socket is trusted', async () => {
    expect(resolveClientIp('127.0.0.1', '203.0.113.10', '10.0.0.0/8')).toBe('127.0.0.1');
    expect(resolveClientIp('10.0.0.5', '203.0.113.10', '10.0.0.0/8')).toBe('203.0.113.10');
  });

  it('resolves a forwarded chain from the nearest trusted proxy outward', () => {
    expect(resolveClientIp('10.0.0.5', '203.0.113.10, 10.0.0.6', '10.0.0.0/8')).toBe('203.0.113.10');
    expect(resolveClientIp('198.51.100.5', '203.0.113.10', '10.0.0.0/8')).toBe('198.51.100.5');
    expect(resolveClientIp('10.0.0.5', 'not-an-ip', '10.0.0.0/8')).toBeUndefined();
  });
});

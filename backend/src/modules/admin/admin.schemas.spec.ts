import { describe, expect, it } from 'vitest';
import { ipAllowlistSchema } from './admin.schemas.js';

describe('IP allowlist input', () => {
  it('rejects malformed CIDRs before reaching PostgreSQL', () => {
    const result = ipAllowlistSchema.safeParse({ label: 'office', cidr: '192.0.2.0/33' });
    expect(result.success).toBe(false);
  });

  it('accepts IPv4 and IPv6 CIDRs', () => {
    expect(ipAllowlistSchema.parse({ label: 'office', cidr: '192.0.2.0/24' }).cidr).toBe('192.0.2.0/24');
    expect(ipAllowlistSchema.parse({ label: 'office-v6', cidr: '2001:DB8::/32' }).cidr).toBe('2001:db8:0:0:0:0:0:0/32');
  });
});

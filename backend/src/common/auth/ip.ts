import { isIP } from 'node:net';

interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

type ForwardedFor = string | string[] | undefined;

function invalidCidr(value: string, source = 'CIDR'): Error {
  return new Error(`${source} contains an invalid CIDR: ${value}`);
}

function parseIpv4(value: string): ParsedIp | undefined {
  if (isIP(value) !== 4) return undefined;
  const octets = value.split('.').map(Number);
  return { version: 4, value: octets.reduce((result, octet) => (result << 8n) | BigInt(octet), 0n) };
}

function parseIpv6(value: string): ParsedIp | undefined {
  if (isIP(value) !== 6 || value.includes('%')) return undefined;
  const [head, tail, ...extra] = value.toLowerCase().split('::');
  if (extra.length) return undefined;

  const parseGroups = (part: string | undefined): string[] => {
    if (!part) return [];
    const groups = part.split(':');
    const last = groups.at(-1);
    if (last?.includes('.')) {
      const ipv4 = parseIpv4(last);
      if (!ipv4) return [];
      groups.splice(-1, 1, (ipv4.value >> 16n).toString(16), (ipv4.value & 0xffffn).toString(16));
    }
    return groups;
  };

  const headGroups = parseGroups(head);
  const tailGroups = parseGroups(tail);
  const zeroGroups = value.includes('::') ? 8 - headGroups.length - tailGroups.length : 0;
  if (zeroGroups < (value.includes('::') ? 1 : 0) || headGroups.length + tailGroups.length + zeroGroups !== 8) return undefined;

  const groups = [...headGroups, ...Array.from({ length: zeroGroups }, () => '0'), ...tailGroups];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  const parsed = groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
  return { version: 6, value: parsed };
}

function parseIp(value: string | undefined): ParsedIp | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  return parseIpv4(candidate) ?? parseIpv6(candidate);
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join('.');
}

function formatIpv6(value: bigint): string {
  return Array.from({ length: 8 }, (_, index) => {
    const shift = BigInt((7 - index) * 16);
    return ((value >> shift) & 0xffffn).toString(16);
  }).join(':');
}

/**
 * Normalizes the address forms that can otherwise represent the same client.
 * PostgreSQL accepts both families, but an IPv4-mapped IPv6 address must be
 * reduced to IPv4 before comparing it with an IPv4 allowlist entry.
 */
export function normalizeIp(value: string | undefined): string | undefined {
  const parsed = parseIp(value);
  if (!parsed) return undefined;
  if (parsed.version === 4) return formatIpv4(parsed.value);
  if ((parsed.value >> 32n) === 0xffffn) return formatIpv4(parsed.value & 0xffffffffn);
  return value?.trim().toLowerCase();
}

function parseCidrParts(value: string): { ip: ParsedIp; prefix: number } {
  const candidate = value.trim();
  const separator = candidate.lastIndexOf('/');
  if (separator <= 0 || separator === candidate.length - 1) throw invalidCidr(value);

  const address = candidate.slice(0, separator).trim();
  const prefixText = candidate.slice(separator + 1).trim();
  const ip = parseIp(address);
  const prefix = Number(prefixText);
  const maxPrefix = ip?.version === 4 ? 32 : ip?.version === 6 ? 128 : -1;
  if (!ip || !/^\d+$/.test(prefixText) || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw invalidCidr(value);
  }

  const width = BigInt(maxPrefix);
  const hostMask = prefix === maxPrefix ? 0n : (1n << (width - BigInt(prefix))) - 1n;
  if ((ip.value & hostMask) !== 0n) throw invalidCidr(value);
  return { ip, prefix };
}

export function parseCidr(value: string): string {
  const { ip, prefix } = parseCidrParts(value);
  return `${ip.version === 4 ? formatIpv4(ip.value) : formatIpv6(ip.value)}/${prefix}`;
}

export function ipInCidr(value: string | undefined, cidr: string): boolean {
  const ip = parseIp(value);
  let network: ReturnType<typeof parseCidrParts>;
  try {
    network = parseCidrParts(cidr);
  } catch {
    return false;
  }
  if (!ip || ip.version !== network.ip.version) return false;
  const width = BigInt(ip.version === 4 ? 32 : 128);
  const hostMask = network.prefix === Number(width) ? 0n : (1n << (width - BigInt(network.prefix))) - 1n;
  return (ip.value & ~hostMask) === network.ip.value;
}

export function parseTrustedProxyCidrs(value: string): string[] {
  const candidate = value.trim();
  if (!candidate) return [];

  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => !entry)) throw new Error('TRUSTED_PROXY_CIDRS contains an empty entry');
  return entries.map((entry) => {
    try {
      return parseCidr(entry);
    } catch {
      throw invalidCidr(entry, 'TRUSTED_PROXY_CIDRS');
    }
  });
}

function forwardedAddresses(value: ForwardedFor): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((header) => header.split(','))
    .map((address) => address.trim());
}

/**
 * Resolves a client address from a socket and its forwarded chain. The chain
 * is evaluated from the socket outward; headers are accepted only while every
 * hop encountered is in the explicitly configured trusted proxy CIDRs.
 */
export function resolveClientIp(
  socketIp: string | undefined,
  forwardedFor: ForwardedFor,
  trustedProxyCidrs: string | readonly string[],
): string | undefined {
  const direct = normalizeIp(socketIp);
  if (!direct) return undefined;
  const trusted = typeof trustedProxyCidrs === 'string'
    ? parseTrustedProxyCidrs(trustedProxyCidrs)
    : trustedProxyCidrs;
  if (!trusted.some((cidr) => ipInCidr(direct, cidr))) return direct;

  const forwarded = forwardedAddresses(forwardedFor);
  if (!forwarded.length) return direct;
  const chain = [direct, ...[...forwarded].reverse()];
  for (const address of chain) {
    const normalized = normalizeIp(address);
    if (!normalized) return undefined;
    if (!trusted.some((cidr) => ipInCidr(normalized, cidr))) return normalized;
  }
  return normalizeIp(forwarded[0]) ?? direct;
}

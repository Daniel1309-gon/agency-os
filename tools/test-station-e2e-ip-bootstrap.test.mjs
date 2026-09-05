import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBootstrapCidrs } from '../backend/scripts/db-bootstrap-e2e-ips.mjs';

test('station bootstrap accepts Docker ingress, server and station IPv4 /32 entries', () => {
  assert.deepEqual(parseBootstrapCidrs('172.30.0.1/32,192.168.20.10/32,192.168.20.55/32'), [
    { label: 'station-e2e-docker-ingress', cidr: '172.30.0.1/32' },
    { label: 'station-e2e-server', cidr: '192.168.20.10/32' },
    { label: 'station-e2e-client', cidr: '192.168.20.55/32' },
  ]);
});

test('station bootstrap rejects broad, duplicate and non-IPv4 networks', () => {
  assert.throws(() => parseBootstrapCidrs('192.168.20.0/24'), /exactly three/);
  assert.throws(() => parseBootstrapCidrs('172.30.0.1/32,192.168.20.10/32,192.168.20.10/32'), /unique/);
  assert.throws(() => parseBootstrapCidrs('172.30.0.1/32,192.168.20.10/32,192.168.20.55/24'), /IPv4 \/32/);
  assert.throws(() => parseBootstrapCidrs('172.30.0.1/32,192.168.20.10/32,2001:db8::1/128'), /IPv4 \/32/);
});

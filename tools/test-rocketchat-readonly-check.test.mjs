import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateRocketChatIdentity } from '../backend/scripts/rocketchat-readonly-check.mjs';

test('Rocket.Chat read-only check accepts the configured active service identity', () => {
  assert.deepEqual(validateRocketChatIdentity({ _id: 'service-id', active: true, username: 'agency-service' }, 'service-id'), {
    id: 'service-id',
    username: 'agency-service',
  });
});

test('Rocket.Chat read-only check rejects another or inactive account', () => {
  assert.throws(() => validateRocketChatIdentity({ _id: 'other', active: true }, 'service-id'), /identity/);
  assert.throws(() => validateRocketChatIdentity({ _id: 'service-id', active: false }, 'service-id'), /active/);
});

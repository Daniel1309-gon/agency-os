import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readRoomId, toMemberRows } from '../backend/scripts/rocketchat-room-ids.mjs';

test('Rocket.Chat room lookup reads the private room id and rejects anything else', () => {
  assert.equal(readRoomId({ group: { _id: 'room-1' } }), 'room-1');
  assert.throws(() => readRoomId({}), /private room/);
  assert.throws(() => readRoomId({ group: { _id: '' } }), /private room/);
});

test('Rocket.Chat member rows drop incomplete entries and sort by username', () => {
  assert.deepEqual(
    toMemberRows([
      { _id: 'u-2', username: 'zoe.operadora', name: 'Zoe' },
      { _id: 'u-1', username: 'agency.bot', name: 'Agency OS Bot' },
      { _id: 'u-3', name: 'sin username' },
      { username: 'sin.id', name: 'sin id' },
    ]),
    [
      { username: 'agency.bot', name: 'Agency OS Bot', id: 'u-1' },
      { username: 'zoe.operadora', name: 'Zoe', id: 'u-2' },
    ],
  );
  assert.throws(() => toMemberRows(undefined), /member list/);
});

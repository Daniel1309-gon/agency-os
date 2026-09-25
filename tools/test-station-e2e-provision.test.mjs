import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEMO_CREDENTIAL_TARGETS, validateDemoProfiles } from './provision-station-e2e.mjs';

test('vault provisioning targets the six documented fictitious profiles', () => {
  assert.deepEqual(DEMO_CREDENTIAL_TARGETS, [
    { loginEmail: 'luna.demo@talkytimes.test', chromeProfileDir: 'Profile 1' },
    { loginEmail: 'mar.demo@talkytimes.test', chromeProfileDir: 'Profile 2' },
    { loginEmail: 'sol.demo@talkytimes.test', chromeProfileDir: 'Profile 3' },
    { loginEmail: 'nube.demo@talkytimes.test', chromeProfileDir: 'Profile 4' },
    { loginEmail: 'alma.demo@talkytimes.test', chromeProfileDir: 'Profile 5' },
    { loginEmail: 'vera.demo@talkytimes.test', chromeProfileDir: 'Profile 6' },
  ]);
});

test('vault provisioning refuses missing or incorrectly-bound profiles', () => {
  const valid = DEMO_CREDENTIAL_TARGETS.map((target, index) => ({ ...target, id: `id-${index}` }));
  assert.equal(validateDemoProfiles(valid).length, 6);
  assert.throws(() => validateDemoProfiles(valid.slice(1)), /missing/);
  assert.throws(
    () => validateDemoProfiles(valid.map((profile, index) => index === 0 ? { ...profile, chromeProfileDir: 'Profile 99' } : profile)),
    /expected Profile 1/,
  );
});

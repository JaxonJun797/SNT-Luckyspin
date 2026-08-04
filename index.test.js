const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsername, validUsername, secureWeightedIndex, validatePrizeConfig, buildDateRange, prizeAmount } = require('./index');

test('normalizes and validates usernames', () => {
  assert.equal(normalizeUsername('  Jaxon   Jun  '), 'jaxon jun');
  assert.equal(validUsername('jaxon_797'), true);
  assert.equal(validUsername('<script>'), false);
});

test('weighted draw ignores zero-weight entries', () => {
  for (let attempt = 0; attempt < 100; attempt += 1) assert.equal(secureWeightedIndex([0, 1, 0]), 1);
});

test('prize configuration requires aligned translations and weights', () => {
  const prizes = { en: ['A', 'B'], mm: ['က', 'ခ'] };
  assert.equal(validatePrizeConfig(prizes, [1, 2]), null);
  assert.match(validatePrizeConfig(prizes, [1]), /match/);
});

test('builds inclusive Myanmar-time date filters', () => {
  const range = buildDateRange('2026-08-01', '2026-08-03');
  assert.equal(range.$gte.toISOString(), '2026-07-31T17:30:00.000Z');
  assert.equal(range.$lte.toISOString(), '2026-08-03T17:29:59.999Z');
});

test('extracts English and Myanmar MMK amounts', () => {
  assert.equal(prizeAmount('15,000 MMK'), 15000);
  assert.equal(prizeAmount('၁၀၀,၀၀၀ ကျပ်'), 100000);
  assert.equal(prizeAmount('Thank you'), 0);
});

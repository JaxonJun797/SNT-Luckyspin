const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsername, validUsername, secureWeightedIndex, validatePrizeConfig } = require('./index');

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

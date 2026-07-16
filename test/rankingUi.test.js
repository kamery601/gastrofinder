const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// public/ranking-ui.js is a browser IIFE (window.GastroRankingUI). It exists because
// ranking.js (Node/CommonJS) cannot be `require()`d from a plain vanilla-JS frontend
// with no bundler — so the price-fairness logic that actually drives sorting in the
// browser lives here, tested the same way as opening-hours.js/location-context.js.
const source = fs.readFileSync(path.join(__dirname, '../public/ranking-ui.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'ranking-ui.js' });
const { priceCoverage, priceSortEnabled, compareByPrice, compareByValue } = sandbox.window.GastroRankingUI;

test('priceCoverage: 80% coverage (8/10 priced) keeps price sorts enabled', () => {
  const places = [
    ...Array(8).fill({ priceLevel: 2 }),
    ...Array(2).fill({ priceLevel: null })
  ];
  assert.strictEqual(priceCoverage(places), 0.8);
  assert.strictEqual(priceSortEnabled(places), true);
});

test('priceCoverage: 40% coverage (4/10 priced) disables price sorts', () => {
  const places = [
    ...Array(4).fill({ priceLevel: 2 }),
    ...Array(6).fill({ priceLevel: null })
  ];
  assert.strictEqual(priceCoverage(places), 0.4);
  assert.strictEqual(priceSortEnabled(places), false);
});

test('priceCoverage: empty list is 0 (never claim trustworthy price data with no places)', () => {
  assert.strictEqual(priceCoverage([]), 0);
  assert.strictEqual(priceSortEnabled([]), false);
});

test('priceCoverage: exactly the 60% threshold counts as enabled', () => {
  const places = [
    ...Array(6).fill({ priceLevel: 1 }),
    ...Array(4).fill({ priceLevel: null })
  ];
  assert.strictEqual(priceSortEnabled(places), true);
});

test('compareByPrice: a place without price is never treated as cheapest', () => {
  const noPrice = { priceLevel: null };
  const expensive = { priceLevel: 4 };
  assert.ok(compareByPrice(noPrice, expensive) > 0, 'unpriced place must sort after even the most expensive priced place');
});

test('compareByPrice: priced places sort ascending by priceLevel', () => {
  const cheap = { priceLevel: 1 };
  const pricey = { priceLevel: 3 };
  assert.ok(compareByPrice(cheap, pricey) < 0);
});

test('compareByValue: a place without price does not participate in value ranking', () => {
  const noPrice = { score: 49, priceLevel: null };
  const priced = { score: 10, priceLevel: 4 };
  assert.ok(compareByValue(noPrice, priced) > 0, 'unpriced place must sort after every priced place regardless of its raw score');
});

test('compareByValue: among priced places, higher score-per-price-unit wins', () => {
  const cheapGood = { score: 40, priceLevel: 1 };
  const expensiveSameScore = { score: 40, priceLevel: 4 };
  assert.ok(compareByValue(cheapGood, expensiveSameScore) < 0);
});

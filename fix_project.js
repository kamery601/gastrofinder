const fs = require('fs');

// 1. PLACESSERVICE.JS - mapowanie priceLevel STRING -> NUMBER
let ps = fs.readFileSync('placesService.js', 'utf8');
const MAP = '\nconst PRICE_LEVEL_MAP = {\n  PRICE_LEVEL_UNSPECIFIED: null,\n  PRICE_LEVEL_FREE: 0,\n  PRICE_LEVEL_INEXPENSIVE: 1,\n  PRICE_LEVEL_MODERATE: 2,\n  PRICE_LEVEL_EXPENSIVE: 3,\n  PRICE_LEVEL_VERY_EXPENSIVE: 4\n};\nfunction normalizePriceLevel(raw) {\n  if (raw === null || raw === undefined) return null;\n  if (typeof raw === "number") return raw;\n  const v = PRICE_LEVEL_MAP[raw];\n  return v !== undefined ? v : null;\n}\n';
ps = ps.replace('const SEARCH_CONFIG = {', MAP + '\nconst SEARCH_CONFIG = {');
ps = ps.replace('          results.push(place);', '          place.priceLevel = normalizePriceLevel(place.priceLevel);\n          results.push(place);');
fs.writeFileSync('placesService.js', ps);
console.log('OK placesService.js');

// 2. SERVER.JS - walidacja parametrow
let sv = fs.readFileSync('server.js', 'utf8');
sv = sv.replace(
  "app.get('/api/geocode', async (req, res) => {\n  try {",
  "app.get('/api/geocode', async (req, res) => {\n  if (!req.query.address || !String(req.query.address).trim()) return res.status(400).json({ error: 'Brak adresu' });\n  try {"
);
sv = sv.replace(
  "app.get('/api/nearby', async (req, res) => {\n  try {",
  "app.get('/api/nearby', async (req, res) => {\n  if (!req.query.location) return res.status(400).json({ error: 'Brak location' });\n  try {"
);
fs.writeFileSync('server.js', sv);
console.log('OK server.js');

// 3. PACKAGE.JSON - usun cors
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
delete pkg.dependencies.cors;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('OK package.json');

console.log('\nWszystko naprawione!');

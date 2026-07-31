const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3001);

const DEFAULT_PRIZES = {
  en: ['500 MMK', '1,000 MMK', '2,000 MMK', '3,000 MMK', '5,000 MMK', '10,000 MMK', '15,000 MMK', '30,000 MMK', '100,000 MMK'],
  mm: ['၅၀၀ ကျပ်', '၁,၀၀၀ ကျပ်', '၂,၀၀၀ ကျပ်', '၃,၀၀၀ ကျပ်', '၅,၀၀၀ ကျပ်', '၁၀,၀၀၀ ကျပ်', '၁၅,၀၀၀ ကျပ်', '၃၀,၀၀၀ ကျပ်', '၁၀၀,၀၀၀ ကျပ်']
};
const DEFAULT_WEIGHTS = [30, 20, 40, 30, 1, 0.1, 0.01, 0.001, 0.0001];

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(value => value.trim()).filter(Boolean);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  }
}));
app.use(express.json({ limit: '100kb' }));

const spinSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  prize: { type: String, required: true },
  prizeIndex: { type: Number, required: true },
  date: { type: Date, default: Date.now, index: true },
  device: { type: String, default: 'Unknown' },
  ipAddress: { type: String, default: 'Unknown' }
}, { versionKey: false });

const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

const Spin = mongoose.model('Spin', spinSchema);
const Config = mongoose.model('Config', configSchema);

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function validUsername(value) {
  return value.length >= 2 && value.length <= 40 && /^[\p{L}\p{N}_.@+\- ]+$/u.test(value);
}

function secureWeightedIndex(weights) {
  const clean = weights.map(Number).map(value => Number.isFinite(value) && value >= 0 ? value : 0);
  const total = clean.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error('Prize weights must have a positive total');
  const target = crypto.randomInt(0, 1_000_000_000) / 1_000_000_000 * total;
  let cursor = 0;
  for (let index = 0; index < clean.length; index += 1) {
    cursor += clean[index];
    if (target < cursor) return index;
  }
  return clean.length - 1;
}

function tokenMatches(provided) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!tokenMatches(token)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  next();
}

function parseDevice(userAgent = '') {
  if (/mobile|android|iphone|ipad/i.test(userAgent)) return 'Mobile';
  if (userAgent) return 'Desktop';
  return 'Unknown';
}

async function readConfig() {
  const configs = await Config.find({ key: { $in: ['prizes', 'probabilities', 'displayMode', 'baseCounter'] } }).lean();
  const values = Object.fromEntries(configs.map(item => [item.key, item.value]));
  return {
    prizes: values.prizes || DEFAULT_PRIZES,
    probabilities: values.probabilities || DEFAULT_WEIGHTS,
    displayMode: values.displayMode || 'real',
    baseCounter: Number(values.baseCounter || 0)
  };
}

function validatePrizeConfig(prizes, probabilities) {
  if (!prizes || !Array.isArray(prizes.en) || !Array.isArray(prizes.mm)) return 'Both prize languages are required';
  if (prizes.en.length < 2 || prizes.en.length > 16 || prizes.en.length !== prizes.mm.length) return 'Prize lists must have 2–16 matching entries';
  if (!prizes.en.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 80)) return 'Invalid English prize';
  if (!prizes.mm.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 80)) return 'Invalid Myanmar prize';
  if (!Array.isArray(probabilities) || probabilities.length !== prizes.en.length) return 'Weights must match the prize count';
  if (!probabilities.every(value => Number.isFinite(Number(value)) && Number(value) >= 0) || probabilities.every(value => Number(value) === 0)) return 'Weights must be non-negative with a positive total';
  return null;
}

app.get('/api/health', (req, res) => {
  res.json({ success: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/api/test', async (req, res) => {
  const spinCount = mongoose.connection.readyState === 1 ? await Spin.countDocuments() : 0;
  res.json({ success: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', spinCount });
});

app.get('/api/config', async (req, res, next) => {
  try {
    const config = await readConfig();
    res.json({ success: true, config: { prizes: config.prizes } });
  } catch (error) { next(error); }
});

app.post('/api/spin', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const language = req.body.language === 'mm' ? 'mm' : 'en';
    if (!validUsername(username)) return res.status(400).json({ success: false, error: 'Username must be 2–40 valid characters' });
    const existing = await Spin.findOne({ username }).lean();
    if (existing) return res.status(409).json({ success: false, error: 'This username has already played', spin: existing });

    const config = await readConfig();
    const configError = validatePrizeConfig(config.prizes, config.probabilities);
    if (configError) throw new Error(configError);
    const prizeIndex = secureWeightedIndex(config.probabilities);
    const userAgent = req.get('user-agent') || '';
    const spin = await Spin.create({
      username,
      prize: config.prizes[language][prizeIndex],
      prizeIndex,
      device: parseDevice(userAgent),
      ipAddress: req.ip || 'Unknown'
    });
    res.status(201).json({ success: true, spin: { username: spin.username, prize: spin.prize, prizeIndex, date: spin.date } });
  } catch (error) {
    if (error && error.code === 11000) return res.status(409).json({ success: false, error: 'This username has already played' });
    next(error);
  }
});

app.get('/api/winner-board', async (req, res, next) => {
  try {
    const spins = await Spin.find().sort({ date: -1 }).limit(20).lean();
    const winners = spins.map(spin => ({
      username: spin.username.length > 3 ? `${spin.username.slice(0, 3)}****` : `${spin.username[0] || '*'}****`,
      prize: spin.prize,
      date: spin.date
    }));
    res.json({ success: true, winners });
  } catch (error) { next(error); }
});

app.get('/api/total-spins', async (req, res, next) => {
  try {
    const [{ baseCounter }, count] = await Promise.all([readConfig(), Spin.countDocuments()]);
    res.json({ success: true, totalSpins: baseCounter + count });
  } catch (error) { next(error); }
});

app.post('/api/admin/login', (req, res) => {
  if (!tokenMatches(String(req.body.token || ''))) return res.status(401).json({ success: false, error: 'Invalid admin token' });
  res.json({ success: true });
});

app.use('/api/admin', requireAdmin);

app.get('/api/admin/stats', async (req, res, next) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [totalSpins, todaySpins, latestSpins] = await Promise.all([
      Spin.countDocuments(), Spin.countDocuments({ date: { $gte: start } }), Spin.find().sort({ date: -1 }).limit(200).lean()
    ]);
    res.json({ success: true, stats: { totalSpins, totalUsers: totalSpins, todaySpins }, spins: latestSpins });
  } catch (error) { next(error); }
});

app.get('/api/admin/config', async (req, res, next) => {
  try { res.json({ success: true, config: await readConfig() }); } catch (error) { next(error); }
});

app.put('/api/admin/config', async (req, res, next) => {
  try {
    const current = await readConfig();
    const prizes = req.body.prizes || current.prizes;
    const probabilities = req.body.probabilities || current.probabilities;
    const error = validatePrizeConfig(prizes, probabilities);
    if (error) return res.status(400).json({ success: false, error });
    const entries = { prizes, probabilities };
    if (req.body.baseCounter !== undefined) entries.baseCounter = Math.max(0, Math.floor(Number(req.body.baseCounter) || 0));
    await Promise.all(Object.entries(entries).map(([key, value]) => Config.findOneAndUpdate(
      { key }, { value, updatedAt: new Date() }, { upsert: true, new: true }
    )));
    res.json({ success: true, config: await readConfig() });
  } catch (error) { next(error); }
});

app.delete('/api/admin/spins/:username', async (req, res, next) => {
  try {
    const result = await Spin.deleteOne({ username: normalizeUsername(req.params.username) });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) { next(error); }
});

app.post('/api/admin/reset', async (req, res, next) => {
  try {
    if (req.body.confirmation !== 'RESET ALL SPINS') return res.status(400).json({ success: false, error: 'Confirmation phrase does not match' });
    const result = await Spin.deleteMany({});
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) { next(error); }
});

app.get('/api/admin/export', async (req, res, next) => {
  try {
    const spins = await Spin.find().sort({ date: -1 }).lean();
    res.setHeader('Content-Disposition', `attachment; filename="snt-spins-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exportedAt: new Date().toISOString(), spins });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  if (!process.env.ADMIN_TOKEN) throw new Error('ADMIN_TOKEN is required');
  await mongoose.connect(process.env.MONGODB_URI);
  await Spin.syncIndexes();
  app.listen(PORT, () => console.log(`SNT Lucky Spin API listening on ${PORT}`));
}

if (require.main === module) {
  start().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { app, normalizeUsername, validUsername, secureWeightedIndex, validatePrizeConfig };

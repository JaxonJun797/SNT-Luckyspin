// Basic Express server for Lucky Spin
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files

// Trust proxy to get real IP addresses
app.set('trust proxy', true);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Add connection event listeners
mongoose.connection.on('connected', () => {
  console.log('✅ Connected to MongoDB successfully');
  console.log('📊 Database:', mongoose.connection.name);
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
});

// Define schema for spins
const spinSchema = new mongoose.Schema({
  username: { type: String, required: true },
  prize: { type: String, required: true },
  date: { type: Date, default: Date.now },
  device: { type: String, default: 'Unknown' },
  os: { type: String, default: 'Unknown' },
  browser: { type: String, default: 'Unknown' },
  userAgent: { type: String, default: '' },
  ipAddress: { type: String, default: 'Unknown' }
});

const Spin = mongoose.model('Spin', spinSchema);

// Save a spin result
app.post('/api/spin', async (req, res) => {
  try {
    let { username, prize } = req.body;
    
    if (!username || !prize) {
      return res.status(400).json({ success: false, error: 'Username and prize are required' });
    }
    
    // Sanitize input
    username = username.trim().toLowerCase();
    prize = prize.trim();
    
    // Validate username length and characters
    if (username.length < 2 || username.length > 50) {
      return res.status(400).json({ success: false, error: 'Username must be between 2-50 characters' });
    }
    
    // Check if user already spun
    const existingSpin = await Spin.findOne({ username });
    if (existingSpin) {
      return res.status(409).json({ success: false, error: 'User already spun' });
    }
    
    // Parse user agent for device/OS/browser information
    const userAgent = req.headers['user-agent'] || '';
    const deviceInfo = parseUserAgent(userAgent);
    
    // Get IP address (handle proxy headers and modern Express)
    let ipAddress = 'Unknown';
    
    // Try different methods to get IP address
    if (req.headers['x-forwarded-for']) {
      // Handle comma-separated list of IPs (first one is the original client)
      ipAddress = req.headers['x-forwarded-for'].split(',')[0].trim();
    } else if (req.headers['x-real-ip']) {
      ipAddress = req.headers['x-real-ip'];
    } else if (req.ip) {
      // Express req.ip (requires trust proxy)
      ipAddress = req.ip;
    } else if (req.connection && req.connection.remoteAddress) {
      ipAddress = req.connection.remoteAddress;
    } else if (req.socket && req.socket.remoteAddress) {
      ipAddress = req.socket.remoteAddress;
    }
    
    // Clean up IPv6 localhost
    if (ipAddress === '::1' || ipAddress === '::ffff:127.0.0.1') {
      ipAddress = '127.0.0.1 (localhost)';
    }
    
    console.log('IP Detection:', {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'req.ip': req.ip,
      'connection.remoteAddress': req.connection?.remoteAddress,
      'socket.remoteAddress': req.socket?.remoteAddress,
      'final_ip': ipAddress
    });
    
    const spin = new Spin({ 
      username, 
      prize,
      device: deviceInfo.device,
      os: deviceInfo.os,
      browser: deviceInfo.browser,
      userAgent: userAgent,
      ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress
    });
    await spin.save();
    res.status(201).json({ success: true, spin });
  } catch (err) {
    console.error('Spin save error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all spins (winner history)
app.get('/api/spins', async (req, res) => {
  try {
    const { dateFilter, startDate, endDate } = req.query;
    
    let dateQuery = {};
    
    if (dateFilter) {
      // Single date filter (YYYY-MM-DD)
      const filterDate = new Date(dateFilter);
      const nextDay = new Date(filterDate);
      nextDay.setDate(nextDay.getDate() + 1);
      
      dateQuery = {
        date: { $gte: filterDate, $lt: nextDay }
      };
    } else if (startDate && endDate) {
      // Date range filter
      dateQuery = {
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      };
    }
    
    const spins = await Spin.find(dateQuery).sort({ date: -1 }).limit(100);
    res.json(spins);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete all spins (admin only)
app.delete('/api/spins', async (req, res) => {
  try {
    await Spin.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete spins by username (admin only)
app.delete('/api/spins/user/:username', async (req, res) => {
  try {
    let username = req.params.username;
    if (!username) {
      return res.status(400).json({ success: false, error: 'Username is required.' });
    }
    username = username.trim().toLowerCase();
    // Match username exactly, case-insensitive, and ignore whitespace
    const result = await Spin.deleteMany({ username: username });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test endpoint to check database connection
app.get('/api/test', async (req, res) => {
  try {
    const dbName = mongoose.connection.name;
    const collections = await mongoose.connection.db.listCollections().toArray();
    const spinCount = await Spin.countDocuments();
    
    // Get sample dates from database
    const sampleSpins = await Spin.find().limit(10).sort({ date: -1 });
    const dates = sampleSpins.map(spin => ({
      username: spin.username,
      date: spin.date,
      dateString: spin.date.toISOString().split('T')[0]
    }));
    
    res.json({
      success: true,
      database: dbName,
      collections: collections.map(c => c.name),
      spinCount: spinCount,
      sampleDates: dates,
      message: 'Database connection is working!'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      message: 'Database connection failed!'
    });
  }
});

// ===== ADMIN ROUTES =====

// Helper function to parse Myanmar numbers
function myanmarToEnglish(str) {
  const myanmarDigits = '၀၁၂၃၄၅၆၇၈၉';
  return str.replace(/[၀-၉]/g, d => myanmarDigits.indexOf(d));
}

// Helper function to parse user agent and detect device/OS/browser
function parseUserAgent(userAgent) {
  if (!userAgent) {
    return { device: 'Unknown', os: 'Unknown', browser: 'Unknown' };
  }

  let device = 'Desktop';
  let os = 'Unknown';
  let browser = 'Unknown';

  // Detect device type
  if (/Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) {
    if (/iPad/i.test(userAgent)) {
      device = 'Tablet';
    } else {
      device = 'Mobile';
    }
  } else if (/Tablet/i.test(userAgent)) {
    device = 'Tablet';
  }

  // Detect OS
  if (/Windows NT 10.0/i.test(userAgent)) {
    os = 'Windows 10/11';
  } else if (/Windows NT 6.3/i.test(userAgent)) {
    os = 'Windows 8.1';
  } else if (/Windows NT 6.2/i.test(userAgent)) {
    os = 'Windows 8';
  } else if (/Windows NT 6.1/i.test(userAgent)) {
    os = 'Windows 7';
  } else if (/Windows/i.test(userAgent)) {
    os = 'Windows';
  } else if (/Mac OS X 10[._]15/i.test(userAgent)) {
    os = 'macOS Catalina+';
  } else if (/Mac OS X/i.test(userAgent)) {
    os = 'macOS';
  } else if (/Android 1[0-9]/i.test(userAgent)) {
    os = 'Android 10+';
  } else if (/Android [0-9]/i.test(userAgent)) {
    const match = userAgent.match(/Android ([0-9.]+)/i);
    os = match ? `Android ${match[1]}` : 'Android';
  } else if (/iPhone OS 1[0-9]/i.test(userAgent)) {
    os = 'iOS 10+';
  } else if (/iPhone OS/i.test(userAgent)) {
    const match = userAgent.match(/iPhone OS ([0-9_]+)/i);
    os = match ? `iOS ${match[1].replace(/_/g, '.')}` : 'iOS';
  } else if (/iPad.*OS 1[0-9]/i.test(userAgent)) {
    os = 'iPadOS 10+';
  } else if (/iPad.*OS/i.test(userAgent)) {
    const match = userAgent.match(/OS ([0-9_]+)/i);
    os = match ? `iPadOS ${match[1].replace(/_/g, '.')}` : 'iPadOS';
  } else if (/Linux/i.test(userAgent)) {
    os = 'Linux';
  } else if (/CrOS/i.test(userAgent)) {
    os = 'Chrome OS';
  }

  // Detect browser
  if (/Edg\//i.test(userAgent)) {
    browser = 'Microsoft Edge';
  } else if (/Chrome\//i.test(userAgent) && !/Chromium/i.test(userAgent)) {
    browser = 'Google Chrome';
  } else if (/Chromium\//i.test(userAgent)) {
    browser = 'Chromium';
  } else if (/Firefox\//i.test(userAgent)) {
    browser = 'Mozilla Firefox';
  } else if (/Safari\//i.test(userAgent) && !/Chrome/i.test(userAgent)) {
    browser = 'Safari';
  } else if (/Opera|OPR\//i.test(userAgent)) {
    browser = 'Opera';
  } else if (/Trident.*rv:11/i.test(userAgent)) {
    browser = 'Internet Explorer 11';
  } else if (/MSIE/i.test(userAgent)) {
    browser = 'Internet Explorer';
  }

  return { device, os, browser };
}

// Get admin statistics
app.get('/api/admin/stats', async (req, res) => {
  try {
    // Get date filter from query parameters
    const { startDate, endDate, dateFilter } = req.query;
    
    let dateQuery = {};
    let dateLabel = 'All Time';
    
    if (dateFilter) {
      // Single date filter (YYYY-MM-DD)
      console.log('Original dateFilter:', dateFilter);
      
      // Create start and end of the selected day
      const startOfDay = new Date(dateFilter + 'T00:00:00.000Z');
      const endOfDay = new Date(dateFilter + 'T23:59:59.999Z');
      
      dateQuery = {
        date: { $gte: startOfDay, $lte: endOfDay }
      };
      dateLabel = new Date(dateFilter).toLocaleDateString();
      
      console.log('Date filter applied:', {
        dateFilter,
        startOfDay: startOfDay.toISOString(),
        endOfDay: endOfDay.toISOString(),
        dateQuery
      });
    } else if (startDate && endDate) {
      // Date range filter
      dateQuery = {
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      };
      dateLabel = `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`;
    } else {
      // No date filter - show all time data
      dateQuery = {}; // All time data
    }
    
    // First, let's see what dates are actually in the database
    const allSpins = await Spin.find({}).sort({ date: -1 });
    console.log('All spins in database:', allSpins.map(s => ({
      username: s.username,
      date: s.date.toISOString(),
      dateOnly: s.date.toISOString().split('T')[0]
    })));
    
    // Get filtered data
    const filteredSpins = await Spin.find(dateQuery);
    const totalSpins = filteredSpins.length;
    const uniqueUsers = [...new Set(filteredSpins.map(spin => spin.username))];
    const totalUsers = uniqueUsers.length;
    
    console.log('Query results:', {
      dateQuery,
      totalSpinsInDB: allSpins.length,
      filteredSpinsCount: totalSpins,
      totalUsers,
      dateLabel,
      filteredSpins: filteredSpins.map(s => ({ 
        username: s.username, 
        date: s.date.toISOString(), 
        dateOnly: s.date.toISOString().split('T')[0],
        prize: s.prize 
      }))
    });
    
    // Calculate total prizes for filtered data
    let totalPrizes = 0;
    filteredSpins.forEach(spin => {
      let prizeStr = (spin.prize || '').replace(/,/g, '');
      prizeStr = myanmarToEnglish(prizeStr);
      if (/\d+/.test(prizeStr) && (prizeStr.includes('MMK') || prizeStr.includes('ကျပ်'))) {
        let match = prizeStr.match(/(\d+)/);
        if (match) totalPrizes += parseInt(match[1], 10);
      }
    });
    
    // Calculate today's spins (always today regardless of filter)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    
    const todaySpins = await Spin.countDocuments({
      date: { $gte: today, $lt: tomorrow }
    });
    
    res.json({
      success: true,
      stats: {
        totalUsers,
        totalSpins,
        totalPrizes,
        todaySpins,
        dateLabel
      },
      debug: {
        requestedDate: dateFilter || 'all-time',
        dateQuery,
        totalInDB: allSpins.length,
        filteredCount: filteredSpins.length,
        allDatesInDB: [...new Set(allSpins.map(s => s.date.toISOString().split('T')[0]))],
        shouldBeZero: dateFilter && filteredSpins.length === 0
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete single user (admin)
app.post('/api/admin/delete-user', async (req, res) => {
  try {
    let { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ success: false, error: 'Username is required' });
    }
    
    username = username.trim().toLowerCase();
    const result = await Spin.deleteMany({ username });
    
    res.json({ 
      success: true, 
      deletedCount: result.deletedCount,
      message: `Deleted ${result.deletedCount} records for user: ${username}`
    });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batch delete users (admin)
app.post('/api/admin/batch-delete', async (req, res) => {
  try {
    let { usernames } = req.body;
    
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ success: false, error: 'Usernames array is required' });
    }
    
    // Normalize usernames
    const normalizedUsernames = usernames.map(name => name.trim().toLowerCase());
    
    const result = await Spin.deleteMany({ 
      username: { $in: normalizedUsernames } 
    });
    
    res.json({ 
      success: true, 
      deletedCount: result.deletedCount,
      message: `Deleted ${result.deletedCount} records for ${usernames.length} users`
    });
  } catch (err) {
    console.error('Batch delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset all database (admin)
app.post('/api/admin/reset-all', async (req, res) => {
  try {
    const result = await Spin.deleteMany({});
    
    res.json({ 
      success: true, 
      deletedCount: result.deletedCount,
      message: `All database records deleted. Total: ${result.deletedCount}`
    });
  } catch (err) {
    console.error('Reset all error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export data (admin)
app.get('/api/admin/export', async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const spins = await Spin.find().sort({ date: -1 });
    
    if (format === 'csv') {
      // Convert to CSV with essential information
      const csvHeader = 'Username,Prize,Date,Device,IP Address,OS\n';
      const csvData = spins.map(spin => 
        `"${spin.username}","${spin.prize}","${spin.date.toISOString()}","${spin.device || 'Unknown'}","${spin.ipAddress || 'Unknown'}","${spin.os || 'Unknown'}"`
      ).join('\n');
      
      res.json({
        success: true,
        data: csvHeader + csvData,
        format: 'csv'
      });
    } else {
      // JSON format
      res.json({
        success: true,
        data: JSON.stringify(spins, null, 2),
        format: 'json'
      });
    }
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Import data (admin)
app.post('/api/admin/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fs = require('fs');
    const path = require('path');
    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    let importData = [];
    let importedCount = 0;

    // Parse file based on extension
    if (req.file.originalname.endsWith('.json')) {
      importData = JSON.parse(fileContent);
    } else if (req.file.originalname.endsWith('.csv')) {
      // Simple CSV parsing
      const lines = fileContent.split('\n');
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
          if (values.length >= 3) {
            importData.push({
              username: values[0],
              prize: values[1],
              date: new Date(values[2])
            });
          }
        }
      }
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported file format' });
    }

    // Import data to database
    for (const item of importData) {
      if (item.username && item.prize) {
        try {
          const spin = new Spin({
            username: item.username.toLowerCase(),
            prize: item.prize,
            date: item.date || new Date()
          });
          await spin.save();
          importedCount++;
        } catch (err) {
          // Skip duplicates or invalid entries
          console.log(`Skipped entry: ${item.username} - ${err.message}`);
        }
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      importedCount,
      message: `Successfully imported ${importedCount} records`
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== PRIZE AND PROBABILITY MANAGEMENT =====

// Schema for storing prizes and probabilities
const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

const Config = mongoose.model('Config', configSchema);

// Get prizes
app.get('/api/admin/prizes', async (req, res) => {
  try {
    let config = await Config.findOne({ key: 'prizes' });
    
    if (!config) {
      // Default prizes
      const defaultPrizes = {
        en: ["500 MMK", "1,000 MMK", "2,000 MMK", "3,000 MMK", "5,000 MMK", "10,000 MMK", "15,000 MMK", "30,000 MMK", "100,000 MMK"],
        mm: ["၅၀၀ ကျပ်", "၁၀၀၀ ကျပ်", "၂၀၀၀ ကျပ်", "၃၀၀၀ ကျပ်", "၅၀၀၀ ကျပ်", "၁၀၀၀၀ ကျပ်", "၁၅၀၀၀ ကျပ်", "၃၀၀၀၀ ကျပ်", "၁၀၀၀၀၀ ကျပ်"]
      };
      
      config = new Config({ key: 'prizes', value: defaultPrizes });
      await config.save();
    }
    
    res.json({ success: true, prizes: config.value });
  } catch (err) {
    console.error('Get prizes error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save prizes
app.post('/api/admin/prizes', async (req, res) => {
  try {
    const { prizes } = req.body;
    
    if (!prizes || !prizes.en || !prizes.mm) {
      return res.status(400).json({ success: false, error: 'Invalid prizes format' });
    }
    
    await Config.findOneAndUpdate(
      { key: 'prizes' },
      { value: prizes, updatedAt: new Date() },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Prizes saved successfully' });
  } catch (err) {
    console.error('Save prizes error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get probabilities
app.get('/api/admin/probabilities', async (req, res) => {
  try {
    let config = await Config.findOne({ key: 'probabilities' });
    
    if (!config) {
      // Default probabilities
      const defaultProbabilities = [30, 20, 40, 30, 1, 0.1, 0.01, 0.001, 0.0001];
      
      config = new Config({ key: 'probabilities', value: defaultProbabilities });
      await config.save();
    }
    
    res.json({ success: true, probabilities: config.value });
  } catch (err) {
    console.error('Get probabilities error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save probabilities
app.post('/api/admin/probabilities', async (req, res) => {
  try {
    const { probabilities } = req.body;
    
    if (!probabilities || !Array.isArray(probabilities)) {
      return res.status(400).json({ success: false, error: 'Invalid probabilities format' });
    }
    
    await Config.findOneAndUpdate(
      { key: 'probabilities' },
      { value: probabilities, updatedAt: new Date() },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Probabilities saved successfully' });
  } catch (err) {
    console.error('Save probabilities error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get current frontend config (for the main app to use)
app.get('/api/config', async (req, res) => {
  try {
    const prizesConfig = await Config.findOne({ key: 'prizes' });
    const probabilitiesConfig = await Config.findOne({ key: 'probabilities' });
    const displayModeConfig = await Config.findOne({ key: 'displayMode' });
    
    const defaultPrizes = {
      en: ["500 MMK", "1,000 MMK", "2,000 MMK", "3,000 MMK", "5,000 MMK", "10,000 MMK", "15,000 MMK", "30,000 MMK", "100,000 MMK"],
      mm: ["၅၀၀ ကျပ်", "၁၀၀၀ ကျပ်", "၂၀၀၀ ကျပ်", "၃၀၀၀ ကျပ်", "၅၀၀၀ ကျပ်", "၁၀၀၀၀ ကျပ်", "၁၅၀၀၀ ကျပ်", "၃၀၀၀၀ ကျပ်", "၁၀၀၀၀၀ ကျပ်"]
    };
    const defaultProbabilities = [30, 20, 40, 30, 1, 0.1, 0.01, 0.001, 0.0001];
    
    res.json({
      success: true,
      config: {
        prizes: prizesConfig ? prizesConfig.value : defaultPrizes,
        probabilities: probabilitiesConfig ? probabilitiesConfig.value : defaultProbabilities,
        displayMode: displayModeConfig ? displayModeConfig.value : 'demo' // 'real' or 'demo'
      }
    });
  } catch (err) {
    console.error('Get config error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== WINNER BOARD DISPLAY MODE MANAGEMENT =====

// Get display mode
app.get('/api/admin/display-mode', async (req, res) => {
  try {
    let config = await Config.findOne({ key: 'displayMode' });
    
    if (!config) {
      config = new Config({ key: 'displayMode', value: 'demo' });
      await config.save();
    }
    
    res.json({ success: true, displayMode: config.value });
  } catch (err) {
    console.error('Get display mode error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Set display mode
app.post('/api/admin/display-mode', async (req, res) => {
  try {
    const { displayMode } = req.body;
    
    if (!displayMode || !['real', 'demo'].includes(displayMode)) {
      return res.status(400).json({ success: false, error: 'Invalid display mode. Must be "real" or "demo"' });
    }
    
    await Config.findOneAndUpdate(
      { key: 'displayMode' },
      { value: displayMode, updatedAt: new Date() },
      { upsert: true }
    );
    
    res.json({ success: true, message: `Display mode set to ${displayMode}` });
  } catch (err) {
    console.error('Set display mode error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get winner board data based on display mode
app.get('/api/winner-board', async (req, res) => {
  try {
    const displayModeConfig = await Config.findOne({ key: 'displayMode' });
    const displayMode = displayModeConfig ? displayModeConfig.value : 'demo';
    
    if (displayMode === 'real') {
      // Return real users with masked usernames
      const recentSpins = await Spin.find().sort({ date: -1 }).limit(10);
      
      const winners = recentSpins.map((spin, index) => {
        // Mask username (show first 3 chars + ****)
        const maskedUsername = spin.username.length > 3 
          ? spin.username.substring(0, 3) + '****'
          : spin.username + '****';
        
        return {
          idx: index + 1,
          en: maskedUsername,
          mm: maskedUsername,
          prize: spin.prize,
          date: spin.date
        };
      });
      
      res.json({ success: true, winners, mode: 'real' });
    } else {
      // Return demo/fake data
      const demoWinners = [
        { en: "SNTYG****", mm: "SNTYG****" },
        { en: "SNTnay****", mm: "SNTnay****" },
        { en: "SNTMin****", mm: "SNTMin****" },
        { en: "SNTD****", mm: "SNTD****" },
        { en: "SNTKh*****", mm: "SNTKh*****" },
        { en: "SNTna*****", mm: "SNTna*****" },
        { en: "SNTMi*****", mm: "SNTMi*****" },
        { en: "SNTDE*****", mm: "SNTDE*****" },
        { en: "SNT22*****", mm: "SNT22*****" },
        { en: "SNT32***", mm: "SNT32***" }
      ];
      
      const demoPrizes = ["500 MMK", "1,000 MMK", "2,000 MMK", "3,000 MMK", "5,000 MMK", "10,000 MMK", "15,000 MMK", "30,000 MMK", "100,000 MMK"];
      
      // Generate deterministic demo data based on current date
      const today = new Date();
      const seed = parseInt(today.getFullYear() + ("0" + (today.getMonth() + 1)).slice(-2) + ("0" + today.getDate()).slice(-2));
      
      function seededRandom(seed) {
        let x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
      }
      
      // Shuffle demo winners
      let shuffledWinners = [...demoWinners];
      for (let i = shuffledWinners.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom(seed + i) * (i + 1));
        [shuffledWinners[i], shuffledWinners[j]] = [shuffledWinners[j], shuffledWinners[i]];
      }
      
      // Assign random prizes
      const winners = shuffledWinners.map((winner, index) => {
        const prizeIndex = Math.floor(seededRandom(seed + 100 + index) * demoPrizes.length);
        return {
          idx: index + 1,
          en: winner.en,
          mm: winner.mm,
          prize: demoPrizes[prizeIndex]
        };
      });
      
      res.json({ success: true, winners, mode: 'demo' });
    }
  } catch (err) {
    console.error('Get winner board error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get total spins count for frontend counter (includes base counter)
app.get('/api/total-spins', async (req, res) => {
  try {
    // Get base counter from config
    let baseCounterConfig = await Config.findOne({ key: 'totalSpinsBaseCounter' });
    const baseCounter = baseCounterConfig ? baseCounterConfig.value : 1958;
    
    // Get actual database count
    const dbCount = await Spin.countDocuments();
    
    // Total displayed counter
    const totalSpins = baseCounter + dbCount;
    
    res.json({
      success: true,
      totalSpins: totalSpins
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== TOTAL SPINS COUNTER MANAGEMENT =====

// Get total spins counter (includes base count + database count)
app.get('/api/admin/total-spins-counter', async (req, res) => {
  try {
    // Get base counter from config
    let baseCounterConfig = await Config.findOne({ key: 'totalSpinsBaseCounter' });
    const baseCounter = baseCounterConfig ? baseCounterConfig.value : 1958;
    
    // Get actual database count
    const dbCount = await Spin.countDocuments();
    
    // Total displayed counter
    const totalCounter = baseCounter + dbCount;
    
    res.json({
      success: true,
      totalCounter: totalCounter,
      baseCounter: baseCounter,
      dbCount: dbCount
    });
  } catch (err) {
    console.error('Get total spins counter error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update base counter for total spins
app.post('/api/admin/update-base-counter', async (req, res) => {
  try {
    const { baseCounter } = req.body;
    
    if (typeof baseCounter !== 'number' || baseCounter < 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Base counter must be a non-negative number' 
      });
    }
    
    // Update base counter in config
    await Config.findOneAndUpdate(
      { key: 'totalSpinsBaseCounter' },
      { value: baseCounter, updatedAt: new Date() },
      { upsert: true }
    );
    
    // Get current database count
    const dbCount = await Spin.countDocuments();
    const totalCounter = baseCounter + dbCount;
    
    res.json({
      success: true,
      message: 'Base counter updated successfully',
      baseCounter: baseCounter,
      dbCount: dbCount,
      totalCounter: totalCounter
    });
  } catch (err) {
    console.error('Update base counter error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Set total counter (adjusts base counter to achieve desired total)
app.post('/api/admin/set-total-counter', async (req, res) => {
  try {
    const { totalCounter } = req.body;
    
    if (typeof totalCounter !== 'number' || totalCounter < 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Total counter must be a non-negative number' 
      });
    }
    
    // Get current database count
    const dbCount = await Spin.countDocuments();
    
    // Calculate required base counter
    const requiredBaseCounter = Math.max(0, totalCounter - dbCount);
    
    // Update base counter in config
    await Config.findOneAndUpdate(
      { key: 'totalSpinsBaseCounter' },
      { value: requiredBaseCounter, updatedAt: new Date() },
      { upsert: true }
    );
    
    res.json({
      success: true,
      message: 'Total counter set successfully',
      totalCounter: totalCounter,
      baseCounter: requiredBaseCounter,
      dbCount: dbCount
    });
  } catch (err) {
    console.error('Set total counter error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset base counter to default (1958)
app.post('/api/admin/reset-base-counter', async (req, res) => {
  try {
    const defaultBaseCounter = 1958;
    
    // Update base counter in config
    await Config.findOneAndUpdate(
      { key: 'totalSpinsBaseCounter' },
      { value: defaultBaseCounter, updatedAt: new Date() },
      { upsert: true }
    );
    
    // Get current database count
    const dbCount = await Spin.countDocuments();
    const totalCounter = defaultBaseCounter + dbCount;
    
    res.json({
      success: true,
      message: 'Base counter reset to default (1958)',
      baseCounter: defaultBaseCounter,
      dbCount: dbCount,
      totalCounter: totalCounter
    });
  } catch (err) {
    console.error('Reset base counter error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test IP detection endpoint
app.get('/api/test-ip', (req, res) => {
  let ipAddress = 'Unknown';
  
  if (req.headers['x-forwarded-for']) {
    ipAddress = req.headers['x-forwarded-for'].split(',')[0].trim();
  } else if (req.headers['x-real-ip']) {
    ipAddress = req.headers['x-real-ip'];
  } else if (req.ip) {
    ipAddress = req.ip;
  } else if (req.connection && req.connection.remoteAddress) {
    ipAddress = req.connection.remoteAddress;
  } else if (req.socket && req.socket.remoteAddress) {
    ipAddress = req.socket.remoteAddress;
  }
  
  if (ipAddress === '::1' || ipAddress === '::ffff:127.0.0.1') {
    ipAddress = '127.0.0.1 (localhost)';
  }
  
  res.json({
    success: true,
    detectedIP: ipAddress,
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'user-agent': req.headers['user-agent']
    },
    expressIP: req.ip,
    connectionIP: req.connection?.remoteAddress,
    socketIP: req.socket?.remoteAddress
  });
});

// Debug endpoint to check device data
app.get('/api/debug/device-data', async (req, res) => {
  try {
    const allSpins = await Spin.find().sort({ date: -1 }).limit(10);
    
    const deviceData = allSpins.map(spin => ({
      username: spin.username,
      date: spin.date.toISOString().split('T')[0],
      device: spin.device,
      os: spin.os,
      browser: spin.browser,
      ipAddress: spin.ipAddress,
      userAgent: spin.userAgent ? spin.userAgent.substring(0, 100) + '...' : 'No user agent',
      hasDeviceFields: {
        device: spin.device !== undefined,
        os: spin.os !== undefined,
        browser: spin.browser !== undefined,
        ipAddress: spin.ipAddress !== undefined,
        userAgent: spin.userAgent !== undefined
      }
    }));
    
    res.json({
      success: true,
      totalRecords: allSpins.length,
      deviceData,
      summary: {
        recordsWithDevice: allSpins.filter(s => s.device && s.device !== 'Unknown').length,
        recordsWithOS: allSpins.filter(s => s.os && s.os !== 'Unknown').length,
        recordsWithUserAgent: allSpins.filter(s => s.userAgent).length,
        recordsWithoutDeviceFields: allSpins.filter(s => !s.device || s.device === 'Unknown').length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Debug endpoint for date filtering
app.get('/api/debug/dates', async (req, res) => {
  try {
    const { dateFilter } = req.query;
    
    if (!dateFilter) {
      return res.json({ error: 'Please provide dateFilter parameter' });
    }
    
    const filterDate = new Date(dateFilter);
    const nextDay = new Date(filterDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const dateQuery = {
      date: { $gte: filterDate, $lt: nextDay }
    };
    
    const allSpins = await Spin.find().sort({ date: -1 });
    const filteredSpins = await Spin.find(dateQuery);
    
    res.json({
      success: true,
      debug: {
        requestedDate: dateFilter,
        filterDate: filterDate.toISOString(),
        nextDay: nextDay.toISOString(),
        dateQuery,
        totalSpinsInDB: allSpins.length,
        filteredSpinsCount: filteredSpins.length,
        allDatesInDB: allSpins.map(s => s.date.toISOString().split('T')[0]).slice(0, 10),
        filteredSpins: filteredSpins.map(s => ({
          username: s.username,
          date: s.date.toISOString(),
          dateOnly: s.date.toISOString().split('T')[0]
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update old records with default IP (admin only)
app.post('/api/admin/update-old-ips', async (req, res) => {
  try {
    // First, let's see what records need updating
    const recordsNeedingUpdate = await Spin.find({
      $or: [
        { ipAddress: { $exists: false } },
        { ipAddress: 'Unknown' },
        { ipAddress: null },
        { ipAddress: '' }
      ]
    });
    
    console.log('Records needing IP update:', recordsNeedingUpdate.length);
    console.log('Sample records:', recordsNeedingUpdate.slice(0, 3).map(r => ({
      username: r.username,
      currentIP: r.ipAddress,
      hasIPField: r.ipAddress !== undefined
    })));
    
    const result = await Spin.updateMany(
      { 
        $or: [
          { ipAddress: { $exists: false } },
          { ipAddress: 'Unknown' },
          { ipAddress: null },
          { ipAddress: '' }
        ]
      },
      { $set: { ipAddress: '192.168.1.100 (legacy)' } }
    );
    
    console.log('Update result:', result);
    
    res.json({
      success: true,
      foundRecords: recordsNeedingUpdate.length,
      updatedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      message: `Found ${recordsNeedingUpdate.length} records, updated ${result.modifiedCount} with legacy IP`
    });
  } catch (err) {
    console.error('Update old IPs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Force update ALL records with sample IPs (for testing)
app.post('/api/admin/force-update-ips', async (req, res) => {
  try {
    const allRecords = await Spin.find();
    let updateCount = 0;
    
    for (let i = 0; i < allRecords.length; i++) {
      const record = allRecords[i];
      const sampleIPs = [
        '192.168.1.100',
        '10.0.0.50',
        '172.16.0.25',
        '203.0.113.10',
        '198.51.100.5'
      ];
      
      const newIP = sampleIPs[i % sampleIPs.length];
      
      await Spin.updateOne(
        { _id: record._id },
        { $set: { ipAddress: newIP } }
      );
      updateCount++;
    }
    
    res.json({
      success: true,
      updatedCount: updateCount,
      message: `Force updated ${updateCount} records with sample IPs`
    });
  } catch (err) {
    console.error('Force update IPs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 MongoDB URI: ${process.env.MONGODB_URI ? 'Configured' : 'Missing'}`);
});

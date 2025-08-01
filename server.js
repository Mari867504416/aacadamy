require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // max requests per IP
});
app.use(limiter);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Models
const Admin = mongoose.model('Admin', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}));

const Officer = mongoose.model('Officer', new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, required: true },
  mobile: { 
    type: String, 
    required: true, 
    unique: true,
    validate: {
      validator: v => /^\d{10}$/.test(v),
      message: props => `${props.value} is not a valid 10-digit mobile number!`
    }
  },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  subscribed: { type: Boolean, default: false },
  transactionId: { 
    type: String,
    validate: {
      validator: v => !v || /^\d{12}$/.test(v),
      message: props => `${props.value} is not a valid 12-digit transaction ID!`
    },
    unique: true,
    sparse: true
  },
  subscriptionDate: { type: Date },
  createdAt: { type: Date, default: Date.now }
}));

const Result = mongoose.model('Result', new mongoose.Schema({
  username: { type: String, required: true },
  name: String,
  phone: String,
  score: Number,
  total: Number,
  date: { type: Date, default: Date.now }
}));

// Initialize Default Admin
async function initializeAdmin() {
  const adminExists = await Admin.exists({ username: 'admin' });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await Admin.create({ username: 'admin', password: hashedPassword });
    console.log('✅ Default admin created (username: admin, password: admin123)');
  }
}

// Routes

// Admin Login
app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });

    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ message: 'Admin login successful' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Officer Login
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const officer = await Officer.findOne({ username });

    if (!officer || !(await bcrypt.compare(password, officer.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const officerData = officer.toObject();
    delete officerData.password;

    res.json({ 
      message: 'Login successful',
      officer: officerData,
      subscribed: officer.subscribed
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Officer Signup
app.post('/signup', async (req, res) => {
  try {
    const { name, address, mobile, username, password } = req.body;

    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ error: 'Invalid mobile number' });
    }

    const existing = await Officer.findOne({ $or: [{ username }, { mobile }] });
    if (existing) {
      return res.status(400).json({ error: 'Username or mobile number already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newOfficer = await Officer.create({
      name, address, mobile, username, password: hashedPassword
    });

    const officerData = newOfficer.toObject();
    delete officerData.password;

    res.json({ message: 'Officer created successfully', officer: officerData });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit Transaction ID
const transactionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many transaction submissions, try again later'
});

app.post('/submit-transaction', transactionLimiter, async (req, res) => {
  try {
    const { transactionId, username } = req.body;

    if (!transactionId || !/^\d{12}$/.test(transactionId)) {
      return res.status(400).json({ error: 'Invalid or missing 12-digit transaction ID' });
    }

    const exists = await Officer.findOne({ transactionId });
    if (exists) {
      return res.status(400).json({ error: 'Transaction ID already used' });
    }

    const officer = await Officer.findOneAndUpdate(
      { username },
      { transactionId, subscriptionDate: new Date(), subscribed: false },
      { new: true }
    );

    if (!officer) return res.status(404).json({ error: 'Officer not found' });

    res.json({ message: 'Transaction submitted successfully', transactionId: officer.transactionId });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Officer Activation Status
app.post('/officer/status', async (req, res) => {
  try {
    const { username } = req.body;
    const officer = await Officer.findOne({ username });

    if (!officer) {
      return res.status(404).json({ error: 'Officer not found' });
    }

    res.json({ activated: officer.subscribed });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Officer Reset Password
app.post('/officer/reset-password', async (req, res) => {
  try {
    const { username, mobile, password } = req.body;
    const officer = await Officer.findOne({ username, mobile });

    if (!officer) {
      return res.status(404).json({ error: 'Officer not found or mobile mismatch' });
    }

    officer.password = await bcrypt.hash(password, 10);
    await officer.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin - Get Officers
app.get('/admin/officers', async (req, res) => {
  try {
    const officers = await Officer.find({}, { password: 0 }).sort({ createdAt: -1 });
    res.json(officers);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin - Activate Subscription
app.post('/admin/activate', async (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId || !/^\d{12}$/.test(transactionId)) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const officer = await Officer.findOne({ transactionId });
    if (!officer) {
      return res.status(404).json({ error: 'Officer not found' });
    }

    if (officer.subscribed) {
      return res.status(400).json({ error: 'Already subscribed' });
    }

    officer.subscribed = true;
    officer.subscriptionDate = new Date();
    await officer.save();

    res.json({ message: 'Subscription activated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin - Reset Admin Password
app.post('/admin/reset-password', async (req, res) => {
  try {
    const { password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await Admin.findOneAndUpdate({ username: 'admin' }, { password: hashedPassword });
    res.json({ message: 'Admin password updated' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit Quiz Result
app.post('/submit-result', async (req, res) => {
  try {
    const { username, name, phone, score, total, date } = req.body;

    if (!username || score == null || total == null) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const result = new Result({
      username,
      name: name || "Unknown",
      phone: phone || "Not Provided",
      score,
      total,
      date: date ? new Date(date) : new Date()
    });

    await result.save();
    res.json({ message: 'Result submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get All Results
app.get('/get-results', async (req, res) => {
  try {
    const results = await Result.find().sort({ date: -1 });
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Initialize admin on server start
initializeAdmin();

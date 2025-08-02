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

// ✅ MongoDB Connection (ONLY ONCE)
const mongoURI = 'mongodb+srv://mariyappan9600:Vkx2CF1f2oBWZQKi@cluster0.hhpsrox.mongodb.net/mydatabase?retryWrites=true&w=majority';

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000
})
.then(() => {
  console.log("✅ Connected to MongoDB");
  initializeAdmin(); // ✅ Only call this AFTER successful connection
})
.catch((err) => {
  console.error("❌ MongoDB connection error:", err);
  process.exit(1); // Optional: stop server on connection failure
});

// ✅ Models
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

// ✅ Initialize Default Admin
async function initializeAdmin() {
  const adminExists = await Admin.exists({ username: 'admin' });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await Admin.create({ username: 'admin', password: hashedPassword });
    console.log('✅ Default admin created (username: admin, password: admin123)');
  }
}

// ... [KEEP ALL YOUR ROUTES UNCHANGED HERE] ...

// ✅ Start Server (ONLY ONCE)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  initializeAdmin(); // Initialize admin AFTER server starts
});

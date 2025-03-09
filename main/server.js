import dotenv from 'dotenv';
dotenv.config({ path: './main/.env' });
import express from 'express';
import cors from 'cors';
import Replicate from 'replicate';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import User from './data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if interface folder is in the current directory or one level up
let frontendPath = path.join(__dirname, 'interface');
if (!fs.existsSync(frontendPath)) {
  frontendPath = path.join(__dirname, '..', 'interface');
}

console.log('Server directory:', __dirname);
console.log('Frontend path:', frontendPath);
console.log('Frontend path exists:', fs.existsSync(frontendPath));

const app = express();
app.use(express.json());
app.use(cors());

// Add request logging
app.use((req, res, next) => {
  console.log(`Request for: ${req.url}`);
  next();
});

// Set up static file serving ONCE
app.use(express.static(frontendPath));
console.log(`Serving static files from: ${frontendPath}`);

console.log('MongoDB URI:', process.env.MONGODB_URI);

if (!process.env.MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is not set!');
  console.error('Please check your .env file or set this environment variable.');
  process.exit(1); // Exit with error
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB!'))
  .catch((error) => console.error('MongoDB connection error:', error));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const REMBG_MODEL_VERSION =
  'cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003';

async function removeBackground(imageUrl) {
  const stream = await replicate.run(REMBG_MODEL_VERSION, { input: { image: imageUrl } });
  return stream;
}

app.post('/users/:id/addItem', async (req, res) => {
  try {
    const userId = req.params.id;
    const { category, imageUrl } = req.body;

    if (!category || !imageUrl) {
      return res.status(400).json({ error: 'Missing category or imageUrl' });
    }

    const { hostname } = new URL(imageUrl);
    const parts = hostname.split('.');
    let brand = parts[0];
    if (brand === 'www' && parts.length > 1) brand = parts[1];

    const timestamp = Date.now();
    const outputFilename = `${brand}_${category}_${timestamp}.png`;

    const imagesDir = path.join(frontendPath, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const outputPath = path.join(imagesDir, outputFilename);
    const bgRemovedStream = await removeBackground(imageUrl);
    await pipeline(bgRemovedStream, fs.createWriteStream(outputPath));

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user[category].push(outputFilename);
    await user.save();

    console.log(`Saved file for '${brand}' in category '${category}' -> ${outputFilename}`);

    return res.json({
      success: true,
      category,
      brand,
      filename: outputFilename,
    });

  } catch (error) {
    console.error('Error processing upload:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/users/:id/items', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      tops: user.tops,
      bottoms: user.bottoms,
      shoes: user.shoes,
      accessories: user.accessories,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/users/findOrCreate', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Look for existing user
    let user = await User.findOne({ email });
    
    // If no user found, create a new one
    if (!user) {
      user = new User({ email });
      await user.save();
    }
    
    return res.json({
      success: true,
      user: {
        _id: user._id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error finding/creating user:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Add a root route to serve landingpage.html
app.get('/', (req, res) => {
  const landingPath = path.join(frontendPath, 'landingpage.html');
  console.log('Serving landing page from:', landingPath);
  console.log('Landing page exists:', fs.existsSync(landingPath));
  
  if (fs.existsSync(landingPath)) {
    res.sendFile(landingPath);
  } else {
    res.status(404).send('Landing page not found. Check server logs for details.');
  }
});

app.get('/signin', (req, res) => {
  res.sendFile(path.join(frontendPath, 'signinpage.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
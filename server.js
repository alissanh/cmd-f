import 'dotenv/config';
import express from 'express';
import Replicate from 'replicate';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import User from './data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

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
    const outputPath = path.join(__dirname, outputFilename);

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

const PORT = 8080;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'landingpage.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

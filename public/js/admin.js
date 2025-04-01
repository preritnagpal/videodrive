// admin.js - Dual Storage Version
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Configuration
const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'videoDB';
const JSON_PATH = path.join(__dirname, 'storage', 'videos.json');

// Initialize storage
!fs.existsSync(path.dirname(JSON_PATH)) && fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });
!fs.existsSync(JSON_PATH) && fs.writeFileSync(JSON_PATH, '{}');

// Connection handling
let db;
(async function connectDB() {
  try {
    if (!DB_URI.includes('localhost')) { // Only connect if not local
      const client = new MongoClient(DB_URI);
      await client.connect();
      db = client.db(DB_NAME);
      console.log('✅ MongoDB Connected');
    }
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
  }
})();

// Dual Storage Operations
const videoStore = {
  // Get all videos (combines both sources)
  async getAll() {
    const videos = {};
    
    // From MongoDB
    if (db) {
      try {
        (await db.collection('videos').find().toArray()).forEach(v => {
          videos[v.number] = { driveId: v.driveId, name: v.name };
        });
      } catch (err) {
        console.error('MongoDB Read Error:', err);
      }
    }
    
    // From JSON (won't overwrite MongoDB entries)
    try {
      const jsonVideos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      Object.entries(jsonVideos).forEach(([number, data]) => {
        if (!videos[number]) videos[number] = data;
      });
    } catch (err) {
      console.error('JSON Read Error:', err);
    }
    
    return videos;
  },

  // Add video to both stores
  async add(videoData) {
    const { number, driveId, name } = videoData;
    
    // MongoDB
    if (db) {
      try {
        await db.collection('videos').updateOne(
          { number },
          { $set: { driveId, name, updatedAt: new Date() } },
          { upsert: true }
        );
      } catch (err) {
        console.error('MongoDB Write Error:', err);
      }
    }
    
    // JSON
    try {
      const videos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      videos[number] = { driveId, name };
      fs.writeFileSync(JSON_PATH, JSON.stringify(videos, null, 2));
    } catch (err) {
      console.error('JSON Write Error:', err);
    }
  },

  // Delete from both stores
  async delete(videoId) {
    // MongoDB
    if (db) {
      try {
        await db.collection('videos').deleteOne({ 
          $or: [
            { number: videoId },
            { driveId: videoId }
          ]
        });
      } catch (err) {
        console.error('MongoDB Delete Error:', err);
      }
    }
    
    // JSON
    try {
      const videos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      if (videos[videoId]) {
        delete videos[videoId];
      } else {
        // Search by driveId if number not found
        for (const [number, data] of Object.entries(videos)) {
          if (data.driveId === videoId) {
            delete videos[number];
            break;
          }
        }
      }
      fs.writeFileSync(JSON_PATH, JSON.stringify(videos, null, 2));
    } catch (err) {
      console.error('JSON Delete Error:', err);
    }
  }
};

// Keep your existing WebSocket and auth state logic
module.exports = {
  ...videoStore,
  // Export existing functions you need
  checkDriveStatus,
  handleDriveOperation,
  initWebSocket
};

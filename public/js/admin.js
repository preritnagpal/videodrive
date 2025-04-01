// admin.js - Enhanced Dual Storage Version
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Configuration
const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'videoDB';
const JSON_PATH = path.join(__dirname, 'storage', 'videos.json');

// Initialize storage directory
if (!fs.existsSync(path.dirname(JSON_PATH))) {
  fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });
}
if (!fs.existsSync(JSON_PATH)) {
  fs.writeFileSync(JSON_PATH, '{}');
}

// Enhanced DB Connection with reconnect
let db;
let mongoClient;

async function connectDB() {
  try {
    if (!DB_URI.includes('localhost')) {
      mongoClient = new MongoClient(DB_URI, {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 30000,
        serverSelectionTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true
      });
      
      await mongoClient.connect();
      db = mongoClient.db(DB_NAME);
      await db.command({ ping: 1 });
      console.log('✅ MongoDB Connected');
      
      // Create indexes if they don't exist
      await db.collection('videos').createIndex({ number: 1 }, { unique: true });
      await db.collection('videos').createIndex({ driveId: 1 });
    }
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    // Auto-reconnect after 5 seconds
    setTimeout(connectDB, 5000);
  }
}

// Initialize connection
connectDB();

// Enhanced Video Store with additional metadata
const videoStore = {
  async getAll() {
    const videos = {};
    
    // Try MongoDB first
    if (db) {
      try {
        const mongoVideos = await db.collection('videos')
          .find()
          .sort({ createdAt: -1 }) // Newest first
          .toArray();
          
        mongoVideos.forEach(v => {
          videos[v.number] = { 
            driveId: v.driveId, 
            name: v.name,
            createdAt: v.createdAt,
            size: v.size,
            views: v.views || 0
          };
        });
      } catch (err) {
        console.error('MongoDB Read Error:', err);
      }
    }
    
    // Fallback to JSON
    try {
      const jsonVideos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      Object.entries(jsonVideos).forEach(([number, data]) => {
        if (!videos[number]) {
          videos[number] = {
            ...data,
            createdAt: data.createdAt || new Date().toISOString()
          };
        }
      });
    } catch (err) {
      console.error('JSON Read Error:', err);
    }
    
    return videos;
  },

  async add(videoData) {
    const { number, driveId, name, size = 0 } = videoData;
    const now = new Date();
    
    // MongoDB
    if (db) {
      try {
        await db.collection('videos').updateOne(
          { number },
          { 
            $set: { 
              driveId, 
              name, 
              size,
              updatedAt: now 
            },
            $setOnInsert: {
              createdAt: now,
              views: 0
            }
          },
          { upsert: true }
        );
      } catch (err) {
        console.error('MongoDB Write Error:', err);
      }
    }
    
    // JSON
    try {
      const videos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      videos[number] = { 
        driveId, 
        name,
        size,
        createdAt: now.toISOString()
      };
      fs.writeFileSync(JSON_PATH, JSON.stringify(videos, null, 2));
    } catch (err) {
      console.error('JSON Write Error:', err);
    }
  },

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
  },

  // New: Increment view count
  async incrementViews(videoId) {
    if (db) {
      try {
        await db.collection('videos').updateOne(
          { $or: [{ number: videoId }, { driveId: videoId }] },
          { $inc: { views: 1 } }
        );
      } catch (err) {
        console.error('MongoDB View Increment Error:', err);
      }
    }
  }
};

// Google Drive Status Check
async function checkDriveStatus(authClient) {
  try {
    const drive = google.drive({ version: 'v3', auth: authClient });
    await drive.about.get({ fields: 'user' });
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = {
  ...videoStore,
  checkDriveStatus,
  connectDB, // Export for health checks
  closeDB: async () => {
    if (mongoClient) await mongoClient.close();
  }
};

require('dotenv').config();
const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const WebSocket = require('ws');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// MongoDB Configuration with SSL fix
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'videoDB';
let dbClient;

async function initMongoDB() {
  try {
    if (MONGODB_URI) {
      const client = new MongoClient(MONGODB_URI, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true
      });

      await client.connect();
      dbClient = client.db(DB_NAME);
      
      // Verify connection
      await client.db("admin").command({ ping: 1 });
      console.log("✅ MongoDB Connected");
      
      // Create indexes
      await dbClient.collection('videos').createIndex({ number: 1 }, { unique: true });
      await dbClient.collection('videos').createIndex({ driveId: 1 });
    } else {
      console.log('⚠️ MongoDB URI not configured - using JSON fallback');
    }
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    setTimeout(initMongoDB, 5000);
  }
}
}

// Dual Storage Video Lookup
async function getVideo(identifier) {
  // Check if it's a direct Drive ID
  if (/^[a-zA-Z0-9_-]{28,}$/.test(identifier)) {
    return { driveId: identifier, isDirect: true };
  }

  // Try MongoDB first if available
  if (dbClient) {
    try {
      const video = await dbClient.collection('videos').findOne({
        $or: [
          { number: identifier },
          { driveId: identifier }
        ]
      });
      if (video) return video;
    } catch (err) {
      console.error('MongoDB lookup error:', err);
    }
  }

  // Fall back to JSON file
  const videosFilePath = path.join(__dirname, 'public', 'videos.json');
  if (fs.existsSync(videosFilePath)) {
    try {
      const videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
      
      // Check by number
      if (videos[identifier]) {
        return { 
          driveId: videos[identifier].driveId,
          name: videos[identifier].name 
        };
      }
      
      // Check by driveId
      for (const [number, data] of Object.entries(videos)) {
        if (data.driveId === identifier) {
          return { driveId: data.driveId, name: data.name };
        }
      }
    } catch (err) {
      console.error('JSON file read error:', err);
    }
  }

  return null;
}

// Middleware Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
    },
  })
);

// Google OAuth Setup
const oAuth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Auth Middleware
const requireAuth = (req, res, next) => {
  if (!req.session.authenticated) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
};

// Token Management Middleware
app.use(async (req, res, next) => {
  if (req.session.tokens) {
    try {
      oAuth2Client.setCredentials(req.session.tokens);
      
      if (oAuth2Client.isTokenExpiring()) {
        const { credentials } = await oAuth2Client.refreshAccessToken();
        req.session.tokens = credentials;
        oAuth2Client.setCredentials(credentials);
        console.log('Google Drive token refreshed');
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      req.session.tokens = null;
      req.session.driveConnected = false;
    }
  }
  next();
});

// WebSocket Setup
const server = app.listen(process.env.PORT || 3000, async () => {
  await initMongoDB();
  console.log(`🚀 Server running on http://localhost:${process.env.PORT || 3000}`);
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Enhanced broadcast function for dual storage
async function broadcastVideosUpdate() {
  try {
    let videoList = [];
    
    // Get from MongoDB if available
    if (dbClient) {
      try {
        const mongoVideos = await dbClient.collection('videos').find().toArray();
        videoList = mongoVideos.map(video => ({
          number: video.number,
          id: video.driveId,
          name: video.name,
          link: `${process.env.BASE_URL || 'https://sexydrive.koyeb.app'}/?video=${video.number}`
        }));
      } catch (err) {
        console.error('MongoDB broadcast error:', err);
      }
    }
    
    // Fall back to JSON if MongoDB not available or empty
    if (videoList.length === 0) {
      const videosFilePath = path.join(__dirname, 'public', 'videos.json');
      if (fs.existsSync(videosFilePath)) {
        const videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
        videoList = Object.entries(videos).map(([number, data]) => ({
          number,
          id: data.driveId,
          name: data.name,
          link: `${process.env.BASE_URL || 'https://sexydrive.koyeb.app'}/?video=${number}`
        }));
      }
    }
    
    // Broadcast to all clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'videos_updated',
          videos: videoList
        }));
      }
    });
  } catch (error) {
    console.error('Broadcast error:', error);
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/get-video/:identifier', async (req, res) => {
  try {
    const video = await getVideo(req.params.identifier);
    
    if (video) {
      return res.json({ 
        success: true, 
        videoId: video.driveId,
        isDirect: video.isDirect || false
      });
    }
    
    res.status(404).json({ success: false, error: 'Video not found' });
  } catch (err) {
    console.error('Video lookup error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.user = { username };
    return res.redirect(req.session.returnTo || '/admin');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/auth/google', requireAuth, (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    prompt: 'consent',
  });
  res.redirect(authUrl);
});

app.get('/auth/google/callback', requireAuth, async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) throw new Error('Authorization code missing');

    const { tokens } = await oAuth2Client.getToken(code);
    req.session.tokens = tokens;
    req.session.driveConnected = true;

    res.redirect('/admin');
  } catch (err) {
    console.error('Auth callback error:', err);
    res.redirect('/admin?auth_error=1');
  }
});

app.get('/auth/status', requireAuth, (req, res) => {
  res.json({
    connected: !!req.session.tokens,
    clientIdConfigured: !!process.env.GOOGLE_CLIENT_ID,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    mongoConnected: !!dbClient
  });
});

function generateRandomNumber(min = 1000, max = 9999) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

app.post('/upload', requireAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Google Drive not connected',
        reconnect: true
      });
    }

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file selected' 
      });
    }

    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    // Upload to Drive
    const driveResponse = await drive.files.create({
      requestBody: {
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: req.file.mimetype,
        body: require('stream').Readable.from(req.file.buffer),
      },
    });

    const fileId = driveResponse.data.id;

    // Set public permissions
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    // Generate a unique random number
    const randomNumber = generateRandomNumber();
    
    // Store in both MongoDB and JSON
    const videoData = {
      number: randomNumber,
      driveId: fileId,
      name: req.file.originalname,
      createdAt: new Date()
    };

    // Save to MongoDB
    if (dbClient) {
      try {
        await dbClient.collection('videos').insertOne(videoData);
      } catch (err) {
        console.error('MongoDB insert error:', err);
      }
    }

    // Save to JSON
    const videosFilePath = path.join(__dirname, 'public', 'videos.json');
    let videos = {};
    if (fs.existsSync(videosFilePath)) {
      videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
    }
    videos[randomNumber] = {
      driveId: fileId,
      name: req.file.originalname
    };
    fs.writeFileSync(videosFilePath, JSON.stringify(videos, null, 2));

    // Broadcast update
    broadcastVideosUpdate();

    res.json({
      success: true,
      link: `${process.env.BASE_URL || 'https://sexydrive.koyeb.app'}/?video=${randomNumber}`,
      id: fileId,
      number: randomNumber,
      name: req.file.originalname,
      storedIn: dbClient ? ['mongodb', 'json'] : ['json']
    });

  } catch (error) {
    console.error('Upload error:', error);
    const needsReconnect = error.message.includes('invalid_grant') || 
                         error.message.includes('token expired');
    
    res.status(500).json({ 
      success: false, 
      error: 'Upload failed',
      reconnect: needsReconnect,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/admin/videos', requireAuth, async (req, res) => {
  try {
    let videoList = [];
    
    // Try MongoDB first
    if (dbClient) {
      try {
        const mongoVideos = await dbClient.collection('videos').find().sort({ createdAt: -1 }).toArray();
        videoList = mongoVideos.map(video => ({
          number: video.number,
          id: video.driveId,
          name: video.name,
          link: `${process.env.BASE_URL || 'https://sexydrive.koyeb.app'}/?video=${video.number}`,
          driveLink: `https://drive.google.com/file/d/${video.driveId}/view`,
          source: 'mongodb'
        }));
      } catch (err) {
        console.error('MongoDB query error:', err);
      }
    }
    
    // Fall back to JSON if needed
    if (videoList.length === 0) {
      const videosFilePath = path.join(__dirname, 'public', 'videos.json');
      if (fs.existsSync(videosFilePath)) {
        const videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
        videoList = Object.entries(videos).map(([number, data]) => ({
          number,
          id: data.driveId,
          name: data.name,
          link: `${process.env.BASE_URL || 'https://sexydrive.koyeb.app'}/?video=${number}`,
          driveLink: `https://drive.google.com/file/d/${data.driveId}/view`,
          source: 'json'
        }));
      }
    }
    
    res.json({ 
      success: true, 
      videos: videoList 
    });
  } catch (error) {
    console.error('Error loading videos:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading video list',
      videos: []
    });
  }
});

app.delete('/delete-video/:videoId', requireAuth, async (req, res) => {
  const videoId = req.params.videoId;

  try {
    if (!req.session.tokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Google Drive not connected',
        reconnect: true
      });
    }

    // Delete from Google Drive
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    await drive.files.delete({ fileId: videoId });

    // Delete from MongoDB
    let deletedNumber = null;
    if (dbClient) {
      try {
        const result = await dbClient.collection('videos').findOneAndDelete({ 
          $or: [
            { number: videoId },
            { driveId: videoId }
          ]
        });
        if (result.value) deletedNumber = result.value.number;
      } catch (err) {
        console.error('MongoDB delete error:', err);
      }
    }

    // Delete from JSON
    const videosFilePath = path.join(__dirname, 'public', 'videos.json');
    if (fs.existsSync(videosFilePath)) {
      try {
        const videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
        
        // If we don't know the number from MongoDB, find it
        if (!deletedNumber) {
          for (const [number, data] of Object.entries(videos)) {
            if (data.driveId === videoId) {
              deletedNumber = number;
              break;
            }
          }
        }
        
        if (deletedNumber && videos[deletedNumber]) {
          delete videos[deletedNumber];
          fs.writeFileSync(videosFilePath, JSON.stringify(videos, null, 2));
        }
      } catch (err) {
        console.error('JSON delete error:', err);
      }
    }

    // Broadcast update
    broadcastVideosUpdate();

    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    const needsReconnect = error.message.includes('invalid_grant') || 
                         error.message.includes('token expired');
    
    res.status(500).json({ 
      success: false, 
      error: 'Error deleting video',
      reconnect: needsReconnect,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/migrate-legacy', requireAuth, async (req, res) => {
  if (!dbClient) {
    return res.status(400).json({ success: false, error: 'MongoDB not connected' });
  }

  try {
    const legacyVideos = req.body.videos || [];
    const results = await dbClient.collection('videos').bulkWrite(
      legacyVideos.map(video => ({
        updateOne: {
          filter: { number: video.number },
          update: {
            $set: {
              driveId: video.driveId,
              name: video.name || `Legacy Video ${video.number}`,
              updatedAt: new Date()
            },
            $setOnInsert: {
              createdAt: new Date()
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );

    // Also update JSON file
    const videosFilePath = path.join(__dirname, 'public', 'videos.json');
    let videos = {};
    if (fs.existsSync(videosFilePath)) {
      videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
    }
    legacyVideos.forEach(video => {
      videos[video.number] = { driveId: video.driveId, name: video.name };
    });
    fs.writeFileSync(videosFilePath, JSON.stringify(videos, null, 2));

    broadcastVideosUpdate();

    res.json({ 
      success: true,
      inserted: results.upsertedCount,
      modified: results.modifiedCount
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  if (dbClient) {
    await dbClient.client.close();
    console.log('MongoDB connection closed');
  }
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
});

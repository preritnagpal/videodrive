require('dotenv').config();
const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Verify required environment variables
const requiredEnvVars = [
  'SESSION_SECRET',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GOOGLE_DRIVE_FOLDER_ID',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL ERROR: ${envVar} is not defined in .env file`);
    process.exit(1);
  }
}

app.get('/get-video/:number', (req, res) => {
  const videoNumber = req.params.number;
  console.log(`Requested Video Number: ${videoNumber}`); // Debug

  const videosFilePath = path.join(__dirname, 'public', 'videos.json');

  // Check if videos.json exists
  if (fs.existsSync(videosFilePath)) {
    const videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
    const video = videos[videoNumber];

    // If video exists, return videoId
    if (video) {
      console.log(`Found Video: ${video.driveId}`); // Debug
      return res.json({ success: true, videoId: video.driveId });
    }
  }

  // If video not found
  res.status(404).json({ success: false, error: 'Video not found' });
});

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
      
      // Refresh token if expiring soon (within 5 minutes)
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
const server = app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on http://localhost:${process.env.PORT || 3000}`);
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

function broadcastVideosUpdate() {
  const videosFilePath = path.join(__dirname, 'public', 'videos.json');
  if (!fs.existsSync(videosFilePath)) return;

  try {
    const videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
    const videoList = Object.entries(videos).map(([number, data]) => ({
      number,
      id: data.driveId,
      name: data.name,
      link: `${process.env.BASE_URL || 'https://sexydrive.koyeb.app'}/?video=${number}`
    }));

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'videos_updated',
          videos: videoList
        }));
      }
    });
  } catch (error) {
    console.error('Error broadcasting video update:', error);
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin Login
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

// Google OAuth Routes
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
  });
});

// File Upload with Enhanced Error Handling
// Helper function to generate random number
function generateRandomNumber(min = 1000, max = 9999) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// File Upload with Enhanced Error Handling
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

    // Update videos.json
    const videosFilePath = path.join(__dirname, 'public', 'videos.json');
    let videos = {};
    
    if (fs.existsSync(videosFilePath)) {
      videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
    }

    // Generate a unique random number
    let randomNumber;
    do {
      randomNumber = generateRandomNumber();
    } while (videos[randomNumber]); // Ensure the number is unique

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
      name: req.file.originalname
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

// Video Management
app.get('/admin/videos', requireAuth, (req, res) => {
  const videosFilePath = path.join(__dirname, 'public', 'videos.json');

  try {
    let videos = {};
    
    if (fs.existsSync(videosFilePath)) {
      const fileContent = fs.readFileSync(videosFilePath, 'utf8');
      videos = fileContent ? JSON.parse(fileContent) : {};
    }

    const videoList = Object.entries(videos).map(([number, data]) => ({
      number,
      id: data.driveId,
      name: data.name,
      link: `${process.env.BASE_URL || 'https://sexydrive.koyeb.app'}/?video=${number}`,
      driveLink: `https://drive.google.com/file/d/${data.driveId}/view`
    }));

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

// Delete Video with Enhanced Error Handling
app.delete('/delete-video/:videoId', requireAuth, async (req, res) => {
  const videoId = req.params.videoId;
  const videosFilePath = path.join(__dirname, 'public', 'videos.json');

  try {
    if (!req.session.tokens) {
      return res.status(401).json({ 
        success: false, 
        error: 'Google Drive not connected',
        reconnect: true
      });
    }

    if (!fs.existsSync(videosFilePath)) {
      return res.status(404).json({ success: false, error: "No videos found" });
    }

    const videos = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'));
    const videoNumber = Object.keys(videos).find(key => videos[key].driveId === videoId);

    if (!videoNumber) {
      return res.status(404).json({ success: false, error: "Video not found" });
    }

    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    await drive.files.delete({ fileId: videoId });

    delete videos[videoNumber];
    fs.writeFileSync(videosFilePath, JSON.stringify(videos, null, 2));

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

// Admin Panel
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || '8trax-secret-key-2024';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure directories exist
const dirs = ['uploads/beats', 'uploads/vocals', 'uploads/mixes', 'uploads/temp', 'data'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Initialize data files
const initializeDataFiles = () => {
  const files = ['users.json', 'beats.json', 'votes.json', 'follows.json', 'comments.json', 'messages.json'];
  files.forEach(file => {
    const filePath = path.join(__dirname, 'data', file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([]));
    }
  });
};
initializeDataFiles();

// Helper functions
const readData = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', file), 'utf8'));
  } catch (error) {
    return [];
  }
};

const writeData = (file, data) => {
  fs.writeFileSync(path.join(__dirname, 'data', file), JSON.stringify(data, null, 2));
};

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'beat') {
      cb(null, path.join(__dirname, 'uploads/beats'));
    } else if (file.fieldname === 'vocal') {
      cb(null, path.join(__dirname, 'uploads/vocals'));
    } else if (file.fieldname === 'mix') {
      cb(null, path.join(__dirname, 'uploads/mixes'));
    } else if (file.fieldname === 'chunk') {
      cb(null, path.join(__dirname, 'uploads/temp'));
    } else {
      cb(null, path.join(__dirname, 'uploads/vocals'));
    }
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// Auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ================== SOCKET.IO ==================
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('sendMessage', (data) => {
    const messages = readData('messages.json');
    const newMessage = {
      id: uuidv4(),
      from: data.from,
      fromName: data.fromName,
      to: data.to,
      message: data.message,
      timestamp: new Date().toISOString(),
      read: false
    };
    messages.push(newMessage);
    writeData('messages.json', messages);
    io.emit('newMessage', newMessage);
  });
  
  socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

// ================== UPLOAD STATUS ROUTES ==================
const uploadSessions = new Map();

app.post('/api/upload/start', authenticate, (req, res) => {
  const sessionId = uuidv4();
  const { fileName, fileSize, type } = req.body;
  
  uploadSessions.set(sessionId, {
    userId: req.user.id,
    fileName,
    fileSize,
    type,
    status: 'starting',
    progress: 0,
    uploadedBytes: 0,
    startTime: new Date().toISOString(),
    chunks: []
  });
  
  res.json({ sessionId, message: 'Upload session started' });
});

app.post('/api/upload/chunk', authenticate, upload.single('chunk'), (req, res) => {
  try {
    const { sessionId, chunkIndex, totalChunks } = req.body;
    const session = uploadSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found' });
    }
    
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const chunkSize = req.file.size;
    session.uploadedBytes += chunkSize;
    session.progress = (session.uploadedBytes / session.fileSize) * 100;
    session.status = 'uploading';
    
    if (!session.chunks) session.chunks = [];
    session.chunks[chunkIndex] = {
      path: req.file.path,
      size: chunkSize,
      index: parseInt(chunkIndex)
    };
    
    io.emit('uploadProgress', {
      sessionId,
      progress: session.progress,
      uploadedBytes: session.uploadedBytes,
      totalBytes: session.fileSize
    });
    
    res.json({
      success: true,
      progress: session.progress,
      chunkIndex: parseInt(chunkIndex),
      totalChunks: parseInt(totalChunks)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/upload/complete', authenticate, async (req, res) => {
  try {
    const { sessionId, title, genre, bpm, description, tags } = req.body;
    const session = uploadSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found' });
    }
    
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    session.status = 'assembling';
    
    const sortedChunks = session.chunks.sort((a, b) => a.index - b.index);
    const buffers = [];
    
    for (const chunk of sortedChunks) {
      if (chunk && chunk.path && fs.existsSync(chunk.path)) {
        const chunkBuffer = fs.readFileSync(chunk.path);
        buffers.push(chunkBuffer);
      }
    }
    
    const completeBuffer = Buffer.concat(buffers);
    const fileExtension = path.extname(session.fileName);
    const filename = `${uuidv4()}${fileExtension}`;
    const uploadPath = path.join(__dirname, 'uploads/beats', filename);
    fs.writeFileSync(uploadPath, completeBuffer);
    const fileUrl = `/uploads/beats/${filename}`;
    
    const users = readData('users.json');
    const user = users.find(u => u.id === req.user.id);
    const beats = readData('beats.json');
    
    const newBeat = {
      id: uuidv4(),
      title,
      genre: genre || 'Other',
      bpm: parseInt(bpm) || 120,
      description: description || "",
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      producerId: req.user.id,
      producerName: user.displayName || user.username,
      producerUsername: user.username,
      fileUrl,
      filename,
      createdAt: new Date().toISOString(),
      plays: 0,
      downloads: 0,
      rating: 0,
      versions: []
    };
    
    beats.push(newBeat);
    writeData('beats.json', beats);
    
    if (!user.uploadedBeats) user.uploadedBeats = [];
    user.uploadedBeats.push(newBeat.id);
    writeData('users.json', users);
    
    for (const chunk of session.chunks) {
      if (chunk && chunk.path && fs.existsSync(chunk.path)) {
        fs.unlinkSync(chunk.path);
      }
    }
    
    uploadSessions.delete(sessionId);
    
    io.emit('uploadComplete', { sessionId, result: newBeat, type: session.type });
    
    res.json({ success: true, result: newBeat });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/upload/:sessionId', authenticate, (req, res) => {
  const session = uploadSessions.get(req.params.sessionId);
  
  if (session && session.userId === req.user.id) {
    if (session.chunks) {
      for (const chunk of session.chunks) {
        if (chunk && chunk.path && fs.existsSync(chunk.path)) {
          fs.unlinkSync(chunk.path);
        }
      }
    }
    uploadSessions.delete(req.params.sessionId);
    io.emit('uploadCancelled', { sessionId: req.params.sessionId });
    res.json({ success: true, message: 'Upload cancelled' });
  } else {
    res.status(404).json({ error: 'Upload session not found' });
  }
});

app.get('/api/upload/history', authenticate, (req, res) => {
  try {
    const beats = readData('beats.json');
    const uploadHistory = {
      beats: beats.filter(b => b.producerId === req.user.id).map(b => ({
        id: b.id,
        title: b.title,
        fileUrl: b.fileUrl,
        createdAt: b.createdAt,
        plays: b.plays,
        downloads: b.downloads,
        type: 'beat'
      }))
    };
    
    uploadHistory.beats.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(uploadHistory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== AUTH ROUTES ==================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, displayName, bio } = req.body;
    const users = readData('users.json');
    
    if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email exists' });
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username taken' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      username,
      email,
      displayName: displayName || username,
      bio: bio || "",
      password: hashedPassword,
      createdAt: new Date().toISOString(),
      points: 0,
      uploadedBeats: [],
      recordings: [],
      library: [],
      followers: [],
      following: [],
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=667eea&color=fff`
    };
    
    users.push(newUser);
    writeData('users.json', users);
    
    const token = jwt.sign({ id: newUser.id, username: newUser.username, displayName: newUser.displayName }, SECRET_KEY);
    const { password: _, ...userWithoutPassword } = newUser;
    res.json({ token, user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = readData('users.json');
    const user = users.find(u => u.email === email);
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username, displayName: user.displayName }, SECRET_KEY);
    const { password: _, ...userWithoutPassword } = user;
    res.json({ token, user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const users = readData('users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

// ==================== LIBRARY ROUTES ====================
app.post('/api/library/add', authenticate, (req, res) => {
  try {
    const { beatId } = req.body;
    const users = readData('users.json');
    const user = users.find(u => u.id === req.user.id);
    
    if (!user.library) user.library = [];
    if (user.library.includes(beatId)) return res.status(400).json({ error: 'Already in library' });
    
    user.library.push(beatId);
    writeData('users.json', users);
    res.json({ message: 'Added to library', library: user.library });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/library/remove', authenticate, (req, res) => {
  try {
    const { beatId } = req.body;
    const users = readData('users.json');
    const user = users.find(u => u.id === req.user.id);
    
    user.library = user.library.filter(id => id !== beatId);
    writeData('users.json', users);
    res.json({ message: 'Removed from library', library: user.library });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/library', authenticate, (req, res) => {
  try {
    const users = readData('users.json');
    const beats = readData('beats.json');
    const user = users.find(u => u.id === req.user.id);
    const libraryBeats = beats.filter(beat => user.library?.includes(beat.id));
    res.json(libraryBeats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== BEAT ROUTES ==================
app.get('/api/beats', (req, res) => {
  try {
    let beats = readData('beats.json');
    const { sort, genre, limit = 50 } = req.query;
    
    if (genre && genre != 'all') {
      beats = beats.filter(b => b.genre === genre);
    }
    if (sort === 'popular') {
      beats.sort((a, b) => (b.plays + b.downloads) - (a.plays + a.downloads));
    } else {
      beats.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    
    res.json(beats.slice(0, parseInt(limit)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/beats/:id', (req, res) => {
  try {
    const beats = readData('beats.json');
    const beat = beats.find(b => b.id === req.params.id);
    if (!beat) return res.status(404).json({ error: 'Beat not found' });
    
    beat.plays++;
    writeData('beats.json', beats);
    res.json(beat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard', (req, res) => {
  try {
    const users = readData('users.json');
    const topUsers = users.sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 20).map(user => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      points: user.points || 0,
      uploadedBeats: user.uploadedBeats?.length || 0,
      followers: user.followers?.length || 0,
      bio: user.bio || ""
    }));
    res.json(topUsers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trending', (req, res) => {
  try {
    const beats = readData('beats.json');
    const trending = beats.filter(b => (b.plays + b.downloads) > 5).slice(0, 30);
    res.json(trending);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/feed', authenticate, (req, res) => {
  try {
    const beats = readData('beats.json');
    const feedItems = beats.slice(0, 50).map(beat => ({
      type: 'beat',
      ...beat,
      timestamp: beat.createdAt
    }));
    res.json(feedItems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:username', (req, res) => {
  try {
    const users = readData('users.json');
    const beats = readData('beats.json');
    const user = users.find(u => u.username === req.params.username);
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const userBeats = beats.filter(b => b.producerId === user.id);
    const { password, ...userWithoutPassword } = user;
    res.json({ 
      ...userWithoutPassword, 
      uploadedBeatsCount: userBeats.length,
      uploadedBeats: userBeats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`\n🎵 8Trax Server running on http://localhost:${PORT}`);
  console.log(`📁 Uploads: ${path.join(__dirname, 'uploads')}`);
  console.log(`💾 Data: ${path.join(__dirname, 'data')}\n`);
});
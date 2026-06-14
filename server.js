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
const dirs = ['uploads/beats', 'uploads/vocals', 'uploads/mixes', 'data'];
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

// Ensure temp directory for chunks
const tempDir = path.join(__dirname, 'uploads/temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

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

// Start upload session
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

// Upload chunk
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
    
    // Emit progress via socket
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

// Complete upload and assemble file
app.post('/api/upload/complete', authenticate, async (req, res) => {
  try {
    const { sessionId, title, genre, bpm, description, tags, beatId, versionId } = req.body;
    const session = uploadSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found' });
    }
    
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    session.status = 'assembling';
    
    // Sort chunks by index
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
    let fileUrl = '';
    let result = null;
    
    // Determine upload type and save file
    if (session.type === 'beat') {
      const uploadPath = path.join(__dirname, 'uploads/beats', filename);
      fs.writeFileSync(uploadPath, completeBuffer);
      fileUrl = `/uploads/beats/${filename}`;
      
      // Create beat
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
      
      result = newBeat;
      
    } else if (session.type === 'vocal') {
      const uploadPath = path.join(__dirname, 'uploads/vocals', filename);
      fs.writeFileSync(uploadPath, completeBuffer);
      fileUrl = `/uploads/vocals/${filename}`;
      
      // Create recording
      const beats = readData('beats.json');
      const users = readData('users.json');
      const beatIndex = beats.findIndex(b => b.id === beatId);
      
      if (beatIndex !== -1) {
        const user = users.find(u => u.id === req.user.id);
        const beat = beats[beatIndex];
        
        const newVersion = {
          id: uuidv4(),
          beatId: beatId,
          beatTitle: beat.title,
          vocalistId: req.user.id,
          vocalistName: user.displayName || user.username,
          vocalistUsername: user.username,
          title: title || `${user.displayName}'s version`,
          description: description || "",
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          fileUrl,
          filename,
          createdAt: new Date().toISOString(),
          votes: [],
          rating: 0,
          plays: 0,
          isFork: false
        };
        
        beat.versions.push(newVersion);
        writeData('beats.json', beats);
        
        if (!user.recordings) user.recordings = [];
        user.recordings.push(newVersion.id);
        writeData('users.json', users);
        
        result = newVersion;
      }
    } else if (session.type === 'mix') {
      const uploadPath = path.join(__dirname, 'uploads/mixes', filename);
      fs.writeFileSync(uploadPath, completeBuffer);
      fileUrl = `/uploads/mixes/${filename}`;
      
      // Save mix for fork
      const beats = readData('beats.json');
      
      for (const beat of beats) {
        const versionIndex = beat.versions.findIndex(v => v.id === versionId);
        if (versionIndex !== -1) {
          beat.versions[versionIndex].fileUrl = fileUrl;
          beat.versions[versionIndex].mixFile = filename;
          writeData('beats.json', beats);
          result = { success: true, fileUrl };
          break;
        }
      }
    }
    
    // Clean up chunk files
    for (const chunk of session.chunks) {
      if (chunk && chunk.path && fs.existsSync(chunk.path)) {
        fs.unlinkSync(chunk.path);
      }
    }
    
    uploadSessions.delete(sessionId);
    
    io.emit('uploadComplete', {
      sessionId,
      result,
      type: session.type
    });
    
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get upload status
app.get('/api/upload/status/:sessionId', authenticate, (req, res) => {
  const session = uploadSessions.get(req.params.sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Upload session not found' });
  }
  
  if (session.userId !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  res.json({
    sessionId: req.params.sessionId,
    status: session.status,
    progress: session.progress,
    uploadedBytes: session.uploadedBytes,
    totalBytes: session.fileSize,
    fileName: session.fileName,
    startTime: session.startTime
  });
});

// Cancel upload
app.delete('/api/upload/:sessionId', authenticate, (req, res) => {
  const session = uploadSessions.get(req.params.sessionId);
  
  if (session && session.userId === req.user.id) {
    // Clean up chunk files
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

// Get user's upload history
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
      })),
      recordings: []
    };
    
    beats.forEach(beat => {
      beat.versions.forEach(version => {
        if (version.vocalistId === req.user.id) {
          uploadHistory.recordings.push({
            id: version.id,
            title: version.title,
            beatId: beat.id,
            beatTitle: beat.title,
            fileUrl: version.fileUrl,
            createdAt: version.createdAt,
            plays: version.plays,
            rating: version.rating,
            type: 'recording',
            isFork: version.isFork || false
          });
        }
      });
    });
    
    // Sort by date
    uploadHistory.beats.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    uploadHistory.recordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
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

// ===================== COMMENT ROUTES =====================
app.post('/api/comments/add', authenticate, (req, res) => {
  try {
    const { beatId, comment } = req.body;
    const comments = readData('comments.json');
    const users = readData('users.json');
    const user = users.find(u => u.id === req.user.id);
    
    const newComment = {
      id: uuidv4(),
      beatId,
      userId: req.user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      comment,
      createdAt: new Date().toISOString(),
      likes: []
    };
    
    comments.push(newComment);
    writeData('comments.json', comments);
    res.json(newComment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/comments/:beatId', (req, res) => {
  try {
    const comments = readData('comments.json');
    const beatComments = comments.filter(c => c.beatId === req.params.beatId);
    res.json(beatComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/comments/like', authenticate, (req, res) => {
  try {
    const { commentId } = req.body;
    let comments = readData('comments.json');
    const comment = comments.find(c => c.id === commentId);
    
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    if (comment.likes.includes(req.user.id)) {
      comment.likes = comment.likes.filter(id => id !== req.user.id);
    } else {
      comment.likes.push(req.user.id);
    }
    
    writeData('comments.json', comments);
    res.json({ likes: comment.likes.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================== MESSAGE ROUTES =====================
app.get('/api/messages', authenticate, (req, res) => {
  try {
    const messages = readData('messages.json');
    const userMessages = messages.filter(m => m.to === req.user.id || m.from === req.user.id);
    res.json(userMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/messages/send', authenticate, (req, res) => {
  try {
    const { to, message } = req.body;
    const messages = readData('messages.json');
    const users = readData('users.json');
    const fromUser = users.find(u => u.id === req.user.id);
    
    const newMessage = {
      id: uuidv4(),
      from: req.user.id,
      fromName: fromUser.displayName,
      to,
      message,
      timestamp: new Date().toISOString(),
      read: false
    };
    
    messages.push(newMessage);
    writeData('messages.json', messages);
    io.emit('newMessage', newMessage);
    res.json(newMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== BEAT ROUTES ==================
app.post('/api/beats', authenticate, upload.single('beat'), async (req, res) => {
  try {
    const users = readData('users.json');
    const user = users.find(u => u.id === req.user.id);
    const { title, genre, bpm, description, tags } = req.body;
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
      fileUrl: `/uploads/beats/${req.file.filename}`,
      filename: req.file.filename,
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
    
    res.json(newBeat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/beats', (req, res) => {
  try {
    let beats = readData('beats.json');
    const { sort, genre, search, limit = 50 } = req.query;
    
    if (search) {
      const term = search.toLowerCase();
      beats = beats.filter(b => b.title.toLowerCase().includes(term) || b.producerName.toLowerCase().includes(term));
    }
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
    
    const users = readData('users.json');
    const versionsWithUserInfo = beat.versions.map(version => {
      const user = users.find(u => u.id === version.vocalistId);
      return { ...version, vocalistName: user?.displayName || 'Unknown' };
    });
    
    res.json({ ...beat, versions: versionsWithUserInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/beats/:id/download', authenticate, (req, res) => {
  try {
    const beats = readData('beats.json');
    const beat = beats.find(b => b.id === req.params.id);
    if (!beat) return res.status(404).json({ error: 'Beat not found' });
    
    beat.downloads++;
    writeData('beats.json', beats);
    
    const filePath = path.join(__dirname, beat.fileUrl);
    res.download(filePath, `${beat.title}.mp3`);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== RECORDING ROUTES ==================
app.post('/api/beats/:beatId/record', authenticate, upload.single('vocal'), async (req, res) => {
  try {
    const beats = readData('beats.json');
    const users = readData('users.json');
    const beatIndex = beats.findIndex(b => b.id === req.params.beatId);
    
    if (beatIndex === -1) return res.status(404).json({ error: 'Beat not found' });
    
    const user = users.find(u => u.id === req.user.id);
    const beat = beats[beatIndex];
    const { title, description, tags } = req.body;
    
    const newVersion = {
      id: uuidv4(),
      beatId: req.params.beatId,
      beatTitle: beat.title,
      vocalistId: req.user.id,
      vocalistName: user.displayName || user.username,
      vocalistUsername: user.username,
      title: title || `${user.displayName}'s version`,
      description: description || "",
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      fileUrl: `/uploads/vocals/${req.file.filename}`,
      filename: req.file.filename,
      createdAt: new Date().toISOString(),
      votes: [],
      rating: 0,
      plays: 0,
      isFork: false
    };
    
    beat.versions.push(newVersion);
    writeData('beats.json', beats);
    
    if (!user.recordings) user.recordings = [];
    user.recordings.push(newVersion.id);
    writeData('users.json', users);
    
    res.json(newVersion);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== FORK MIX ROUTES ==================
app.post('/api/beats/:beatId/fork', authenticate, async (req, res) => {
  try {
    const { mixData, title, description, tags } = req.body;
    const beats = readData('beats.json');
    const users = readData('users.json');
    const beatIndex = beats.findIndex(b => b.id === req.params.beatId);
    
    if (beatIndex === -1) return res.status(404).json({ error: 'Beat not found' });
    
    const user = users.find(u => u.id === req.user.id);
    const originalBeat = beats[beatIndex];
    
    const newVersion = {
      id: uuidv4(),
      beatId: req.params.beatId,
      beatTitle: originalBeat.title,
      vocalistId: req.user.id,
      vocalistName: user.displayName || user.username,
      vocalistUsername: user.username,
      title: title || `${user.displayName}'s fork of ${originalBeat.title}`,
      description: description || `Forked from ${originalBeat.producerName}'s beat`,
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      createdAt: new Date().toISOString(),
      votes: [],
      rating: 0,
      plays: 0,
      isFork: true,
      parentBeatId: req.params.beatId,
      mixData: mixData,
      fileUrl: null
    };
    
    originalBeat.versions.push(newVersion);
    writeData('beats.json', beats);
    
    if (!user.recordings) user.recordings = [];
    user.recordings.push(newVersion.id);
    writeData('users.json', users);
    
    res.json(newVersion);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user/forks', authenticate, (req, res) => {
  try {
    const beats = readData('beats.json');
    const userForks = [];
    
    beats.forEach(beat => {
      beat.versions.forEach(version => {
        if (version.vocalistId === req.user.id && version.isFork) {
          userForks.push({
            ...version,
            originalBeatTitle: beat.title,
            originalProducer: beat.producerName
          });
        }
      });
    });
    
    res.json(userForks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/beats/:beatId/save-mix', authenticate, upload.single('mix'), async (req, res) => {
  try {
    const { versionId } = req.body;
    const beats = readData('beats.json');
    
    for (const beat of beats) {
      const versionIndex = beat.versions.findIndex(v => v.id === versionId);
      if (versionIndex !== -1) {
        beat.versions[versionIndex].fileUrl = '/uploads/mixes/' + req.file.filename;
        beat.versions[versionIndex].mixFile = req.file.filename;
        writeData('beats.json', beats);
        res.json({ success: true, fileUrl: beat.versions[versionIndex].fileUrl });
        return;
      }
    }
    res.status(404).json({ error: 'Version not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== VOTE ROUTES ==================
app.post('/api/vote', authenticate, (req, res) => {
  try {
    const { recordingId, rating } = req.body;
    let votes = readData('votes.json');
    
    if (votes.find(v => v.userId === req.user.id && v.recordingId === recordingId)) {
      return res.status(400).json({ error: 'Already voted' });
    }
    
    votes.push({ id: uuidv4(), userId: req.user.id, recordingId, rating, createdAt: new Date().toISOString() });
    writeData('votes.json', votes);
    
    const beats = readData('beats.json');
    for (const beat of beats) {
      const version = beat.versions.find(v => v.id === recordingId);
      if (version) {
        const recordingVotes = votes.filter(v => v.recordingId === recordingId);
        version.rating = recordingVotes.reduce((sum, v) => sum + v.rating, 0) / recordingVotes.length;
        version.votes = recordingVotes;
        writeData('beats.json', beats);
        break;
      }
    }
    
    res.json({ message: 'Voted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== SOCIAL ROUTES ==================
app.get('/api/feed', authenticate, (req, res) => {
  try {
    const users = readData('users.json');
    const beats = readData('beats.json');
    const currentUser = users.find(u => u.id === req.user.id);
    const followingIds = currentUser?.following || [];
    const feedItems = [];
    
    beats.forEach(beat => {
      if (followingIds.includes(beat.producerId)) {
        feedItems.push({ type: 'beat', ...beat, timestamp: beat.createdAt });
      }
      beat.versions.forEach(version => {
        if (followingIds.includes(version.vocalistId)) {
          feedItems.push({ type: 'recording', beat: { id: beat.id, title: beat.title }, ...version, timestamp: version.createdAt });
        }
      });
    });
    
    feedItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(feedItems.slice(0, 50));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trending', (req, res) => {
  try {
    const beats = readData('beats.json');
    const trending = [];
    
    beats.forEach(beat => {
      const popularity = beat.plays + beat.downloads;
      if (popularity > 5) {
        trending.push({ type: 'beat', ...beat, popularity });
      }
      beat.versions.forEach(version => {
        if (version.votes?.length > 2 && version.rating > 3) {
          trending.push({ type: 'recording', beat: { id: beat.id, title: beat.title, producerName: beat.producerName }, ...version, popularity: version.votes.length });
        }
      });
    });
    
    trending.sort((a, b) => b.popularity - a.popularity);
    res.json(trending.slice(0, 30));
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
      recordings: user.recordings?.length || 0,
      followers: user.followers?.length || 0,
      bio: user.bio || ""
    }));
    res.json(topUsers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search', (req, res) => {
  try {
    const { q, type } = req.query;
    if (!q || q.length < 2) return res.json([]);
    
    const users = readData('users.json');
    const beats = readData('beats.json');
    let results = [];
    
    if (type === 'users' || !type) {
      const matchedUsers = users.filter(user => 
        user.username.toLowerCase().includes(q.toLowerCase()) || 
        user.displayName?.toLowerCase().includes(q.toLowerCase())
      ).map(user => ({ type: 'user', id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar }));
      results.push(...matchedUsers);
    }
    
    if (type === 'beats' || !type) {
      const matchedBeats = beats.filter(beat => 
        beat.title.toLowerCase().includes(q.toLowerCase()) || 
        beat.producerName.toLowerCase().includes(q.toLowerCase())
      ).map(beat => ({ type: 'beat', id: beat.id, title: beat.title, producerName: beat.producerName, genre: beat.genre }));
      results.push(...matchedBeats);
    }
    
    res.json(results.slice(0, 20));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    
    const users = readData('users.json');
    const results = users.filter(user => 
      user.username.toLowerCase().includes(q.toLowerCase()) || 
      user.displayName?.toLowerCase().includes(q.toLowerCase())
    ).map(user => ({ id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, points: user.points })).slice(0, 20);
    
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:id/follow', authenticate, (req, res) => {
  try {
    const users = readData('users.json');
    const user = users.find(u => u.id === req.user.id);
    const target = users.find(u => u.id === req.params.id);
    
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!user.following) user.following = [];
    if (user.following.includes(req.params.id)) return res.status(400).json({ error: 'Already following' });
    
    user.following.push(req.params.id);
    if (!target.followers) target.followers = [];
    target.followers.push(req.user.id);
    
    writeData('users.json', users);
    res.json({ message: 'Followed' });
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
    const userRecordings = beats.flatMap(b => b.versions.filter(v => v.vocalistId === user.id));
    
    const { password, ...userWithoutPassword } = user;
    res.json({ 
      ...userWithoutPassword, 
      uploadedBeatsCount: userBeats.length, 
      recordingsCount: userRecordings.length, 
      uploadedBeats: userBeats, 
      recordings: userRecordings 
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
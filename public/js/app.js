// ==================== CONFIGURATION ====================
const CONFIG = {
  API_URL: '',
  STORAGE_KEYS: {
    TOKEN: '8trax_token',
    USER: '8trax_user'
  }
};

let currentUser = null;
let currentBeatId = null;
let socket = null;
let currentChatUser = null;

// ================== STUDIO STATE ==================
let studioState = {
  isOpen: false,
  currentBeatId: null,
  currentBeatTitle: null,
  currentBeatUrl: null,
  beatBuffer: null,
  tracks: [],
  isPlaying: false,
  isRecording: false,
  isCountInActive: false,
  currentRecordingTrack: null,
  mediaRecorder: null,
  audioChunks: [],
  recordingStartTime: null,
  recordingTimer: null,
  monitoringSource: null,
  audioContext: null,
  activeSources: [],
  activeGains: [],
  metronomeEnabled: false,
  countInEnabled: true,
  metronomeBPM: 120,
  metronomeInterval: null,
  currentForkVersionId: null
};

// ================== UPLOAD STATE ==================
let activeUploads = new Map();
let currentUploadSession = null;
let uploadStartTime = null;
let lastUploadedBytes = 0;

// ================== API SERVICE ==================
class API {
  getToken() { return localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN); }
  
  getHeaders(includeAuth = true, isFormData = false) {
    const headers = {};
    if (!isFormData) headers['Content-Type'] = 'application/json';
    if (includeAuth && this.getToken()) headers['Authorization'] = `Bearer ${this.getToken()}`;
    return headers;
  }
  
  async request(endpoint, options = {}) {
    const { method = 'GET', body = null, isFormData = false, includeAuth = true } = options;
    const config = { method, headers: this.getHeaders(includeAuth, isFormData) };
    if (body) config.body = isFormData ? body : JSON.stringify(body);
    const response = await fetch(`${CONFIG.API_URL}${endpoint}`, config);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  // Auth
  async register(userData) { return this.request('/api/auth/register', { method: 'POST', body: userData }); }
  async login(credentials) { return this.request('/api/auth/login', { method: 'POST', body: credentials }); }
  async getMe() { return this.request('/api/auth/me'); }
  
  // Beats
  async getBeats(params = {}) { const query = new URLSearchParams(params).toString(); return this.request(`/api/beats${query ? '?' + query : ''}`); }
  async getBeat(id) { return this.request(`/api/beats/${id}`); }
  async uploadBeat(formData) { return this.request('/api/beats', { method: 'POST', body: formData, isFormData: true }); }
  async downloadBeat(id) { const token = this.getToken(); window.open(`${CONFIG.API_URL}/api/beats/${id}/download?token=${token}`, '_blank'); }
  
  // Recordings
  async uploadRecording(beatId, formData) { return this.request(`/api/beats/${beatId}/record`, { method: 'POST', body: formData, isFormData: true }); }
  async vote(recordingId, rating) { return this.request('/api/vote', { method: 'POST', body: { recordingId, rating } }); }
  
  // Library
  async addToLibrary(beatId) { return this.request('/api/library/add', { method: 'POST', body: { beatId } }); }
  async removeFromLibrary(beatId) { return this.request('/api/library/remove', { method: 'DELETE', body: { beatId } }); }
  async getLibrary() { return this.request('/api/library'); }
  
  // Comments
  async addComment(beatId, comment) { return this.request('/api/comments/add', { method: 'POST', body: { beatId, comment } }); }
  async getComments(beatId) { return this.request(`/api/comments/${beatId}`); }
  async likeComment(commentId) { return this.request('/api/comments/like', { method: 'POST', body: { commentId } }); }
  
  // Messages
  async getMessages() { return this.request('/api/messages'); }
  async sendMessage(to, message) { return this.request('/api/messages/send', { method: 'POST', body: { to, message } }); }
  
  // Social
  async getFeed() { return this.request('/api/feed'); }
  async getTrending() { return this.request('/api/trending'); }
  async getLeaderboard() { return this.request('/api/leaderboard'); }
  async search(query, type = 'all') { return this.request(`/api/search?q=${encodeURIComponent(query)}&type=${type}`); }
  async getUserProfile(username) { return this.request(`/api/users/${username}`); }
  async followUser(userId) { return this.request(`/api/users/${userId}/follow`, { method: 'POST' }); }
  
  // Fork
  async forkBeat(beatId, mixData, title, description, tags) { 
    return this.request(`/api/beats/${beatId}/fork`, { method: 'POST', body: { mixData, title, description, tags } }); 
  }
  async saveMix(beatId, versionId, formData) { 
    return this.request(`/api/beats/${beatId}/save-mix`, { method: 'POST', body: formData, isFormData: true }); 
  }
  async getUserForks() { return this.request('/api/user/forks'); }
  
  // Upload with progress
  async startUploadSession(fileName, fileSize, type) {
    return this.request('/api/upload/start', { method: 'POST', body: { fileName, fileSize, type } });
  }
  async uploadChunk(formData) {
    return this.request('/api/upload/chunk', { method: 'POST', body: formData, isFormData: true });
  }
  async completeUpload(sessionId, metadata) {
    return this.request('/api/upload/complete', { method: 'POST', body: { sessionId, ...metadata } });
  }
  async cancelUpload(sessionId) {
    return this.request(`/api/upload/${sessionId}`, { method: 'DELETE' });
  }
  async getUploadStatus(sessionId) {
    return this.request(`/api/upload/status/${sessionId}`);
  }
  async getUploadHistory() {
    return this.request('/api/upload/history');
  }
}

const api = new API();

// ==================== UTILITIES ====================
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `position: fixed; bottom:80px; left:16px; right:16px; background:${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#667eea'}; color:white; padding:12px; border-radius:12px; text-align:center; z-index:1000; animation:fadeIn 0.3s ease;`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function showPage(pageName) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  const targetPage = document.getElementById(`${pageName}Page`);
  if (targetPage) targetPage.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(nav => {
    nav.classList.remove('active');
    if (nav.dataset.page === pageName) nav.classList.add('active');
  });
}

// ==================== AUTHENTICATION ====================
async function register() {
  const username = document.getElementById('regUsername').value;
  const email = document.getElementById('regEmail').value;
  const displayName = document.getElementById('regDisplayName').value;
  const bio = document.getElementById('regBio').value;
  const password = document.getElementById('regPassword').value;
  
  if (!username || !email || !password) {
    showToast('Please fill required fields', 'error');
    return;
  }
  
  try {
    const data = await api.register({ username, email, displayName, bio, password });
    localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN, data.token);
    localStorage.setItem(CONFIG.STORAGE_KEYS.USER, JSON.stringify(data.user));
    currentUser = data.user;
    updateUI();
    closeModal('registerModal');
    loadFeed();
    loadLibrary();
    initSocket();
    showToast('Welcome to 8Trax', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function login() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  
  if (!email || !password) {
    showToast('Please fill all fields', 'error');
    return;
  }
  
  try {
    const data = await api.login({ email, password });
    localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN, data.token);
    localStorage.setItem(CONFIG.STORAGE_KEYS.USER, JSON.stringify(data.user));
    currentUser = data.user;
    updateUI();
    closeModal('loginModal');
    loadFeed();
    loadLibrary();
    initSocket();
    showToast('Welcome back', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function logout() {
  localStorage.clear();
  currentUser = null;
  if (socket) socket.disconnect();
  updateUI();
  showPage('discover');
  discoverMusic();
  showToast('Logged out', 'info');
}

function updateUI() {
  const authSection = document.getElementById('authSection');
  const welcomeBanner = document.getElementById('welcomeBanner');
  
  if (currentUser) {
    if (authSection) authSection.innerHTML = `<button class="icon-btn" onclick="viewProfile('${currentUser.username}')">👤</button><button class="icon-btn" onclick="logout()">🚪</button>`;
    if (welcomeBanner) welcomeBanner.style.display = 'none';
  } else {
    if (authSection) authSection.innerHTML = '<button class="btn-secondary" onclick="showLoginModal()">Login</button><button class="btn-primary" onclick="showRegisterModal()">Sign Up</button>';
    if (welcomeBanner) welcomeBanner.style.display = 'block';
  }
}

function showLoginModal() { showModal('loginModal'); }
function showRegisterModal() { showModal('registerModal'); }

function initSocket() {
  if (socket) return;
  socket = io();
  socket.on('newMessage', (message) => {
    if (currentChatUser && message.from === currentChatUser.id) {
      displayMessage(message);
    }
    showToast('New message!', 'info');
  });
  socket.on('uploadProgress', (data) => {
    if (data.sessionId === currentUploadSession) {
      const fileInput = document.getElementById('beatFile');
      if (fileInput && fileInput.files[0]) {
        const elapsed = (Date.now() - uploadStartTime) / 1000;
        const file = fileInput.files[0];
        const stats = updateUploadStats(data.uploadedBytes, file.size, elapsed);
        const speedEl = document.getElementById('uploadSpeed');
        const timeEl = document.getElementById('uploadTimeRemaining');
        if (speedEl) speedEl.textContent = stats.speedFormatted;
        if (timeEl) timeEl.textContent = stats.timeRemainingFormatted;
      }
    }
  });
  socket.on('uploadComplete', (data) => {
    if (data.sessionId === currentUploadSession) {
      showToast('Upload completed!', 'success');
      removeActiveUpload(data.sessionId);
    }
  });
  socket.on('uploadCancelled', (data) => {
    if (data.sessionId === currentUploadSession) {
      showToast('Upload cancelled', 'info');
      removeActiveUpload(data.sessionId);
    }
  });
}

// ================ FEED & DISCOVERY ================
async function loadFeed() {
  if (!currentUser) {
    const c = document.getElementById('feedContent');
    if (c) c.innerHTML = '<div class="empty-state">Login to see your feed</div>';
    return;
  }
  
  try {
    const feed = await api.getFeed();
    const container = document.getElementById('feedContent');
    if (!container) return;
    if (!feed.length) {
      container.innerHTML = '<div class="empty-state">Follow creators to see updates</div>';
      return;
    }
    
    container.innerHTML = feed.map(item => `
      <div class="feed-item" onclick="viewBeat('${item.id}')">
        <div class="feed-header">
          <div class="feed-avatar">${(item.producerName?.[0] || 'U').toUpperCase()}</div>
          <div class="feed-user-info">
            <div class="feed-username">${escapeHtml(item.producerName || item.vocalistName)}</div>
            <div class="feed-time">${timeAgo(item.createdAt)}</div>
          </div>
          <span class="feed-badge ${item.type === 'beat' ? 'badge-beat' : 'badge-recording'}">${item.type === 'beat' ? 'New Beat' : 'New Recording'}</span>
        </div>
        <div class="beat-title">${escapeHtml(item.title)}</div>
        <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${item.fileUrl}"></audio>
      </div>
    `).join('');
  } catch (error) {
    console.error(error);
  }
}

async function discoverMusic() {
  const genre = document.getElementById('discoverGenre')?.value || 'all';
  const sort = document.getElementById('discoverSort')?.value || 'newest';
  
  try {
    const beats = await api.getBeats({ genre, sort });
    const container = document.getElementById('discoverContent');
    if (!container) return;
    if (!beats.length) {
      container.innerHTML = '<div class="empty-state">No beats found. Be the first to upload!</div>';
      return;
    }
    
    container.innerHTML = beats.map(beat => `
      <div class="beat-card" onclick="viewBeat('${beat.id}')">
        <div class="beat-title">${escapeHtml(beat.title)}</div>
        <div class="beat-info">by ${escapeHtml(beat.producerName)} • ${beat.genre} • ${beat.bpm} BPM</div>
        <div class="beat-stats">⭐ ${beat.rating || 0}/5 • 🎧 ${beat.plays} plays • ⬇️ ${beat.downloads} downloads</div>
        <div class="beat-tags">${beat.tags?.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('') || ''}</div>
        <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${beat.fileUrl}"></audio>
        <div class="beat-actions">
          <button class="btn-secondary" onclick="event.stopPropagation(); addToLibrary('${beat.id}')">📚 Save</button>
          <button class="btn-primary" onclick="event.stopPropagation(); openStudio('${beat.id}', '${escapeHtml(beat.title)}', '${CONFIG.API_URL}${beat.fileUrl}')">🎙️ Record</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error(error);
  }
}

async function loadTrending() {
  try {
    const trending = await api.getTrending();
    const container = document.getElementById('trendingContent');
    if (!container) return;
    if (!trending.length) {
      container.innerHTML = '<div class="empty-state">No trending content yet</div>';
      return;
    }
    
    container.innerHTML = trending.map(item => `
      <div class="feed-item" onclick="viewBeat('${item.id}')">
        <div class="feed-header">
          <div class="feed-avatar">${(item.producerName?.[0] || 'U').toUpperCase()}</div>
          <div class="feed-user-info">
            <div class="feed-username">${escapeHtml(item.producerName || item.vocalistName)}</div>
            <div class="feed-time">🔥 ${item.popularity}热度</div>
          </div>
        </div>
        <div class="beat-title">${escapeHtml(item.title)}</div>
        <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${item.fileUrl}"></audio>
      </div>
    `).join('');
  } catch (error) {
    console.error(error);
  }
}

async function loadLeaderboard() {
  try {
    const users = await api.getLeaderboard();
    const container = document.getElementById('leaderboardContent');
    if (!container) return;
    if (!users.length) {
      container.innerHTML = '<div class="empty-state">No users yet</div>';
      return;
    }
    
    container.innerHTML = users.map((user, index) => `
      <div class="leaderboard-item" onclick="viewProfile('${user.username}')">
        <div class="leaderboard-rank">#${index + 1}</div>
        <div class="leaderboard-user">
          <div class="leaderboard-avatar">${(user.displayName?.[0] || user.username?.[0]).toUpperCase()}</div>
          <div>
            <div><strong>${escapeHtml(user.displayName || user.username)}</strong></div>
            <div style="font-size:12px;">🏆 ${user.points} pts</div>
          </div>
        </div>
        <div class="leaderboard-stats">
          <div>🎵 ${user.uploadedBeats} beats</div>
          <div>🎙️ ${user.recordings} recordings</div>
          <div>👥 ${user.followers} followers</div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error(error);
  }
}

// ================== LIBRARY ==================
async function loadLibrary(type = 'saved') {
  if (!currentUser) {
    const c = document.getElementById('libraryContent');
    if (c) c.innerHTML = '<div class="empty-state">Login to view your library</div>';
    return;
  }
  
  try {
    if (type === 'saved') {
      const library = await api.getLibrary();
      const container = document.getElementById('libraryContent');
      if (!container) return;
      if (!library.length) {
        container.innerHTML = '<div class="empty-state">Your library is empty. Save beats you like!</div>';
        return;
      }
      
      container.innerHTML = library.map(beat => `
        <div class="beat-card" onclick="viewBeat('${beat.id}')">
          <div class="beat-title">${escapeHtml(beat.title)}</div>
          <div class="beat-info">by ${escapeHtml(beat.producerName)}</div>
          <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${beat.fileUrl}"></audio>
          <button class="btn-danger" onclick="event.stopPropagation(); removeFromLibrary('${beat.id}')">Remove</button>
        </div>
      `).join('');
    } else if (type === 'my-beats' && currentUser) {
      const profile = await api.getUserProfile(currentUser.username);
      const container = document.getElementById('libraryContent');
      if (!container) return;
      if (!profile.uploadedBeats?.length) {
        container.innerHTML = '<div class="empty-state">You haven\'t uploaded any beats yet</div>';
        return;
      }
      
      container.innerHTML = profile.uploadedBeats.map(beat => `
        <div class="beat-card" onclick="viewBeat('${beat.id}')">
          <div class="beat-title">${escapeHtml(beat.title)}</div>
          <div class="beat-info">${beat.genre} • ${beat.bpm} BPM</div>
          <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${beat.fileUrl}"></audio>
        </div>
      `).join('');
    } else if (type === 'my-recordings' && currentUser) {
      const profile = await api.getUserProfile(currentUser.username);
      const container = document.getElementById('libraryContent');
      if (!container) return;
      if (!profile.recordings?.length) {
        container.innerHTML = '<div class="empty-state">You haven\'t made any recordings yet</div>';
        return;
      }
      
      container.innerHTML = profile.recordings.map(rec => `
        <div class="beat-card" onclick="viewBeat('${rec.beatId}')">
          <div class="beat-title">${escapeHtml(rec.title)}${rec.isFork ? '<span class="fork-badge">🍴 Fork</span>' : ''}</div>
          <div class="beat-info">⭐ ${rec.rating?.toFixed(1) || 0}/5</div>
          <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${rec.fileUrl}"></audio>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error(error);
  }
}

async function addToLibrary(beatId) {
  if (!currentUser) {
    showToast('Login to save', 'error');
    return;
  }
  try {
    await api.addToLibrary(beatId);
    showToast('Added to library!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function removeFromLibrary(beatId) {
  try {
    await api.removeFromLibrary(beatId);
    showToast('Removed from library', 'info');
    loadLibrary('saved');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ================== MESSAGES ==================
async function loadMessages() {
  if (!currentUser) {
    showToast('Login to view messages', 'error');
    return;
  }
  
  try {
    const messages = await api.getMessages();
    const conversations = {};
    
    messages.forEach(msg => {
      const otherId = msg.from === currentUser.id ? msg.to : msg.from;
      const otherName = msg.from === currentUser.id ? msg.to : msg.fromName;
      if (!conversations[otherId]) {
        conversations[otherId] = {
          id: otherId,
          name: otherName || 'User',
          lastMessage: msg.message,
          lastTime: msg.timestamp
        };
      }
    });
    
    const container = document.getElementById('conversationsList');
    if (!container) return;
    
    if (Object.keys(conversations).length === 0) {
      container.innerHTML = '<div class="empty-state">No messages yet</div>';
      return;
    }
    
    container.innerHTML = Object.values(conversations).map(conv => `
      <div class="conversation-item" onclick="openChat('${conv.id}', '${escapeHtml(conv.name)}')">
        <div class="feed-avatar" style="width:40px;height:40px;">${conv.name[0]?.toUpperCase() || 'U'}</div>
        <div style="flex:1">
          <div><strong>${escapeHtml(conv.name)}</strong></div>
          <div style="font-size:12px;color:#6b7280;">${escapeHtml(conv.lastMessage.substring(0, 30))}</div>
        </div>
        <div style="font-size:10px;color:#6b7280;">${timeAgo(conv.lastTime)}</div>
      </div>
    `).join('');
    
    showModal('messagesModal');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function openChat(userId, userName) {
  currentChatUser = { id: userId, name: userName };
  const chatHeader = document.getElementById('chatHeader');
  const chatArea = document.getElementById('chatArea');
  
  if (chatHeader) chatHeader.innerHTML = `<strong>${escapeHtml(userName)}</strong><button class="modal-close" onclick="closeChat()">×</button>`;
  if (chatArea) chatArea.style.display = 'flex';
  
  const messages = await api.getMessages();
  const conversation = messages.filter(m => 
    (m.from === userId && m.to === currentUser.id) || 
    (m.from === currentUser.id && m.to === userId)
  );
  
  const container = document.getElementById('chatMessages');
  if (container) {
    container.innerHTML = conversation.map(msg => `
      <div class="message ${msg.from === currentUser.id ? 'sent' : 'received'}">
        <div class="message-bubble">${escapeHtml(msg.message)}</div>
      </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
  }
}

function closeChat() {
  currentChatUser = null;
  const chatArea = document.getElementById('chatArea');
  const conversationsList = document.getElementById('conversationsList');
  if (chatArea) chatArea.style.display = 'none';
  if (conversationsList) conversationsList.style.display = 'block';
}

async function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  const message = messageInput?.value;
  if (!message || !currentChatUser) return;
  
  try {
    await api.sendMessage(currentChatUser.id, message);
    if (messageInput) messageInput.value = '';
    const container = document.getElementById('chatMessages');
    if (container) {
      container.innerHTML += `<div class="message sent"><div class="message-bubble">${escapeHtml(message)}</div></div>`;
      container.scrollTop = container.scrollHeight;
    }
    if (socket) socket.emit('sendMessage', { from: currentUser.id, fromName: currentUser.displayName, to: currentChatUser.id, message });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function displayMessage(message) {
  if (currentChatUser && message.from === currentChatUser.id) {
    const container = document.getElementById('chatMessages');
    if (container) {
      container.innerHTML += `<div class="message received"><div class="message-bubble">${escapeHtml(message.message)}</div></div>`;
      container.scrollTop = container.scrollHeight;
    }
  }
}

// ================== UPLOAD WITH PROGRESS ==================
function updateUploadStats(uploadedBytes, totalBytes, elapsedSeconds) {
  const speed = uploadedBytes / elapsedSeconds;
  const remainingBytes = totalBytes - uploadedBytes;
  const timeRemaining = remainingBytes / speed;
  
  return {
    speed: speed,
    speedFormatted: formatFileSize(speed) + '/s',
    timeRemaining: timeRemaining,
    timeRemainingFormatted: isFinite(timeRemaining) ? formatTime(timeRemaining) : 'Calculating...'
  };
}

function updateActiveUpload(sessionId, data) {
  const uploadsContainer = document.getElementById('uploadsList');
  const activeUploadsSection = document.getElementById('activeUploads');
  
  if (!activeUploadsSection || !uploadsContainer) return;
  
  activeUploadsSection.style.display = 'block';
  
  let uploadItem = document.getElementById(`upload-${sessionId}`);
  if (!uploadItem) {
    uploadItem = document.createElement('div');
    uploadItem.id = `upload-${sessionId}`;
    uploadItem.className = 'upload-item';
    uploadsContainer.appendChild(uploadItem);
  }
  
  uploadItem.innerHTML = `
    <div class="upload-header">
      <span class="upload-filename">${escapeHtml(data.fileName)}</span>
      <span class="upload-status uploading">${data.status}</span>
    </div>
    <div class="upload-progress">
      <div class="progress-bar-container">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${data.progress}%"></div>
        </div>
      </div>
      <div class="upload-stats">
        <span>${Math.round(data.progress)}%</span>
        <span>${data.speed || '0 MB/s'}</span>
      </div>
    </div>
    <div class="upload-actions">
      <button onclick="cancelUploadSession('${sessionId}')" class="btn-danger">Cancel</button>
    </div>
  `;
}

function removeActiveUpload(sessionId) {
  const uploadItem = document.getElementById(`upload-${sessionId}`);
  if (uploadItem) uploadItem.remove();
  
  const uploadsContainer = document.getElementById('uploadsList');
  if (uploadsContainer && uploadsContainer.children.length === 0) {
    const activeUploadsSection = document.getElementById('activeUploads');
    if (activeUploadsSection) activeUploadsSection.style.display = 'none';
  }
}

async function cancelUploadSession(sessionId) {
  try {
    await api.cancelUpload(sessionId);
    removeActiveUpload(sessionId);
    if (currentUploadSession === sessionId) {
      currentUploadSession = null;
      closeModal('uploadProgressModal');
    }
    showToast('Upload cancelled', 'info');
  } catch (error) {
    showToast('Error cancelling upload', 'error');
  }
}

async function cancelUpload() {
  if (!currentUploadSession) return;
  
  try {
    await api.cancelUpload(currentUploadSession);
    showToast('Upload cancelled', 'info');
    closeModal('uploadProgressModal');
    removeActiveUpload(currentUploadSession);
    currentUploadSession = null;
  } catch (error) {
    console.error('Cancel error:', error);
  }
}

async function uploadBeatWithProgress() {
  console.log('uploadBeatWithProgress called'); // Debug log
  
  if (!currentUser) {
    showToast('Please login', 'error');
    return;
  }
  
  const title = document.getElementById('beatTitle')?.value;
  const genre = document.getElementById('beatGenre')?.value;
  const bpm = document.getElementById('beatBpm')?.value;
  const tags = document.getElementById('beatTags')?.value;
  const description = document.getElementById('beatDescription')?.value;
  const file = document.getElementById('beatFile')?.files[0];
  
  if (!title || !bpm || !file) {
    showToast('Fill all required fields', 'error');
    return;
  }
  
  if (file.size > 100 * 1024 * 1024) {
    showToast('File too large. Max 100MB', 'error');
    return;
  }
  
  showModal('uploadProgressModal');
  const uploadFileName = document.getElementById('uploadFileName');
  const uploadFileSize = document.getElementById('uploadFileSize');
  const uploadProgressBar = document.getElementById('uploadProgressBar');
  const uploadPercentage = document.getElementById('uploadPercentage');
  const uploadSpeed = document.getElementById('uploadSpeed');
  const uploadTimeRemaining = document.getElementById('uploadTimeRemaining');
  const uploadStatusMessage = document.getElementById('uploadStatusMessage');
  
  if (uploadFileName) uploadFileName.textContent = file.name;
  if (uploadFileSize) uploadFileSize.textContent = formatFileSize(file.size);
  if (uploadProgressBar) uploadProgressBar.style.width = '0%';
  if (uploadPercentage) uploadPercentage.textContent = '0%';
  if (uploadSpeed) uploadSpeed.textContent = '0 MB/s';
  if (uploadTimeRemaining) uploadTimeRemaining.textContent = '--';
  if (uploadStatusMessage) uploadStatusMessage.textContent = 'Starting upload...';
  
  try {
    const startResponse = await api.startUploadSession(file.name, file.size, 'beat');
    const sessionId = startResponse.sessionId;
    currentUploadSession = sessionId;
    uploadStartTime = Date.now();
    
    const chunkSize = 1024 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const chunks = [];
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      chunks.push(chunk);
    }
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const formData = new FormData();
      formData.append('chunk', chunk);
      formData.append('sessionId', sessionId);
      formData.append('chunkIndex', i);
      formData.append('totalChunks', totalChunks);
      
      const uploadResponse = await api.uploadChunk(formData);
      
      const elapsed = (Date.now() - uploadStartTime) / 1000;
      const stats = updateUploadStats(uploadResponse.progress / 100 * file.size, file.size, elapsed);
      
      if (uploadProgressBar) uploadProgressBar.style.width = `${uploadResponse.progress}%`;
      if (uploadPercentage) uploadPercentage.textContent = `${Math.round(uploadResponse.progress)}%`;
      if (uploadSpeed) uploadSpeed.textContent = stats.speedFormatted;
      if (uploadTimeRemaining) uploadTimeRemaining.textContent = stats.timeRemainingFormatted;
      if (uploadStatusMessage) uploadStatusMessage.textContent = `Uploading chunk ${i + 1} of ${totalChunks}...`;
      
      updateActiveUpload(sessionId, {
        fileName: file.name,
        progress: uploadResponse.progress,
        status: 'uploading',
        speed: stats.speedFormatted
      });
    }
    
    if (uploadStatusMessage) uploadStatusMessage.textContent = 'Finalizing upload...';
    
    const completeResponse = await api.completeUpload(sessionId, {
      title,
      genre,
      bpm: parseInt(bpm),
      description,
      tags
    });
    
    if (completeResponse.success) {
      if (uploadStatusMessage) uploadStatusMessage.textContent = 'Upload complete!';
      if (uploadProgressBar) uploadProgressBar.style.width = '100%';
      if (uploadPercentage) uploadPercentage.textContent = '100%';
      
      setTimeout(() => {
        closeModal('uploadProgressModal');
        showToast('Beat uploaded successfully!', 'success');
        
        const beatTitleInput = document.getElementById('beatTitle');
        const beatBpmInput = document.getElementById('beatBpm');
        const beatTagsInput = document.getElementById('beatTags');
        const beatDescriptionInput = document.getElementById('beatDescription');
        const beatFileInput = document.getElementById('beatFile');
        const fileInfo = document.getElementById('fileInfo');
        
        if (beatTitleInput) beatTitleInput.value = '';
        if (beatBpmInput) beatBpmInput.value = '';
        if (beatTagsInput) beatTagsInput.value = '';
        if (beatDescriptionInput) beatDescriptionInput.value = '';
        if (beatFileInput) beatFileInput.value = '';
        if (fileInfo) fileInfo.textContent = '';
        
        discoverMusic();
        showPage('discover');
        
        removeActiveUpload(sessionId);
        currentUploadSession = null;
      }, 1000);
    }
  } catch (error) {
    console.error('Upload error:', error);
    const uploadStatusMessage = document.getElementById('uploadStatusMessage');
    if (uploadStatusMessage) {
      uploadStatusMessage.textContent = 'Upload failed: ' + error.message;
      uploadStatusMessage.style.color = '#ef4444';
    }
    
    setTimeout(() => {
      closeModal('uploadProgressModal');
      showToast('Upload failed: ' + error.message, 'error');
    }, 2000);
  }
}

async function loadUploadHistory(type = 'beats') {
  if (!currentUser) {
    showToast('Please login', 'error');
    return;
  }
  
  try {
    const history = await api.getUploadHistory();
    const container = document.getElementById('historyList');
    if (!container) return;
    
    let items = type === 'beats' ? history.beats : history.recordings;
    
    if (items.length === 0) {
      container.innerHTML = '<div class="empty-state">No uploads found</div>';
      return;
    }
    
    container.innerHTML = items.map(item => `
      <div class="history-item" onclick="${type === 'beats' ? `viewBeat('${item.id}')` : `viewBeat('${item.beatId || item.id}')`}">
        <div class="history-item-header">
          <span class="history-title">${escapeHtml(item.title)}</span>
          <span class="history-type ${item.type} ${item.isFork ? 'fork' : ''}">
            ${item.isFork ? '🍴 Fork' : (item.type === 'beat' ? '🎵 Beat' : '🎙️ Recording')}
          </span>
        </div>
        ${item.beatTitle ? `<div style="font-size: 12px; color: #6b7280;">on ${escapeHtml(item.beatTitle)}</div>` : ''}
        <div class="history-stats">
          ${item.plays !== undefined ? `<span>🎧 ${item.plays} plays</span>` : ''}
          ${item.downloads !== undefined ? `<span>⬇️ ${item.downloads} downloads</span>` : ''}
          ${item.rating !== undefined ? `<span>⭐ ${item.rating.toFixed(1)}/5</span>` : ''}
        </div>
        <div class="history-date">${new Date(item.createdAt).toLocaleDateString()}</div>
      </div>
    `).join('');
    
    document.querySelectorAll('.history-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    if (window.event && window.event.target) window.event.target.classList.add('active');
    
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function showUploadHistory() {
  if (!currentUser) {
    showToast('Please login', 'error');
    return;
  }
  loadUploadHistory('beats');
  showModal('uploadHistoryModal');
}

// ====================== STUDIO FUNCTIONS (SIMPLIFIED FOR BREVITY) ======================
// Note: Include all studio functions here (openStudio, playAllTracks, etc.)
// For brevity, I'm showing the key functions. You already have these in your previous file.

function initStudioTracks() {
  studioState.tracks = [];
  for (let i = 0; i < 8; i++) {
    studioState.tracks.push({
      id: i,
      name: i === 0 ? 'Beat Track' : `Track ${i}`,
      audioBuffer: null,
      audioUrl: null,
      volume: 0.8,
      muted: false,
      solo: false,
      isLoaded: false
    });
  }
}

async function loadBeatsForStudio() {
  try {
    const beats = await api.getBeats({ sort: 'newest', limit: 10 });
    const container = document.getElementById('beatSelector');
    if (!container) return;
    if (!beats.length) {
      container.innerHTML = '<div class="empty-state">No beats available. Upload a beat first!</div>';
      return;
    }
    
    container.innerHTML = beats.map(beat => `
      <div class="beat-card">
        <div class="beat-title">${escapeHtml(beat.title)}</div>
        <div class="beat-info">by ${escapeHtml(beat.producerName)}</div>
        <div class="beat-info">${beat.genre} • ${beat.bpm} BPM</div>
        <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${beat.fileUrl}"></audio>
        <button class="btn-primary" style="margin-top:10px; width:100%" onclick="event.stopPropagation(); openStudio('${beat.id}', '${escapeHtml(beat.title)}', '${CONFIG.API_URL}${beat.fileUrl}')">Open in Studio</button>
      </div>
    `).join('');
  } catch (error) {
    console.error(error);
  }
}

// Add all other studio functions here (openStudio, renderStudioInterface, drawWaveform, uploadTrackFile, etc.)

// ================ INITIALIZATION ================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, initializing app...');
  
  const token = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
  const savedUser = localStorage.getItem(CONFIG.STORAGE_KEYS.USER);
  
  if (token && savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      updateUI();
      initSocket();
    } catch(e) {
      localStorage.clear();
    }
  }
  
  updateUI();
  await discoverMusic();
  await loadTrending();
  await loadLeaderboard();
  await loadBeatsForStudio();
  
  // Navigation
  document.querySelectorAll('.nav-item').forEach(nav => {
    nav.addEventListener('click', () => {
      const page = nav.dataset.page;
      showPage(page);
      if (page === 'feed' && currentUser) loadFeed();
      if (page === 'discover') discoverMusic();
      if (page === 'trending') loadTrending();
      if (page === 'leaderboard') loadLeaderboard();
      if (page === 'studio') loadBeatsForStudio();
      if (page === 'library' && currentUser) loadLibrary('saved');
      if (page === 'profile' && currentUser) viewProfile(currentUser.username);
    });
  });
  
  // Library tabs
  document.querySelectorAll('.lib-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadLibrary(tab.dataset.lib);
    });
  });
  
  // Search
  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn) searchBtn.addEventListener('click', () => showModal('searchModal'));
  
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', async () => {
      const query = searchInput.value;
      if (!query || query.length < 2) return;
      try {
        const results = await api.search(query);
        const container = document.getElementById('searchResultsList');
        if (!container) return;
        container.innerHTML = results.map(r => r.type === 'user' 
          ? `<div class="search-result-item" onclick="viewProfile('${r.username}'); closeModal('searchModal')">
               <div class="search-result-avatar">${(r.displayName?.[0] || r.username?.[0]).toUpperCase()}</div>
               <div><strong>${escapeHtml(r.displayName || r.username)}</strong><div style="font-size:12px;">@${escapeHtml(r.username)}</div></div>
             </div>`
          : `<div class="search-result-item" onclick="viewBeat('${r.id}'); closeModal('searchModal')">
               <div>🎵</div>
               <div><strong>${escapeHtml(r.title)}</strong><div style="font-size:12px;">by ${escapeHtml(r.producerName)}</div></div>
             </div>`
        ).join('');
      } catch (error) {
        console.error(error);
      }
    });
  }
  
  // Messages
  const messagesBtn = document.getElementById('messagesBtn');
  if (messagesBtn) {
    messagesBtn.addEventListener('click', () => {
      if (currentUser) loadMessages();
      else showToast('Login to view messages', 'error');
    });
  }
  
  // Upload history
  const uploadHistoryBtn = document.getElementById('uploadHistoryBtn');
  if (uploadHistoryBtn) uploadHistoryBtn.addEventListener('click', showUploadHistory);
  
  // File input listener
  const beatFileInput = document.getElementById('beatFile');
  if (beatFileInput) {
    beatFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const fileInfo = document.getElementById('fileInfo');
      if (file && fileInfo) {
        fileInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
        if (file.size > 100 * 1024 * 1024) {
          fileInfo.style.color = '#ef4444';
          fileInfo.textContent += ' - Exceeds 100MB limit!';
        } else {
          fileInfo.style.color = '#10b981';
        }
      }
    });
  }
  
  // Debug: Check if upload function is defined
  console.log('uploadBeatWithProgress defined:', typeof uploadBeatWithProgress);
  
  initMetronome();
});

// ================ MAKE ALL FUNCTIONS GLOBAL ================
// This is the critical part - ensure all functions are on window object
(function exposeGlobals() {
  window.register = register;
  window.login = login;
  window.logout = logout;
  window.viewBeat = viewBeat;
  window.downloadBeat = downloadBeat;
  window.voteForRecording = voteForRecording;
  window.viewProfile = viewProfile;
  window.followUser = followUser;
  window.discoverMusic = discoverMusic;
  window.loadTrending = loadTrending;
  window.loadLeaderboard = loadLeaderboard;
  window.showLoginModal = showLoginModal;
  window.showRegisterModal = showRegisterModal;
  window.closeModal = closeModal;
  window.showPage = showPage;
  window.addToLibrary = addToLibrary;
  window.removeFromLibrary = removeFromLibrary;
  window.openStudio = openStudio;
  window.startRecordingToTrack = startRecordingToTrack;
  window.stopRecordingToTrack = stopRecordingToTrack;
  window.clearTrack = clearTrack;
  window.updateTrackVolume = updateTrackVolume;
  window.updateTrackName = updateTrackName;
  window.toggleSolo = toggleSolo;
  window.toggleMute = toggleMute;
  window.playAllTracks = playAllTracks;
  window.stopAllTracks = stopAllTracks;
  window.closeStudio = closeStudio;
  window.openTrackFX = openTrackFX;
  window.applyFX = applyFX;
  window.showComments = showComments;
  window.addComment = addComment;
  window.likeComment = likeComment;
  window.loadBeatsForStudio = loadBeatsForStudio;
  window.uploadTrackFile = uploadTrackFile;
  window.prepareRecording = prepareRecording;
  window.toggleMetronome = toggleMetronome;
  window.toggleCountIn = toggleCountIn;
  window.updateMetronomeBPM = updateMetronomeBPM;
  window.loadMessages = loadMessages;
  window.openChat = openChat;
  window.sendMessage = sendMessage;
  window.closeChat = closeChat;
  window.downloadMix = downloadMix;
  window.showForkModal = showForkModal;
  window.confirmFork = confirmFork;
  window.uploadBeatWithProgress = uploadBeatWithProgress;
  window.cancelUpload = cancelUpload;
  window.cancelUploadSession = cancelUploadSession;
  window.showUploadHistory = showUploadHistory;
  window.loadUploadHistory = loadUploadHistory;
  window.formatFileSize = formatFileSize;
  
  console.log('All functions exposed to window. uploadBeatWithProgress:', typeof window.uploadBeatWithProgress);
})();

// Note: You need to add all the missing function implementations here
// (viewBeat, downloadBeat, voteForRecording, viewProfile, followUser, etc.)
// These were omitted for brevity but you have them in your previous file

// Placeholder for missing functions - replace with your actual implementations
async function viewBeat(beatId) { console.log('viewBeat called', beatId); }
async function downloadBeat(beatId) { console.log('downloadBeat called', beatId); }
async function voteForRecording(recordingId) { console.log('voteForRecording called', recordingId); }
async function viewProfile(username) { console.log('viewProfile called', username); }
async function followUser(userId) { console.log('followUser called', userId); }
async function openStudio(beatId, beatTitle, beatFileUrl) { console.log('openStudio called', beatId, beatTitle, beatFileUrl); }
async function startRecordingToTrack(trackNum) { console.log('startRecordingToTrack called', trackNum); }
function stopRecordingToTrack() { console.log('stopRecordingToTrack called'); }
function clearTrack(trackId) { console.log('clearTrack called', trackId); }
function updateTrackVolume(trackId, vol) { console.log('updateTrackVolume called', trackId, vol); }
function updateTrackName(trackId, name) { console.log('updateTrackName called', trackId, name); }
function toggleSolo(trackId) { console.log('toggleSolo called', trackId); }
function toggleMute(trackId) { console.log('toggleMute called', trackId); }
async function playAllTracks() { console.log('playAllTracks called'); }
function stopAllTracks() { console.log('stopAllTracks called'); }
function closeStudio() { console.log('closeStudio called'); }
function openTrackFX(trackId) { console.log('openTrackFX called', trackId); }
async function applyFX() { console.log('applyFX called'); }
async function showComments(beatId) { console.log('showComments called', beatId); }
async function addComment() { console.log('addComment called'); }
async function likeComment(commentId) { console.log('likeComment called', commentId); }
async function uploadTrackFile(trackId, file) { console.log('uploadTrackFile called', trackId, file); }
function prepareRecording() { console.log('prepareRecording called'); }
function toggleMetronome() { console.log('toggleMetronome called'); }
function toggleCountIn() { console.log('toggleCountIn called'); }
function updateMetronomeBPM() { console.log('updateMetronomeBPM called'); }
async function downloadMix() { console.log('downloadMix called'); }
function showForkModal() { console.log('showForkModal called'); }
async function confirmFork() { console.log('confirmFork called'); }
function initMetronome() { console.log('initMetronome called'); }
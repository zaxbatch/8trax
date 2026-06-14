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

  async register(userData) { return this.request('/api/auth/register', { method: 'POST', body: userData }); }
  async login(credentials) { return this.request('/api/auth/login', { method: 'POST', body: credentials }); }
  async getBeats(params = {}) { const query = new URLSearchParams(params).toString(); return this.request(`/api/beats${query ? '?' + query : ''}`); }
  async getBeat(id) { return this.request(`/api/beats/${id}`); }
  async uploadBeat(formData) { return this.request('/api/beats', { method: 'POST', body: formData, isFormData: true }); }
  async downloadBeat(id) { const token = this.getToken(); window.open(`${CONFIG.API_URL}/api/beats/${id}/download?token=${token}`, '_blank'); }
  async uploadRecording(beatId, formData) { return this.request(`/api/beats/${beatId}/record`, { method: 'POST', body: formData, isFormData: true }); }
  async forkBeat(beatId, mixData, title, description, tags) { return this.request(`/api/beats/${beatId}/fork`, { method: 'POST', body: { mixData, title, description, tags } }); }
  async saveMix(beatId, versionId, formData) { return this.request(`/api/beats/${beatId}/save-mix`, { method: 'POST', body: formData, isFormData: true }); }
  async getUserForks() { return this.request('/api/user/forks'); }
  async vote(recordingId, rating) { return this.request('/api/vote', { method: 'POST', body: { recordingId, rating } }); }
  async addToLibrary(beatId) { return this.request('/api/library/add', { method: 'POST', body: { beatId } }); }
  async removeFromLibrary(beatId) { return this.request('/api/library/remove', { method: 'DELETE', body: { beatId } }); }
  async getLibrary() { return this.request('/api/library'); }
  async addComment(beatId, comment) { return this.request('/api/comments/add', { method: 'POST', body: { beatId, comment } }); }
  async getComments(beatId) { return this.request(`/api/comments/${beatId}`); }
  async likeComment(commentId) { return this.request('/api/comments/like', { method: 'POST', body: { commentId } }); }
  async getMessages() { return this.request('/api/messages'); }
  async sendMessage(to, message) { return this.request('/api/messages/send', { method: 'POST', body: { to, message } }); }
  async getFeed() { return this.request('/api/feed'); }
  async getTrending() { return this.request('/api/trending'); }
  async getLeaderboard() { return this.request('/api/leaderboard'); }
  async search(query, type = 'all') { return this.request(`/api/search?q=${query}&type=${type}`); }
  async getUserProfile(username) { return this.request(`/api/users/${username}`); }
  async followUser(userId) { return this.request(`/api/users/${userId}/follow`, { method: 'POST' }); }
}

const api = new API();

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

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `position: fixed; bottom:80px; left:16px; right:16px; background:${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#667eea'}; color:white; padding:12px; border-radius:12px; text-align:center; z-index:1000; animation:fadeIn 0.3s ease;`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
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

function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
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
  document.getElementById('chatArea').style.display = 'none';
  document.getElementById('conversationsList').style.display = 'block';
}

async function sendMessage() {
  const message = document.getElementById('messageInput')?.value;
  if (!message || !currentChatUser) return;
  
  try {
    await api.sendMessage(currentChatUser.id, message);
    document.getElementById('messageInput').value = '';
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

// ====================== STUDIO FUNCTIONS ======================
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

async function openStudio(beatId, beatTitle, beatFileUrl) {
  if (!currentUser) {
    showToast('Please login', 'error');
    return;
  }
  
  if (studioState.audioContext) await studioState.audioContext.close();
  
  initStudioTracks();
  studioState.isOpen = true;
  studioState.currentBeatId = beatId;
  studioState.currentBeatTitle = beatTitle;
  studioState.audioContext = new (window.AudioContext || window.webkitAudioContext());
  
  try {
    const response = await fetch(beatFileUrl);
    const arrayBuffer = await response.arrayBuffer();
    studioState.beatBuffer = await studioState.audioContext.decodeAudioData(arrayBuffer);
    studioState.tracks[0].audioBuffer = studioState.beatBuffer;
    studioState.tracks[0].isLoaded = true;
    studioState.tracks[0].name = `🎵 ${beatTitle}`;
    
    renderStudioInterface();
    document.querySelector('.studio-selector').style.display = 'none';
    document.getElementById('multiTrackStudio').style.display = 'block';
    showToast('Beat loaded! Ready to record.', 'success');
    showPage('studio');
  } catch (error) {
    showToast('Error loading beat: ' + error.message, 'error');
  }
}

function renderStudioInterface() {
  const container = document.getElementById('trackContainer');
  if (!container) return;
  
  let html = '';
  for (let i = 0; i < 8; i++) {
    const track = studioState.tracks[i];
    html += `
      <div class="track" data-track-id="${i}">
        <div class="track-header">
          <div class="track-number">${i === 0 ? '🎵 BEAT' : `🎤 Track ${i}`}</div>
          <input type="text" class="track-name-input" value="${escapeHtml(track.name)}" onchange="updateTrackName(${i}, this.value)" ${i === 0 ? 'readonly' : ''}>
          <div class="track-controls">
            ${i > 0 ? `<button class="track-record" onclick="startRecordingToTrack(${i})" id="recordBtn${i}">● Record</button>` : ''}
            ${i > 0 ? `<button class="track-clear" onclick="clearTrack(${i})">🗑 Clear</button>` : ''}
            <button class="track-fx" onclick="openTrackFX(${i})">🎛 FX</button>
          </div>
        </div>
        <div class="track-waveform">
          <canvas id="waveform-${i}" width="100%" height="45"></canvas>
        </div>
        <div class="track-volume">
          <span>🔊</span>
          <input type="range" min="0" max="1" step="0.01" value="${track.volume}" onchange="updateTrackVolume(${i}, this.value)">
          <button class="track-solo" onclick="toggleSolo(${i})">Solo</button>
          <button class="track-mute" onclick="toggleMute(${i})">Mute</button>
        </div>
        <audio id="audio-${i}" controls style="display: ${track.isLoaded && track.audioUrl ? 'block' : 'none'}; width:100%; margin-top:8px;"></audio>
        ${i > 0 && !track.isLoaded ? `
          <input type="file" id="file-${i}" accept="audio/*" style="display:none" onchange="uploadTrackFile(${i}, this.files[0])">
          <button class="btn-secondary" style="margin-top:8px; width:100%" onclick="document.getElementById('file-${i}').click()">📁 Upload Audio File</button>
        ` : ''}
      </div>
    `;
  }
  container.innerHTML = html;
  
  for (let i = 0; i < 8; i++) {
    if (studioState.tracks[i].isLoaded && studioState.tracks[i].audioBuffer) {
      drawWaveform(i, studioState.tracks[i].audioBuffer);
    }
  }
}

function drawWaveform(trackId, audioBuffer) {
  const canvas = document.getElementById(`waveform-${trackId}`);
  if (!canvas) return;
  
  const width = canvas.parentElement.clientWidth - 20;
  const height = 45;
  canvas.width = width;
  canvas.height = height;
  
  const ctx = canvas.getContext('2d');
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const amp = height / 2;
  
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, width, height);
  ctx.beginPath();
  ctx.strokeStyle = '#667eea';
  ctx.lineWidth = 1.5;
  
  for (let i = 0; i < width; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const idx = Math.min(i * step + j, data.length - 1);
      const d = data[idx];
      if (d < min) min = d;
      if (d > max) max = d;
    }
    ctx.moveTo(i, (1 + min) * amp);
    ctx.lineTo(i, (1 + max) * amp);
  }
  ctx.stroke();
}

async function uploadTrackFile(trackId, file) {
  if (!file) return;
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await studioState.audioContext.decodeAudioData(arrayBuffer);
    const url = URL.createObjectURL(file);
    
    studioState.tracks[trackId].audioBuffer = audioBuffer;
    studioState.tracks[trackId].audioUrl = url;
    studioState.tracks[trackId].isLoaded = true;
    
    const audioEl = document.getElementById(`audio-${trackId}`);
    if (audioEl) {
      audioEl.src = url;
      audioEl.style.display = 'block';
    }
    drawWaveform(trackId, audioBuffer);
    showToast(`Track ${trackId} loaded!`, 'success');
  } catch (error) {
    showToast('Error loading file', 'error');
  }
}

// ================ METRONOME ================
let metronomeAudioContext = null;
let metronomeTimerId = null;

function initMetronome() {
  if (!metronomeAudioContext) metronomeAudioContext = new (window.AudioContext || window.webkitAudioContext());
  return metronomeAudioContext;
}

function playMetronomeTick() {
  const ctx = initMetronome();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.value = 0.3;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
  osc.stop(ctx.currentTime + 0.5);
}

function startMetronome() {
  if (!studioState.metronomeEnabled) return;
  if (metronomeTimerId) clearInterval(metronomeTimerId);
  const intervalMs = (60 / studioState.metronomeBPM) * 1000;
  metronomeTimerId = setInterval(() => {
    if (studioState.metronomeEnabled) playMetronomeTick();
  }, intervalMs);
}

function stopMetronome() {
  if (metronomeTimerId) {
    clearInterval(metronomeTimerId);
    metronomeTimerId = null;
  }
}

function toggleMetronome() {
  studioState.metronomeEnabled = document.getElementById('metronomeToggle')?.checked || false;
  if (studioState.metronomeEnabled && studioState.isPlaying) startMetronome();
  else if (!studioState.metronomeEnabled) stopMetronome();
}

function toggleCountIn() {
  studioState.countInEnabled = document.getElementById('countInToggle')?.checked || false;
}

function updateMetronomeBPM() {
  studioState.metronomeBPM = parseInt(document.getElementById('metronomeBPM')?.value) || 120;
  if (studioState.metronomeEnabled && studioState.isPlaying) {
    stopMetronome();
    startMetronome();
  }
}

// ================== RECORDING WITH SYNC ==================
async function startCountIn(callback) {
  if (!studioState.countInEnabled) {
    callback();
    return;
  }
  
  studioState.isCountInActive = true;
  const countInDisplay = document.getElementById('countInDisplay');
  const countInNumber = countInDisplay?.querySelector('.count-in-number');
  const countInText = countInDisplay?.querySelector('.count-in-text');
  
  if (countInDisplay) countInDisplay.style.display = 'flex';
  
  const ctx = initMetronome();
  const startTime = ctx.currentTime + 0.1;
  const beatDuration = 60 / studioState.metronomeBPM;
  
  for (let i = 4; i >= 1; i--) {
    if (countInNumber) countInNumber.textContent = i;
    if (countInText) countInText.textContent = i === 4 ? 'Get Ready...' : i === 1 ? 'Record Now!' : '';
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 1 ? 880 : 440;
    gain.gain.value = 0.4;
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const time = startTime + (4 - i) * beatDuration;
    osc.start(time);
    gain.gain.exponentialRampToValueAtTime(0.00001, time + 0.3);
    osc.stop(time + 0.3);
    
    await new Promise(r => setTimeout(r, beatDuration * 1000));
  }
  
  if (countInDisplay) countInDisplay.style.display = 'none';
  studioState.isCountInActive = false;
  callback();
}

async function startRecordingToTrack(trackNum) {
  if (studioState.isRecording) {
    stopRecordingToTrack();
    return;
  }
  
  if (studioState.isCountInActive) {
    showToast('Count in progress...', 'info');
    return;
  }
  
  studioState.currentRecordingTrack = trackNum;
  
  await startCountIn(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      studioState.mediaRecorder = new MediaRecorder(stream);
      studioState.audioChunks = [];
      
      studioState.mediaRecorder.ondataavailable = (e) => studioState.audioChunks.push(e.data);
      studioState.mediaRecorder.onstop = async () => {
        const blob = new Blob(studioState.audioChunks, { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await studioState.audioContext.decodeAudioData(arrayBuffer);
        
        studioState.tracks[trackNum].audioBuffer = audioBuffer;
        studioState.tracks[trackNum].audioUrl = url;
        studioState.tracks[trackNum].isLoaded = true;
        
        const audioEl = document.getElementById(`audio-${trackNum}`);
        if (audioEl) {
          audioEl.src = url;
          audioEl.style.display = 'block';
        }
        drawWaveform(trackNum, audioBuffer);
        
        stream.getTracks().forEach(t => t.stop());
        const btn = document.getElementById(`recordBtn${trackNum}`);
        if (btn) {
          btn.textContent = '● Record';
          btn.style.backgroundColor = '#ef4444';
        }
        showToast(`Recording saved to Track ${trackNum}`, 'success');
      };
      
      studioState.mediaRecorder.start();
      studioState.isRecording = true;
      studioState.recordingStartTime = Date.now();
      if (studioState.metronomeEnabled) startMetronome();
      playAllTracks();
      
      const btn = document.getElementById(`recordBtn${trackNum}`);
      if (btn) {
        btn.textContent = '⏹ Stop';
        btn.style.backgroundColor = '#f59e0b';
      }
      showToast('Recording...', 'info');
    } catch (error) {
      showToast('Microphone access denied', 'error');
    }
  });
}

function stopRecordingToTrack() {
  if (studioState.mediaRecorder && studioState.mediaRecorder.state === 'recording') {
    studioState.mediaRecorder.stop();
    studioState.isRecording = false;
    if (studioState.metronomeEnabled) stopMetronome();
  }
}

function prepareRecording() {
  if (!studioState.isOpen) {
    showToast('Open a beat first', 'error');
    return;
  }
  const availableTracks = studioState.tracks.slice(1).filter(t => !t.isLoaded);
  if (availableTracks.length === 0) {
    showToast('All tracks have audio. Clear a track first.', 'error');
    return;
  }
  startRecordingToTrack(availableTracks[0].id);
}

// ================== PLAYBACK ==================
async function playAllTracks() {
  if (studioState.isPlaying) {
    stopAllTracks();
    return;
  }
  
  if (studioState.audioContext.state === 'suspended') await studioState.audioContext.resume();
  
  const startTime = studioState.audioContext.currentTime;
  studioState.activeSources = [];
  studioState.activeGains = [];
  
  for (let i = 0; i < 8; i++) {
    const track = studioState.tracks[i];
    if (!track.isLoaded || !track.audioBuffer) continue;
    
    const hasSolo = studioState.tracks.some(t => t.solo);
    if (hasSolo && !track.solo) continue;
    if (track.muted) continue;
    
    const source = studioState.audioContext.createBufferSource();
    source.buffer = track.audioBuffer;
    const gain = studioState.audioContext.createGain();
    gain.gain.value = track.volume;
    
    source.connect(gain);
    gain.connect(studioState.audioContext.destination);
    source.start(startTime);
    
    studioState.activeSources.push(source);
    studioState.activeGains.push(gain);
  }
  
  studioState.isPlaying = true;
  const playBtn = document.getElementById('playBtn');
  if (playBtn) playBtn.textContent = '⏸ Pause';
  if (studioState.metronomeEnabled) startMetronome();
}

function stopAllTracks() {
  studioState.activeSources.forEach(s => {
    try { s.stop(); } catch(e) {}
  });
  studioState.activeSources = [];
  studioState.isPlaying = false;
  const playBtn = document.getElementById('playBtn');
  if (playBtn) playBtn.textContent = '▶ Play';
  if (studioState.metronomeEnabled) stopMetronome();
}

function updateTrackName(trackId, name) {
  studioState.tracks[trackId].name = name;
}

function updateTrackVolume(trackId, vol) {
  studioState.tracks[trackId].volume = parseFloat(vol);
}

function toggleSolo(trackId) {
  studioState.tracks.forEach(t => t.solo = (t.id === trackId));
  renderStudioInterface();
}

function toggleMute(trackId) {
  studioState.tracks[trackId].muted = !studioState.tracks[trackId].muted;
  renderStudioInterface();
}

function clearTrack(trackId) {
  if (trackId === 0) {
    showToast('Cannot delete beat track', 'error');
    return;
  }
  studioState.tracks[trackId].audioBuffer = null;
  studioState.tracks[trackId].audioUrl = null;
  studioState.tracks[trackId].isLoaded = false;
  const audioEl = document.getElementById(`audio-${trackId}`);
  if (audioEl) {
    audioEl.src = '';
    audioEl.style.display = 'none';
  }
  renderStudioInterface();
}

// ================== DOWNLOAD MIX FUNCTION ==================
async function downloadMix() {
  if (!studioState.isOpen) {
    showToast('Open a beat first', 'error');
    return;
  }
  
  const hasContent = studioState.tracks.some(t => t.isLoaded);
  if (!hasContent) {
    showToast('No tracks to export', 'error');
    return;
  }
  
  showModal('downloadProgressModal');
  const progressBar = document.getElementById('downloadProgress');
  const statusText = document.getElementById('downloadStatus');
  
  try {
    // Calculate total duration (max track length)
    let maxDuration = 0;
    for (const track of studioState.tracks) {
      if (track.isLoaded && track.audioBuffer) {
        maxDuration = Math.max(maxDuration, track.audioBuffer.duration);
      }
    }
    
    if (maxDuration === 0) {
      throw new Error('No audio data found');
    }
    
    statusText.textContent = 'Rendering mix...';
    if (progressBar) progressBar.style.width = '20%';
    
    // Create offline context for rendering
    const sampleRate = 44100;
    const offlineContext = new OfflineAudioContext(2, Math.ceil(maxDuration * sampleRate), sampleRate);
    
    // Add all tracks to the offline context
    let trackCount = 0;
    const hasSolo = studioState.tracks.some(t => t.solo);
    
    for (let i = 0; i < studioState.tracks.length; i++) {
      const track = studioState.tracks[i];
      if (!track.isLoaded || !track.audioBuffer) continue;
      if (hasSolo && !track.solo) continue;
      if (track.muted) continue;
      
      const bufferSource = offlineContext.createBufferSource();
      bufferSource.buffer = track.audioBuffer;
      
      const gainNode = offlineContext.createGain();
      gainNode.gain.value = track.volume;
      
      bufferSource.connect(gainNode);
      gainNode.connect(offlineContext.destination);
      
      bufferSource.start(0);
      trackCount++;
      
      if (progressBar) progressBar.style.width = `${30 + (i / studioState.tracks.length) * 40}%`;
    }
    
    if (trackCount === 0) {
      throw new Error('No active tracks to render');
    }
    
    statusText.textContent = 'Processing audio...';
    if (progressBar) progressBar.style.width = '70%';
    
    // Render the mix
    const renderedBuffer = await offlineContext.startRendering();
    
    statusText.textContent = 'Encoding...';
    if (progressBar) progressBar.style.width = '90%';
    
    // Convert to WAV and download
    const wavBlob = bufferToWav(renderedBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${studioState.currentBeatTitle || 'mix'}_8trax_mix.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    if (progressBar) progressBar.style.width = '100%';
    setTimeout(() => {
      closeModal('downloadProgressModal');
      showToast('Mix downloaded!', 'success');
    }, 500);
    
  } catch (error) {
    console.error('Download error:', error);
    closeModal('downloadProgressModal');
    showToast('Error exporting mix: ' + error.message, 'error');
  }
}

// Helper function to convert AudioBuffer to WAV
function bufferToWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  let samples = audioBuffer.getChannelData(0);
  let dataLength = samples.length * numChannels * (bitDepth / 8);
  let buffer = new ArrayBuffer(44 + dataLength);
  let view = new DataView(buffer);
  
  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  // Write audio data
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = (channel === 0) ? samples[i] : audioBuffer.getChannelData(channel)[i];
      let intSample = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// ================== FORK MIX FUNCTION ==================
function showForkModal() {
  if (!studioState.isOpen) {
    showToast('Open a beat first to fork', 'error');
    return;
  }
  
  const hasContent = studioState.tracks.slice(1).some(t => t.isLoaded);
  if (!hasContent) {
    showToast('Add your recordings before forking', 'error');
    return;
  }
  
  showModal('forkModal');
}

async function confirmFork() {
  const title = document.getElementById('forkTitle')?.value;
  const description = document.getElementById('forkDescription')?.value;
  const tags = document.getElementById('forkTags')?.value;
  
  closeModal('forkModal');
  showModal('downloadProgressModal');
  const statusText = document.getElementById('downloadStatus');
  const progressBar = document.getElementById('downloadProgress');
  
  try {
    statusText.textContent = 'Rendering fork mix...';
    if (progressBar) progressBar.style.width = '20%';
    
    // Render the complete mix
    let maxDuration = 0;
    for (const track of studioState.tracks) {
      if (track.isLoaded && track.audioBuffer) {
        maxDuration = Math.max(maxDuration, track.audioBuffer.duration);
      }
    }
    
    const sampleRate = 44100;
    const offlineContext = new OfflineAudioContext(2, Math.ceil(maxDuration * sampleRate), sampleRate);
    const mixData = { tracks: [] };
    
    const hasSolo = studioState.tracks.some(t => t.solo);
    
    for (let i = 0; i < studioState.tracks.length; i++) {
      const track = studioState.tracks[i];
      if (!track.isLoaded || !track.audioBuffer) continue;
      if (hasSolo && !track.solo) continue;
      if (track.muted) continue;
      
      const bufferSource = offlineContext.createBufferSource();
      bufferSource.buffer = track.audioBuffer;
      const gainNode = offlineContext.createGain();
      gainNode.gain.value = track.volume;
      
      bufferSource.connect(gainNode);
      gainNode.connect(offlineContext.destination);
      bufferSource.start(0);
      
      mixData.tracks.push({
        name: track.name,
        volume: track.volume,
        solo: track.solo,
        muted: track.muted
      });
      
      if (progressBar) progressBar.style.width = `${40 + (i / studioState.tracks.length) * 30}%`;
    }
    
    statusText.textContent = 'Processing fork...';
    const renderedBuffer = await offlineContext.startRendering();
    
    statusText.textContent = 'Saving fork...';
    if (progressBar) progressBar.style.width = '80%';
    
    // Convert to WAV
    const wavBlob = bufferToWav(renderedBuffer);
    const formData = new FormData();
    formData.append('mix', wavBlob, 'fork_mix.wav');
    
    // Create fork in backend
    const forkResult = await api.forkBeat(
      studioState.currentBeatId,
      { ...mixData, mixBuffer: renderedBuffer },
      title,
      description,
      tags
    );
    
    // Save the mixed audio file
    formData.append('versionId', forkResult.id);
    const saveResult = await api.saveMix(studioState.currentBeatId, forkResult.id, formData);
    
    if (progressBar) progressBar.style.width = '100%';
    
    setTimeout(() => {
      closeModal('downloadProgressModal');
      showToast('Fork created successfully!', 'success');
      document.getElementById('forkTitle').value = '';
      document.getElementById('forkDescription').value = '';
      document.getElementById('forkTags').value = '';
    }, 500);
    
  } catch (error) {
    console.error('Fork error:', error);
    closeModal('downloadProgressModal');
    showToast('Error creating fork: ' + error.message, 'error');
  }
}

function openTrackFX(trackId) {
  showModal('fxModal');
}

async function applyFX() {
  showToast('FX applied!', 'success');
  closeModal('fxModal');
}

function closeStudio() {
  stopAllTracks();
  if (studioState.audioContext) studioState.audioContext.close();
  studioState.isOpen = false;
  document.querySelector('.studio-selector').style.display = 'block';
  document.getElementById('multiTrackStudio').style.display = 'none';
  initStudioTracks();
}

// ======== BEAT DETAILS, COMMENTS, PROFILE, UPLOAD, SEARCH, UTILITIES ========
async function viewBeat(beatId) {
  try {
    const beat = await api.getBeat(beatId);
    currentBeatId = beatId;
    const comments = await api.getComments(beatId);
    const modalContent = document.getElementById('beatDetail');
    if (!modalContent) return;
    
    modalContent.innerHTML = `
      <h3>${escapeHtml(beat.title)}</h3>
      <p><strong>Producer:</strong> ${escapeHtml(beat.producerName)}</p>
      <p><strong>Genre:</strong> ${beat.genre} | <strong>BPM:</strong> ${beat.bpm}</p>
      <p>🎧 ${beat.plays} plays • ⬇️ ${beat.downloads} downloads • ⭐ ${beat.rating || 0}/5</p>
      <div class="beat-tags">${beat.tags?.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('') || ''}</div>
      <audio controls style="width:100%; margin:16px 0"><source src="${CONFIG.API_URL}${beat.fileUrl}"></audio>
      <div class="beat-actions">
        ${currentUser ? `
          <button onclick="downloadBeat('${beat.id}')" class="btn-primary">⬇️ Download</button>
          <button onclick="addToLibrary('${beat.id}')" class="btn-secondary">📚 Save</button>
          <button onclick="openStudio('${beat.id}', '${escapeHtml(beat.title)}', '${CONFIG.API_URL}${beat.fileUrl}')" class="btn-primary">🎙️ Record</button>
          <button onclick="showComments('${beatId}')" class="btn-secondary">💬 Comments (${comments.length})</button>
        ` : '<p>Login to interact</p>'}
      </div>
      <h4>Vocal Versions (${beat.versions?.length || 0})</h4>
      ${beat.versions?.map(v => `
        <div class="recording-item">
          <strong>${escapeHtml(v.title)}</strong> by ${escapeHtml(v.vocalistName)}${v.isFork ? '<span class="fork-badge">🍴 Fork</span>' : ''}<br>
          ⭐ ${v.rating?.toFixed(1) || 0}/5 (${v.votes?.length || 0} votes)
          <audio controls><source src="${CONFIG.API_URL}${v.fileUrl}"></audio>
          ${currentUser && currentUser.id !== v.vocalistId ? `
            <div class="vote-section">
              <select id="rating-${v.id}">
                <option value="1">1</option><option value="2">2</option><option value="3">3</option>
                <option value="4">4</option><option value="5">5</option>
              </select>
              <button onclick="voteForRecording('${v.id}')" class="btn-secondary">Vote</button>
            </div>
          ` : ''}
        </div>
      `).join('') || '<p>No vocal versions yet</p>'}
    `;
    showModal('beatModal');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function downloadBeat(beatId) {
  await api.downloadBeat(beatId);
  showToast('Download started!', 'success');
}

async function voteForRecording(recordingId) {
  const select = document.getElementById(`rating-${recordingId}`);
  if (!select) return;
  try {
    await api.vote(recordingId, parseInt(select.value));
    showToast('Vote recorded!', 'success');
    viewBeat(currentBeatId);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function showComments(beatId) {
  try {
    const comments = await api.getComments(beatId);
    const container = document.getElementById('commentsList');
    if (!container) return;
    
    container.innerHTML = comments.map(c => `
      <div class="comment-item">
        <div class="comment-avatar">${(c.displayName?.[0] || c.username?.[0]).toUpperCase()}</div>
        <div class="comment-content">
          <div class="comment-name">${escapeHtml(c.displayName || c.username)}</div>
          <div class="comment-text">${escapeHtml(c.comment)}</div>
          <div class="comment-actions">
            <button class="comment-like" onclick="likeComment('${c.id}')">❤️ ${c.likes?.length || 0}</button>
          </div>
        </div>
      </div>
    `).join('');
    
    window.currentCommentBeatId = beatId;
    showModal('commentModal');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function addComment() {
  const comment = document.getElementById('commentInput')?.value;
  if (!comment) return;
  try {
    await api.addComment(window.currentCommentBeatId, comment);
    document.getElementById('commentInput').value = '';
    showComments(window.currentCommentBeatId);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function likeComment(commentId) {
  try {
    await api.likeComment(commentId);
    showComments(window.currentCommentBeatId);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function viewProfile(username) {
  try {
    const user = await api.getUserProfile(username);
    const content = document.getElementById('profileContent');
    if (!content) return;
    
    content.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar">${(user.displayName?.[0] || user.username?.[0]).toUpperCase()}</div>
        <div class="profile-name">${escapeHtml(user.displayName || user.username)}</div>
        <div>@${escapeHtml(user.username)}</div>
        <div class="profile-stats">
          <div class="stat"><div class="stat-number">${user.uploadedBeatsCount || 0}</div><div class="stat-label">Beats</div></div>
          <div class="stat"><div class="stat-number">${user.recordingsCount || 0}</div><div class="stat-label">Recordings</div></div>
          <div class="stat"><div class="stat-number">${user.followers?.length || 0}</div><div class="stat-label">Followers</div></div>
        </div>
        ${user.bio ? `<div class="profile-bio">${escapeHtml(user.bio)}</div>` : ''}
        ${currentUser && currentUser.id !== user.id ? `<button onclick="followUser('${user.id}')" class="btn-primary">➕ Follow</button>` : ''}
      </div>
      <h3>My Beats</h3>
      <div class="beats-grid">
        ${user.uploadedBeats?.map(b => `
          <div class="beat-card" onclick="viewBeat('${b.id}')">
            <div class="beat-title">${escapeHtml(b.title)}</div>
            <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${b.fileUrl}"></audio>
          </div>
        `).join('') || '<p>No beats yet</p>'}
      </div>
      <h3>My Recordings</h3>
      <div class="beats-grid">
        ${user.recordings?.map(r => `
          <div class="beat-card" onclick="viewBeat('${r.beatId}')">
            <div class="beat-title">${escapeHtml(r.title)}${r.isFork ? '<span class="fork-badge">🍴 Fork</span>' : ''}</div>
            <div>⭐ ${r.rating?.toFixed(1) || 0}/5</div>
            <audio controls onclick="event.stopPropagation()"><source src="${CONFIG.API_URL}${r.fileUrl}"></audio>
          </div>
        `).join('') || '<p>No recordings yet</p>'}
      </div>
    `;
    showPage('profile');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function followUser(userId) {
  try {
    await api.followUser(userId);
    showToast('Followed!', 'success');
    if (currentUser) viewProfile(currentUser.username);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function uploadBeat() {
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
  
  const formData = new FormData();
  formData.append('beat', file);
  formData.append('title', title);
  formData.append('genre', genre);
  formData.append('bpm', bpm);
  formData.append('tags', tags);
  formData.append('description', description);
  
  try {
    await api.uploadBeat(formData);
    showToast('Beat uploaded!', 'success');
    document.getElementById('beatTitle').value = '';
    document.getElementById('beatBpm').value = '';
    document.getElementById('beatTags').value = '';
    document.getElementById('beatDescription').value = '';
    document.getElementById('beatFile').value = '';
    discoverMusic();
    showPage('discover');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function performSearch() {
  const query = document.getElementById('searchInput')?.value;
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

// ================ INITIALIZATION ================
document.addEventListener('DOMContentLoaded', async () => {
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
  
  document.querySelectorAll('.lib-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadLibrary(tab.dataset.lib);
    });
  });
  
  document.getElementById('searchBtn')?.addEventListener('click', () => showModal('searchModal'));
  document.getElementById('searchInput')?.addEventListener('input', performSearch);
  document.getElementById('messagesBtn')?.addEventListener('click', () => {
    if (currentUser) loadMessages();
    else showToast('Login to view messages', 'error');
  });
  
  initMetronome();
});

// Make functions global
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
window.uploadBeat = uploadBeat;
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
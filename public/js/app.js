// ==================== CONFIGURATION ====================
const CONFIG = {
  API_URL: '',
  STORAGE_KEYS: {
    TOKEN: '8trax_token',
    USER: '8trax_user'
  }
};

let currentUser = null;
let socket = null;
let currentUploadSession = null;
let uploadStartTime = null;

// ==================== API SERVICE ====================
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
  async getBeats() { return this.request('/api/beats'); }
  async addToLibrary(beatId) { return this.request('/api/library/add', { method: 'POST', body: { beatId } }); }
  
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

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#667eea';
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

// ==================== AUTHENTICATION ====================
async function register() {
  const username = document.getElementById('regUsername').value;
  const email = document.getElementById('regEmail').value;
  const displayName = document.getElementById('regDisplayName').value;
  const password = document.getElementById('regPassword').value;
  
  if (!username || !email || !password) {
    showToast('Please fill all fields', 'error');
    return;
  }
  
  try {
    const data = await api.register({ username, email, displayName, bio: '', password });
    localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN, data.token);
    localStorage.setItem(CONFIG.STORAGE_KEYS.USER, JSON.stringify(data.user));
    currentUser = data.user;
    updateUI();
    closeModal('registerModal');
    loadBeats();
    initSocket();
    showToast('Welcome to 8Trax!', 'success');
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
    loadBeats();
    initSocket();
    showToast('Welcome back!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function logout() {
  localStorage.clear();
  currentUser = null;
  if (socket) socket.disconnect();
  updateUI();
  loadBeats();
  showToast('Logged out', 'info');
}

function updateUI() {
  const authButtons = document.getElementById('authButtons');
  const userInfo = document.getElementById('userInfo');
  const userName = document.getElementById('userName');
  
  if (currentUser) {
    if (authButtons) authButtons.style.display = 'none';
    if (userInfo) {
      userInfo.style.display = 'block';
      if (userName) userName.textContent = currentUser.displayName || currentUser.username;
    }
  } else {
    if (authButtons) authButtons.style.display = 'block';
    if (userInfo) userInfo.style.display = 'none';
  }
}

function initSocket() {
  if (socket) return;
  socket = io();
  
  socket.on('uploadProgress', (data) => {
    if (data.sessionId === currentUploadSession) {
      updateProgressModal(data.progress);
    }
  });
  
  socket.on('uploadComplete', (data) => {
    if (data.sessionId === currentUploadSession) {
      closeModal('uploadModal');
      showToast('Upload completed successfully!', 'success');
      loadBeats();
      removeActiveUpload(data.sessionId);
      currentUploadSession = null;
    }
  });
  
  socket.on('uploadCancelled', (data) => {
    if (data.sessionId === currentUploadSession) {
      closeModal('uploadModal');
      showToast('Upload cancelled', 'info');
      removeActiveUpload(data.sessionId);
      currentUploadSession = null;
    }
  });
}

// ==================== UPLOAD FUNCTIONS ====================
function updateProgressModal(progress) {
  const fill = document.getElementById('modalProgressFill');
  const percentage = document.getElementById('modalPercentage');
  if (fill) fill.style.width = `${progress}%`;
  if (percentage) percentage.textContent = `${Math.round(progress)}%`;
}

function updateUploadStats(uploadedBytes, totalBytes, elapsedSeconds) {
  const speed = uploadedBytes / elapsedSeconds;
  const remainingBytes = totalBytes - uploadedBytes;
  const timeRemaining = remainingBytes / speed;
  
  return {
    speedFormatted: formatFileSize(speed) + '/s',
    timeRemainingFormatted: isFinite(timeRemaining) ? formatTime(timeRemaining) : 'Calculating...'
  };
}

function addActiveUpload(sessionId, fileName, progress) {
  const container = document.getElementById('uploadsList');
  const card = document.getElementById('activeUploadsCard');
  if (!container) return;
  
  if (card) card.style.display = 'block';
  
  let item = document.getElementById(`upload-${sessionId}`);
  if (!item) {
    item = document.createElement('div');
    item.id = `upload-${sessionId}`;
    item.className = 'upload-item';
    container.appendChild(item);
  }
  
  item.innerHTML = `
    <div class="upload-header">
      <span class="upload-filename">${escapeHtml(fileName)}</span>
      <span class="upload-status">Uploading ${Math.round(progress)}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${progress}%"></div>
    </div>
  `;
}

function removeActiveUpload(sessionId) {
  const item = document.getElementById(`upload-${sessionId}`);
  if (item) item.remove();
  
  const container = document.getElementById('uploadsList');
  const card = document.getElementById('activeUploadsCard');
  if (container && container.children.length === 0 && card) {
    card.style.display = 'none';
  }
}

async function uploadBeat() {
  if (!currentUser) {
    showToast('Please login first', 'error');
    return;
  }
  
  const title = document.getElementById('beatTitle').value;
  const genre = document.getElementById('beatGenre').value;
  const bpm = document.getElementById('beatBpm').value;
  const tags = document.getElementById('beatTags').value;
  const description = document.getElementById('beatDescription').value;
  const file = document.getElementById('beatFile').files[0];
  
  if (!title || !bpm || !file) {
    showToast('Please fill title, BPM, and select a file', 'error');
    return;
  }
  
  if (file.size > 100 * 1024 * 1024) {
    showToast('File too large. Max 100MB', 'error');
    return;
  }
  
  showModal('uploadModal');
  document.getElementById('modalFileName').textContent = file.name;
  
  try {
    const startResponse = await api.startUploadSession(file.name, file.size, 'beat');
    const sessionId = startResponse.sessionId;
    currentUploadSession = sessionId;
    uploadStartTime = Date.now();
    
    const chunkSize = 1024 * 1024; // 1MB chunks
    const totalChunks = Math.ceil(file.size / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      
      const formData = new FormData();
      formData.append('chunk', chunk);
      formData.append('sessionId', sessionId);
      formData.append('chunkIndex', i);
      formData.append('totalChunks', totalChunks);
      
      const uploadResponse = await api.uploadChunk(formData);
      
      const elapsed = (Date.now() - uploadStartTime) / 1000;
      const stats = updateUploadStats(uploadResponse.progress / 100 * file.size, file.size, elapsed);
      
      document.getElementById('modalSpeed').textContent = stats.speedFormatted;
      document.getElementById('modalTimeRemaining').textContent = stats.timeRemainingFormatted;
      
      addActiveUpload(sessionId, file.name, uploadResponse.progress);
    }
    
    await api.completeUpload(sessionId, { title, genre, bpm: parseInt(bpm), description, tags });
    
    document.getElementById('beatTitle').value = '';
    document.getElementById('beatBpm').value = '';
    document.getElementById('beatTags').value = '';
    document.getElementById('beatDescription').value = '';
    document.getElementById('beatFile').value = '';
    document.getElementById('fileInfo').textContent = '';
    
  } catch (error) {
    console.error('Upload error:', error);
    closeModal('uploadModal');
    showToast('Upload failed: ' + error.message, 'error');
    if (currentUploadSession) {
      await api.cancelUpload(currentUploadSession);
      removeActiveUpload(currentUploadSession);
      currentUploadSession = null;
    }
  }
}

async function cancelCurrentUpload() {
  if (currentUploadSession) {
    try {
      await api.cancelUpload(currentUploadSession);
      showToast('Upload cancelled', 'info');
      closeModal('uploadModal');
      removeActiveUpload(currentUploadSession);
      currentUploadSession = null;
    } catch (error) {
      showToast('Error cancelling upload', 'error');
    }
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== LOAD BEATS ====================
async function loadBeats() {
  try {
    const beats = await api.getBeats();
    const container = document.getElementById('beatsList');
    if (!container) return;
    
    if (!beats.length) {
      container.innerHTML = '<div class="empty-state">No beats yet. Upload the first beat!</div>';
      return;
    }
    
    container.innerHTML = beats.map(beat => `
      <div class="beat-card">
        <div class="beat-title">${escapeHtml(beat.title)}</div>
        <div class="beat-info">by ${escapeHtml(beat.producerName)} • ${beat.genre} • ${beat.bpm} BPM</div>
        <div class="beat-stats">🎧 ${beat.plays} plays • ⬇️ ${beat.downloads} downloads</div>
        <audio controls><source src="${CONFIG.API_URL}${beat.fileUrl}"></audio>
        ${currentUser ? `<button onclick="addToLibrary('${beat.id}')" style="margin-top: 10px; padding: 6px 12px;">📚 Save to Library</button>` : ''}
      </div>
    `).join('');
  } catch (error) {
    console.error(error);
  }
}

async function addToLibrary(beatId) {
  if (!currentUser) {
    showToast('Please login first', 'error');
    return;
  }
  try {
    await api.addToLibrary(beatId);
    showToast('Added to library!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==================== FILE INPUT HANDLER ====================
function setupFileInput() {
  const fileInput = document.getElementById('beatFile');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
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
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('App initializing...');
  
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
  await loadBeats();
  setupFileInput();
  
  // Setup event listeners
  const uploadBtn = document.getElementById('uploadBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', uploadBeat);
  }
  
  const cancelBtn = document.getElementById('cancelUploadBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelCurrentUpload);
  }
  
  const closeModalBtn = document.getElementById('closeUploadModalBtn');
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      if (currentUploadSession) {
        cancelCurrentUpload();
      } else {
        closeModal('uploadModal');
      }
    });
  }
  
  console.log('App initialized. uploadBeat function:', typeof uploadBeat);
});

// Make functions global for HTML onclick handlers
window.register = register;
window.login = login;
window.logout = logout;
window.showLoginModal = () => showModal('loginModal');
window.showRegisterModal = () => showModal('registerModal');
window.closeModal = closeModal;
window.addToLibrary = addToLibrary;
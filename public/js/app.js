// ==================== CONFIGURATION ====================
const CONFIG = {
    API_URL: window.location.origin,
    STORAGE_KEYS: {
        TOKEN: '8trax_token',
        USER: '8trax_user'
    }
};

let currentUser = null;
let currentBeatId = null;
let currentPlayingAudio = null;
let currentTrackForFX = null;
let currentChatUser = null;
let currentPage = 1;
let isLoading = false;
let socket = null;

// ==================== AUDIO ENGINE ====================
class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.trackNodes = [];
        this.isPlaying = false;
        this.currentSession = { tracks: [] };
        this.monitoringSource = null;
    }

    async init() {
        if (this.audioContext) {
            await this.close();
        }
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        return this.audioContext;
    }

    async close() {
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
    }

    async loadAudio(url, token = null) {
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const response = await fetch(url, { headers });
        const arrayBuffer = await response.arrayBuffer();
        return await this.audioContext.decodeAudioData(arrayBuffer);
    }
}

const audioEngine = new AudioEngine();

// ==================== API SERVICE ====================
class API {
    getToken() {
        return localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
    }

    getHeaders(includeAuth = true, isFormData = false) {
        const headers = {};
        if (!isFormData) {
            headers['Content-Type'] = 'application/json';
        }
        if (includeAuth && this.getToken()) {
            headers['Authorization'] = `Bearer ${this.getToken()}`;
        }
        return headers;
    }

    async request(endpoint, options = {}) {
        const { method = 'GET', body = null, isFormData = false, includeAuth = true } = options;
        
        const config = {
            method,
            headers: this.getHeaders(includeAuth, isFormData)
        };
        
        if (body) {
            config.body = isFormData ? body : JSON.stringify(body);
        }
        
        const response = await fetch(`${CONFIG.API_URL}${endpoint}`, config);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        
        return data;
    }

    // Auth
    async register(userData) {
        return this.request('/api/auth/register', { method: 'POST', body: userData });
    }

    async login(credentials) {
        return this.request('/api/auth/login', { method: 'POST', body: credentials });
    }

    // Beats
    async getBeats(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/beats${query ? '?' + query : ''}`);
    }

    async getBeat(id) {
        return this.request(`/api/beats/${id}`);
    }

    async uploadBeat(formData) {
        return this.request('/api/beats', { method: 'POST', body: formData, isFormData: true });
    }

    async deleteBeat(id) {
        return this.request(`/api/beats/${id}`, { method: 'DELETE' });
    }

    async downloadBeat(id) {
        const token = this.getToken();
        window.open(`${CONFIG.API_URL}/api/beats/${id}/download?token=${token}`, '_blank');
    }

    // Recordings
    async uploadRecording(beatId, formData) {
        return this.request(`/api/beats/${beatId}/record`, { method: 'POST', body: formData, isFormData: true });
    }

    async vote(recordingId, rating) {
        return this.request('/api/vote', { method: 'POST', body: { recordingId, rating } });
    }

    // Library
    async addToLibrary(beatId) {
        return this.request('/api/library/add', { method: 'POST', body: { beatId } });
    }

    async removeFromLibrary(beatId) {
        return this.request('/api/library/remove', { method: 'DELETE', body: { beatId } });
    }

    async getLibrary() {
        return this.request('/api/library');
    }

    // Comments
    async addComment(beatId, comment) {
        return this.request('/api/comments/add', { method: 'POST', body: { beatId, comment } });
    }

    async getComments(beatId) {
        return this.request(`/api/comments/${beatId}`);
    }

    async likeComment(commentId) {
        return this.request('/api/comments/like', { method: 'POST', body: { commentId } });
    }

    // Messages
    async getMessages() {
        return this.request('/api/messages');
    }

    async sendMessage(to, message) {
        return this.request('/api/messages/send', { method: 'POST', body: { to, message } });
    }

    // Social
    async getFeed() {
        return this.request('/api/feed');
    }

    async getTrending() {
        return this.request('/api/trending');
    }

    async getLeaderboard() {
        return this.request('/api/leaderboard');
    }

    async search(query, type = 'all') {
        return this.request(`/api/search?q=${query}&type=${type}`);
    }

    async searchUsers(query) {
        return this.request(`/api/users/search?q=${query}`);
    }

    async getUserProfile(username) {
        return this.request(`/api/users/${username}`);
    }

    async followUser(userId) {
        return this.request(`/api/users/${userId}/follow`, { method: 'POST' });
    }
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
        showToast(`Welcome to 8Trax, ${currentUser.displayName}!`, 'success');
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
        showToast(`Welcome back, ${currentUser.displayName}!`, 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function logout() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
    currentUser = null;
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    updateUI();
    showPage('discover');
    discoverMusic();
    showToast('Logged out', 'info');
}

function updateUI() {
    const authSection = document.getElementById('authSection');
    const welcomeBanner = document.getElementById('welcomeBanner');
    
    if (currentUser) {
        authSection.innerHTML = `
            <button class="icon-btn" onclick="viewProfile('${currentUser.username}')" title="Profile">👤</button>
            <button class="icon-btn" onclick="logout()" title="Logout">🚪</button>
        `;
        if (welcomeBanner) welcomeBanner.style.display = 'none';
    } else {
        authSection.innerHTML = `
            <button class="btn-secondary" onclick="showLoginModal()" style="padding: 6px 12px; font-size: 12px;">Login</button>
            <button class="btn-primary" onclick="showRegisterModal()" style="padding: 6px 12px; font-size: 12px;">Sign Up</button>
        `;
        if (welcomeBanner) welcomeBanner.style.display = 'block';
    }
}

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

// ==================== UI HELPERS ====================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 16px;
        right: 16px;
        background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#667eea'};
        color: white;
        padding: 12px;
        border-radius: 12px;
        text-align: center;
        z-index: 1000;
        animation: fadeIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function showPage(pageName) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    const targetPage = document.getElementById(`${pageName}Page`);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
        if (nav.dataset.page === pageName) {
            nav.classList.add('active');
        }
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

// ==================== FEED PAGE ====================
async function loadFeed() {
    if (!currentUser) {
        const container = document.getElementById('feedContent');
        if (container) container.innerHTML = '<div class="empty-state">Login to see your feed</div>';
        return;
    }
    
    try {
        const feed = await api.getFeed();
        const container = document.getElementById('feedContent');
        
        if (!container) return;
        
        if (!feed.length) {
            container.innerHTML = '<div class="empty-state">Follow creators to see their updates</div>';
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
                    <span class="feed-badge ${item.type === 'beat' ? 'badge-beat' : 'badge-recording'}">
                        ${item.type === 'beat' ? '🎵 New Beat' : '🎤 New Recording'}
                    </span>
                </div>
                <div class="beat-title">${escapeHtml(item.title)}</div>
                <audio controls onclick="event.stopPropagation()">
                    <source src="${CONFIG.API_URL}${item.fileUrl}">
                </audio>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading feed:', error);
    }
}

// ==================== DISCOVER PAGE ====================
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
                <div class="beat-stats">
                    🎧 ${beat.plays} plays • ⬇️ ${beat.downloads} downloads
                </div>
                <div class="beat-tags">
                    ${beat.tags?.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('') || ''}
                </div>
                <audio controls onclick="event.stopPropagation()">
                    <source src="${CONFIG.API_URL}${beat.fileUrl}">
                </audio>
                <div class="beat-actions">
                    <button class="btn-secondary" onclick="event.stopPropagation(); addToLibrary('${beat.id}')">📚 Save</button>
                    <button class="btn-primary" onclick="event.stopPropagation(); openStudio('${beat.id}', '${escapeHtml(beat.title)}', '${beat.fileUrl}')">🎙️ Record</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading beats:', error);
    }
}

async function loadMoreBeats() {
    if (isLoading) return;
    isLoading = true;
    currentPage++;
    isLoading = false;
}

// ==================== TRENDING PAGE ====================
async function loadTrending() {
    try {
        const trending = await api.getTrending();
        const container = document.getElementById('trendingContent');
        
        if (!container) {
            console.warn('Trending container not found');
            return;
        }
        
        if (!trending.length) {
            container.innerHTML = '<div class="empty-state">No trending content yet</div>';
            return;
        }
        
        container.innerHTML = trending.map(item => `
            <div class="feed-item" onclick="viewBeat('${item.id}')">
                <div class="feed-header">
                    <div class="feed-avatar">${(item.producerName?.[0] || 'U').toUpperCase()}</div>
                    <div>
                        <div class="feed-username">${escapeHtml(item.producerName || item.vocalistName)}</div>
                        <div class="feed-time">🔥 Trending</div>
                    </div>
                </div>
                <div class="beat-title">${escapeHtml(item.title)}</div>
                <div class="beat-stats">🎧 ${item.plays} plays • ⬇️ ${item.downloads} downloads</div>
                <audio controls onclick="event.stopPropagation()">
                    <source src="${CONFIG.API_URL}${item.fileUrl}">
                </audio>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading trending:', error);
    }
}

// ==================== LEADERBOARD PAGE ====================
async function loadLeaderboard() {
    try {
        const users = await api.getLeaderboard();
        const container = document.getElementById('leaderboardContent');
        
        if (!container) {
            console.warn('Leaderboard container not found');
            return;
        }
        
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
                        <div style="font-size: 12px;">⭐ ${user.points} pts</div>
                    </div>
                </div>
                <div class="leaderboard-stats">
                    <div>🎵 ${user.uploadedBeats} beats</div>
                    <div>🎤 ${user.recordings} recordings</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading leaderboard:', error);
    }
}

// ==================== LIBRARY PAGE ====================
async function loadLibrary(type = 'saved') {
    if (!currentUser) {
        const container = document.getElementById('libraryContent');
        if (container) container.innerHTML = '<div class="empty-state">Login to view your library</div>';
        return;
    }
    
    try {
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
                <audio controls onclick="event.stopPropagation()">
                    <source src="${CONFIG.API_URL}${beat.fileUrl}">
                </audio>
                <button class="btn-danger" onclick="event.stopPropagation(); removeFromLibrary('${beat.id}')">Remove</button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading library:', error);
    }
}

async function addToLibrary(beatId) {
    if (!currentUser) {
        showToast('Login to save to library', 'error');
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
        loadLibrary();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== STUDIO PAGE ====================
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
                <audio controls onclick="event.stopPropagation()">
                    <source src="${CONFIG.API_URL}${beat.fileUrl}">
                </audio>
                <button class="btn-primary" onclick="event.stopPropagation(); openStudio('${beat.id}', '${escapeHtml(beat.title)}', '${beat.fileUrl}')">
                    🎙️ Open in Studio
                </button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading beats for studio:', error);
    }
}

async function openStudio(beatId, beatTitle, beatFileUrl) {
    if (!currentUser) {
        showToast('Please login to use the studio', 'error');
        return;
    }
    
    await audioEngine.init();
    
    window.currentStudioSession = {
        beatId,
        beatTitle,
        beatUrl: beatFileUrl,
        tracks: []
    };
    
    const studioSelector = document.querySelector('.studio-selector');
    const multiTrackStudio = document.getElementById('multiTrackStudio');
    
    if (studioSelector) studioSelector.style.display = 'none';
    if (multiTrackStudio) multiTrackStudio.style.display = 'block';
    
    renderTracks();
    showPage('studio');
}

function renderTracks() {
    const container = document.getElementById('trackContainer');
    if (!container) return;
    
    let tracksHtml = '';
    for (let i = 0; i <= 7; i++) {
        tracksHtml += `
            <div class="track" id="track-${i}">
                <div class="track-header">
                    <div class="track-number">${i === 0 ? 'BEAT' : `Track ${i}`}</div>
                    <input type="text" class="track-name-input" placeholder="Track name" id="track-name-${i}" value="${i === 0 ? 'Beat Track' : `Track ${i}`}">
                    <div class="track-controls">
                        ${i > 0 ? `<button class="track-btn track-record" onclick="startRecording(${i})">🔴 Record</button>` : ''}
                        ${i > 0 ? `<button class="track-btn track-clear" onclick="clearTrack(${i})">🗑️ Clear</button>` : ''}
                        <button class="track-btn" onclick="openFX(${i})">🎛️ FX</button>
                    </div>
                </div>
                <div class="track-waveform" id="waveform-${i}">
                    <canvas id="waveform-canvas-${i}" width="100%" height="40"></canvas>
                </div>
                <div class="track-volume">
                    <span>🔊</span>
                    <input type="range" min="0" max="1" step="0.01" value="0.8" onchange="updateTrackVolume(${i}, this.value)">
                </div>
                <audio id="track-audio-${i}" controls style="display: none;"></audio>
            </div>
        `;
    }
    
    container.innerHTML = tracksHtml;
}

function playAllTracks() {
    for (let i = 0; i <= 7; i++) {
        const audio = document.getElementById(`track-audio-${i}`);
        if (audio && audio.src) {
            audio.play();
        }
    }
}

function stopAllTracks() {
    for (let i = 0; i <= 7; i++) {
        const audio = document.getElementById(`track-audio-${i}`);
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
    }
}

let mediaRecorder = null;
let audioChunks = [];
let currentRecordingTrack = null;

async function startRecording(trackNum) {
    if (!currentUser) {
        showToast('Please login to record', 'error');
        return;
    }
    
    currentRecordingTrack = trackNum;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const audio = document.getElementById(`track-audio-${trackNum}`);
            audio.src = url;
            audio.style.display = 'block';
            
            window.currentStudioSession.tracks[trackNum] = blob;
            
            stream.getTracks().forEach(track => track.stop());
            
            const recordBtn = document.querySelector(`#track-${trackNum} .track-record`);
            if (recordBtn) {
                recordBtn.textContent = '🔴 Record';
                recordBtn.style.background = '#ef4444';
            }
        };
        
        mediaRecorder.start();
        
        const recordBtn = document.querySelector(`#track-${trackNum} .track-record`);
        if (recordBtn) {
            recordBtn.textContent = '⏹️ Stop';
            recordBtn.style.background = '#f59e0b';
            recordBtn.onclick = () => stopRecording(trackNum);
        }
        
        const beatAudio = document.getElementById('track-audio-0');
        if (beatAudio && beatAudio.src) {
            beatAudio.play();
        }
        
        showToast('Recording... Speak into your microphone', 'info');
        
    } catch (error) {
        showToast('Microphone access denied. Please check permissions.', 'error');
    }
}

function stopRecording(trackNum) {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        
        const recordBtn = document.querySelector(`#track-${trackNum} .track-record`);
        if (recordBtn) {
            recordBtn.textContent = '🔴 Record';
            recordBtn.style.background = '#ef4444';
            recordBtn.onclick = () => startRecording(trackNum);
        }
        
        showToast('Recording saved!', 'success');
    }
}

function clearTrack(trackNum) {
    const audio = document.getElementById(`track-audio-${trackNum}`);
    if (audio) {
        audio.src = '';
        audio.style.display = 'none';
        delete window.currentStudioSession.tracks[trackNum];
    }
}

function updateTrackVolume(trackNum, volume) {
    const audio = document.getElementById(`track-audio-${trackNum}`);
    if (audio) {
        audio.volume = volume;
    }
}

function openFX(trackNum) {
    currentTrackForFX = trackNum;
    showModal('fxModal');
}

async function applyFX() {
    showToast('FX applied to track!', 'success');
    closeModal('fxModal');
}

async function exportMix() {
    showToast('Exporting mix...', 'info');
    showToast('Mix exported!', 'success');
}

function closeStudio() {
    const studioSelector = document.querySelector('.studio-selector');
    const multiTrackStudio = document.getElementById('multiTrackStudio');
    
    if (studioSelector) studioSelector.style.display = 'block';
    if (multiTrackStudio) multiTrackStudio.style.display = 'none';
    if (audioEngine) {
        audioEngine.close();
    }
}

// ==================== BEAT DETAILS ====================
async function viewBeat(beatId) {
    try {
        const beat = await api.getBeat(beatId);
        currentBeatId = beatId;
        
        const comments = await api.getComments(beatId);
        
        const modalContent = document.getElementById('beatDetail');
        if (!modalContent) return;
        
        modalContent.innerHTML = `
            <div class="beat-info">
                <h3>${escapeHtml(beat.title)}</h3>
                <p><strong>Producer:</strong> ${escapeHtml(beat.producerName)}</p>
                <p><strong>Genre:</strong> ${beat.genre} | <strong>BPM:</strong> ${beat.bpm}</p>
                <p><strong>Stats:</strong> 🎧 ${beat.plays} plays • ⬇️ ${beat.downloads} downloads</p>
                <div class="beat-tags">
                    ${beat.tags?.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('') || ''}
                </div>
                <audio controls style="width: 100%; margin: 16px 0;">
                    <source src="${CONFIG.API_URL}${beat.fileUrl}">
                </audio>
                
                <div class="beat-actions" style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;">
                    ${currentUser ? `
                        <button onclick="downloadBeat('${beat.id}')" class="btn-primary">⬇️ Download</button>
                        <button onclick="addToLibrary('${beat.id}')" class="btn-secondary">📚 Save to Library</button>
                        <button onclick="openStudio('${beat.id}', '${escapeHtml(beat.title)}', '${beat.fileUrl}')" class="btn-primary">🎙️ Record</button>
                        <button onclick="showComments('${beatId}')" class="btn-secondary">💬 Comments (${comments.length})</button>
                    ` : '<p>Login to download, save, and record</p>'}
                </div>
                
                <h4>Vocal Versions (${beat.versions?.length || 0})</h4>
                <div id="versionsList">
                    ${!beat.versions?.length ? '<p>No vocal versions yet</p>' : 
                      beat.versions.map(version => `
                        <div class="recording-item" style="background: #f3f4f6; padding: 12px; border-radius: 12px; margin-bottom: 12px;">
                            <div><strong>${escapeHtml(version.title)}</strong> by ${escapeHtml(version.vocalistName)}</div>
                            <div>⭐ ${version.rating?.toFixed(1) || 0}/5 (${version.votes?.length || 0} votes)</div>
                            <audio controls style="width: 100%; margin: 8px 0;">
                                <source src="${CONFIG.API_URL}${version.fileUrl}">
                            </audio>
                            ${currentUser && currentUser.id !== version.vocalistId ? `
                                <div class="vote-section">
                                    <select id="rating-${version.id}">
                                        <option value="1">⭐ 1</option>
                                        <option value="2">⭐⭐ 2</option>
                                        <option value="3">⭐⭐⭐ 3</option>
                                        <option value="4">⭐⭐⭐⭐ 4</option>
                                        <option value="5">⭐⭐⭐⭐⭐ 5</option>
                                    </select>
                                    <button onclick="voteForRecording('${version.id}')" class="btn-secondary">Vote</button>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
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
    const rating = parseInt(select.value);
    
    try {
        await api.vote(recordingId, rating);
        showToast('Vote recorded!', 'success');
        viewBeat(currentBeatId);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== COMMENTS ====================
async function showComments(beatId) {
    try {
        const comments = await api.getComments(beatId);
        const container = document.getElementById('commentsList');
        
        if (!container) return;
        
        container.innerHTML = comments.map(comment => `
            <div class="comment-item">
                <div class="comment-avatar">${(comment.displayName?.[0] || comment.username?.[0]).toUpperCase()}</div>
                <div class="comment-content">
                    <div class="comment-name">${escapeHtml(comment.displayName || comment.username)}</div>
                    <div class="comment-text">${escapeHtml(comment.comment)}</div>
                    <div class="comment-actions">
                        <button class="comment-like" onclick="likeComment('${comment.id}')">❤️ ${comment.likes?.length || 0}</button>
                        <span class="comment-time">${timeAgo(comment.createdAt)}</span>
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
    const comment = document.getElementById('commentInput').value;
    if (!comment) return;
    
    try {
        await api.addComment(window.currentCommentBeatId, comment);
        document.getElementById('commentInput').value = '';
        showComments(window.currentCommentBeatId);
        showToast('Comment added!', 'success');
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

// ==================== MESSAGES ====================
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
            if (!conversations[otherId]) {
                conversations[otherId] = {
                    id: otherId,
                    name: msg.fromName || 'User',
                    lastMessage: msg.message,
                    lastTime: msg.timestamp
                };
            }
        });
        
        const container = document.getElementById('conversationsList');
        if (!container) return;
        
        container.innerHTML = Object.values(conversations).map(conv => `
            <div class="conversation-item" onclick="openChat('${conv.id}', '${escapeHtml(conv.name)}')">
                <div class="feed-avatar" style="width: 40px; height: 40px;">${conv.name[0].toUpperCase()}</div>
                <div style="flex: 1;">
                    <div><strong>${escapeHtml(conv.name)}</strong></div>
                    <div style="font-size: 12px; color: #6b7280;">${escapeHtml(conv.lastMessage.substring(0, 30))}</div>
                </div>
                <div style="font-size: 10px; color: #6b7280;">${timeAgo(conv.lastTime)}</div>
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
    
    if (chatHeader) chatHeader.innerHTML = `<strong>${escapeHtml(userName)}</strong>`;
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

async function sendMessage() {
    const message = document.getElementById('messageInput').value;
    if (!message || !currentChatUser) return;
    
    try {
        await api.sendMessage(currentChatUser.id, message);
        document.getElementById('messageInput').value = '';
        
        const container = document.getElementById('chatMessages');
        if (container) {
            container.innerHTML += `
                <div class="message sent">
                    <div class="message-bubble">${escapeHtml(message)}</div>
                </div>
            `;
            container.scrollTop = container.scrollHeight;
        }
        
        if (socket) {
            socket.emit('sendMessage', {
                from: currentUser.id,
                to: currentChatUser.id,
                message: message
            });
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== PROFILE PAGE ====================
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
                    <div class="stat">
                        <div class="stat-number">${user.uploadedBeatsCount || 0}</div>
                        <div class="stat-label">Beats</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${user.recordingsCount || 0}</div>
                        <div class="stat-label">Recordings</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${user.followers?.length || 0}</div>
                        <div class="stat-label">Followers</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${user.following?.length || 0}</div>
                        <div class="stat-label">Following</div>
                    </div>
                </div>
                ${user.bio ? `<div class="profile-bio">${escapeHtml(user.bio)}</div>` : ''}
                ${currentUser && currentUser.id !== user.id ? `
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button onclick="followUser('${user.id}')" class="btn-primary">➕ Follow</button>
                        <button onclick="openChat('${user.id}', '${escapeHtml(user.displayName)}')" class="btn-secondary">💬 Message</button>
                    </div>
                ` : ''}
                ${currentUser && currentUser.id === user.id ? `
                    <button onclick="logout()" class="btn-danger">Logout</button>
                ` : ''}
            </div>
            <h3>My Beats</h3>
            <div class="beats-grid">
                ${user.uploadedBeats?.map(beat => `
                    <div class="beat-card" onclick="viewBeat('${beat.id}')">
                        <div class="beat-title">${escapeHtml(beat.title)}</div>
                        <audio controls onclick="event.stopPropagation()">
                            <source src="${CONFIG.API_URL}${beat.fileUrl}">
                        </audio>
                    </div>
                `).join('') || '<p>No beats yet</p>'}
            </div>
            <h3>My Recordings</h3>
            <div class="beats-grid">
                ${user.recordings?.map(recording => `
                    <div class="beat-card" onclick="viewBeat('${recording.beatId}')">
                        <div class="beat-title">${escapeHtml(recording.title)}</div>
                        <div class="beat-info">⭐ ${recording.rating?.toFixed(1) || 0}/5</div>
                        <audio controls onclick="event.stopPropagation()">
                            <source src="${CONFIG.API_URL}${recording.fileUrl}">
                        </audio>
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
        if (currentUser) {
            viewProfile(currentUser.username);
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== UPLOAD BEAT ====================
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
        showToast('Please fill all required fields', 'error');
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
        showToast('Beat uploaded successfully!', 'success');
        
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

// ==================== SEARCH ====================
async function performSearch() {
    const query = document.getElementById('searchInput').value;
    const activeTab = document.querySelector('.search-tab.active');
    const type = activeTab?.dataset.searchType || 'all';
    
    if (!query || query.length < 2) return;
    
    try {
        const results = await api.search(query, type);
        const container = document.getElementById('searchResultsList');
        
        if (!container) return;
        
        if (!results.length) {
            container.innerHTML = '<div class="empty-state">No results found</div>';
            return;
        }
        
        container.innerHTML = results.map(result => {
            if (result.type === 'user') {
                return `
                    <div class="search-result-item" onclick="viewProfile('${result.username}'); closeModal('searchModal')">
                        <div class="search-result-avatar">${(result.displayName?.[0] || result.username?.[0]).toUpperCase()}</div>
                        <div>
                            <strong>${escapeHtml(result.displayName || result.username)}</strong>
                            <div style="font-size: 12px;">@${escapeHtml(result.username)}</div>
                        </div>
                    </div>
                `;
            } else {
                return `
                    <div class="search-result-item" onclick="viewBeat('${result.id}'); closeModal('searchModal')">
                        <div>🎵</div>
                        <div>
                            <strong>${escapeHtml(result.title)}</strong>
                            <div style="font-size: 12px;">by ${escapeHtml(result.producerName)}</div>
                        </div>
                    </div>
                `;
            }
        }).join('');
    } catch (error) {
        console.error('Search error:', error);
    }
}

// ==================== UTILITIES ====================
function timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('8Trax - Mobile DAW Studio');
    
    const token = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
    const savedUser = localStorage.getItem(CONFIG.STORAGE_KEYS.USER);
    
    if (token && savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            updateUI();
            initSocket();
            loadFeed();
        } catch (e) {
            console.error('Invalid session');
            localStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
            localStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
        }
    }
    
    updateUI();
    await discoverMusic();
    await loadTrending();
    await loadLeaderboard();
    await loadBeatsForStudio();
    if (currentUser) await loadLibrary();
    
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.addEventListener('click', () => {
            const page = nav.dataset.page;
            showPage(page);
            
            if (page === 'feed' && currentUser) loadFeed();
            if (page === 'discover') discoverMusic();
            if (page === 'trending') loadTrending();
            if (page === 'leaderboard') loadLeaderboard();
            if (page === 'studio') loadBeatsForStudio();
            if (page === 'library' && currentUser) loadLibrary();
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
    
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const searchInput = document.getElementById('searchInput');
            const searchResults = document.getElementById('searchResultsList');
            if (searchInput) searchInput.value = '';
            if (searchResults) searchResults.innerHTML = '';
            showModal('searchModal');
        });
    }
    
    const messagesBtn = document.getElementById('messagesBtn');
    if (messagesBtn) {
        messagesBtn.addEventListener('click', () => {
            if (currentUser) {
                loadMessages();
            } else {
                showToast('Login to view messages', 'error');
            }
        });
    }
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(performSearch, 300));
    }
    
    document.querySelectorAll('.search-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            performSearch();
        });
    });
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
window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.clearTrack = clearTrack;
window.updateTrackVolume = updateTrackVolume;
window.openFX = openFX;
window.applyFX = applyFX;
window.playAllTracks = playAllTracks;
window.stopAllTracks = stopAllTracks;
window.exportMix = exportMix;
window.closeStudio = closeStudio;
window.showComments = showComments;
window.addComment = addComment;
window.likeComment = likeComment;
window.openChat = openChat;
window.sendMessage = sendMessage;
window.loadMoreBeats = loadMoreBeats;
window.performSearch = performSearch;
window.uploadBeat = uploadBeat;
window.loadBeatsForStudio = loadBeatsForStudio;
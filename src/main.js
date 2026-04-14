import './style.css';

const API_BASE = '/api';
let currentActiveTranslationId = null;
let authToken = localStorage.getItem('token');
let currentTheme = 'default';
let activeLangCode = 'it';
let activeLangName = 'Italian';

// Language code -> name map
const LANG_NAMES = {
  it: 'Italian', es: 'Spanish', fr: 'French', de: 'German',
  ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', zh: 'Chinese',
  ar: 'Arabic', hi: 'Hindi', ru: 'Russian', nl: 'Dutch'
};

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  if (authToken) showApp();
  else showLogin();

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('token');
    authToken = null;
    document.body.className = 'has-login';
    showLogin();
  });

  // Dashboard quick actions
  document.getElementById('btn-new-translation')?.addEventListener('click', () => {
    document.querySelector('.nav-links a[data-target="workspace"]').click();
  });
  document.getElementById('quick-ai-translate')?.addEventListener('click', () => {
    document.querySelector('.nav-links a[data-target="ai-hub"]').click();
  });
  document.getElementById('quick-workspace')?.addEventListener('click', () => {
    document.querySelector('.nav-links a[data-target="workspace"]').click();
  });

  // Language explorer buttons
  document.querySelectorAll('.nav-redirect-workspace').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const lang = e.target.getAttribute('data-lang');
      const name = e.target.getAttribute('data-name');
      if (lang && name) {
        activeLangCode = lang;
        activeLangName = name;
        const label = document.getElementById('ws-target-lang-label');
        if (label) label.innerText = name;
      }
      document.querySelector('.nav-links a[data-target="workspace"]').click();
    });
  });

  setupProfileEdit();
  setupShopActions();
  setupAITranslation();

  // Guest login
  document.getElementById('guest-login-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('guest-login-btn');
    const ogText = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Launching...';
    try {
      const res = await fetch(`${API_BASE}/auth/guest`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('token', data.token);
        authToken = data.token;
        showApp();
      }
    } catch (err) {
      alert("Guest mode unavailable. Is the server running?");
    } finally {
      btn.innerHTML = ogText;
    }
  });
});

// Google OAuth callback
window.handleCredentialResponse = async (response) => {
  try {
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem('token', data.token);
      authToken = data.token;
      showApp();
    } else {
      alert("Authentication failed.");
    }
  } catch (err) {
    alert("Network error reaching backend.");
  }
};

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.body.classList.add('has-login');
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.body.classList.remove('has-login');
  initApp();
}

function setupNavigation() {
  const navLinks = document.querySelectorAll('.nav-links a');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.main-app-screen').forEach(s => s.classList.remove('active-screen'));
      link.classList.add('active');
      const targetId = link.getAttribute('data-target');
      document.getElementById(targetId)?.classList.add('active-screen');
      
      if (targetId === 'review') loadReviews();
      if (targetId === 'leaderboard') loadLeaderboard();
      if (targetId === 'workspace') loadTranslations();
    });
  });
}

async function initApp() {
  await loadProfile();
  await loadTranslations();
  setupTranslationSubmit();
}

const getAvatar = (url, name) => url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=random`;

// ─── AI TRANSLATION ─────────────────────────────────────────────
function setupAITranslation() {
  const translateBtn = document.getElementById('btn-ai-translate');
  const inputField = document.getElementById('ai-translate-input');
  const langSelect = document.getElementById('ai-translate-lang');
  const resultDiv = document.getElementById('ai-translate-result');
  const emptyState = document.getElementById('ai-empty-state');
  const copyBtn = document.getElementById('btn-copy-result');
  const resultText = document.getElementById('ai-result-text');
  const resultLangLabel = document.getElementById('ai-result-lang-name');

  if (!translateBtn) return;

  // Copy button
  copyBtn?.addEventListener('click', () => {
    const text = resultText?.innerText;
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = '<i class="ph ph-check"></i>';
        setTimeout(() => { copyBtn.innerHTML = '<i class="ph ph-copy"></i>'; }, 1500);
      });
    }
  });

  translateBtn.addEventListener('click', async () => {
    const text = inputField.value.trim();
    const targetLang = langSelect.value;
    // Extract clean language name (remove flag emoji)
    const rawName = langSelect.options[langSelect.selectedIndex].text;
    const cleanName = rawName.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
    
    if (!text) {
      inputField.style.borderColor = 'var(--color-danger)';
      inputField.focus();
      setTimeout(() => { inputField.style.borderColor = ''; }, 1500);
      return;
    }

    const ogText = translateBtn.innerHTML;
    translateBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Translating...';
    translateBtn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/translate/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ text, targetLang })
      });
      const data = await res.json();
      
      if (res.ok && data.aiTranslation) {
        resultDiv.style.display = 'block';
        resultDiv.classList.add('fade-in');
        if (emptyState) emptyState.style.display = 'none';
        resultLangLabel.innerText = data.langName || cleanName;
        resultText.innerText = data.aiTranslation;
        inputField.value = '';
      } else {
        const errorMsg = data.error || "Translation failed. Try again.";
        showToast(errorMsg, 'error');
      }
    } catch(err) {
      showToast("Network error. Make sure the server is running.", 'error');
    } finally {
      translateBtn.innerHTML = ogText;
      translateBtn.disabled = false;
    }
  });

  // Enter key support
  inputField?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      translateBtn.click();
    }
  });
}

// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.style.cssText = `
    position: fixed; bottom: 2rem; right: 2rem; z-index: 9999;
    padding: 1rem 1.5rem; border-radius: 12px; font-size: 0.9rem;
    font-family: 'Inter', sans-serif; font-weight: 500; max-width: 400px;
    animation: fadeIn 0.3s ease; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    ${type === 'error' 
      ? 'background: rgba(220,38,38,0.9); color: white; border: 1px solid rgba(255,255,255,0.1);' 
      : 'background: rgba(99,102,241,0.9); color: white; border: 1px solid rgba(255,255,255,0.1);'}
  `;
  toast.innerHTML = `<i class="ph ph-${type === 'error' ? 'warning-circle' : 'info'}"></i> ${message}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── PROFILE ────────────────────────────────────────────────────
async function loadProfile() {
  try {
    const res = await fetch(`${API_BASE}/profile`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) {
      if(res.status === 401) { localStorage.removeItem('token'); showLogin(); }
      return;
    }
    const data = await res.json();
    
    if (data.theme === 'golden') document.body.className = 'theme-golden';
    else document.body.className = '';
    
    const nameSplit = data.name ? data.name.split(' ') : ['User'];
    document.getElementById('nav-user-name').innerText = nameSplit[0];
    document.getElementById('nav-user-level').innerText = `Level ${data.level}`;
    document.getElementById('nav-user-avatar').src = getAvatar(data.avatar, data.name);
    
    document.getElementById('stat-global').innerText = data.globalTranslations !== undefined ? data.globalTranslations.toLocaleString() : '0';
    document.getElementById('stat-contributions').innerText = data.contributions || 0;
    const streakVal = data.streak || 1;
    document.getElementById('stat-streak').innerText = streakVal + (streakVal === 1 ? ' Day' : ' Days');
    
    let xpLimit = data.level * 500;
    const xpLeft = xpLimit - data.xp;
    document.getElementById('dashboard-subtitle').innerText = `Welcome back! ${xpLeft > 0 ? xpLeft + ' XP to next level.' : 'Ready to level up!'}`;

    // Profile Settings
    document.getElementById('profile-display-name').innerText = data.name || "User";
    document.getElementById('profile-display-email').innerText = data.email || "No Email";
    document.getElementById('profile-display-langs').innerText = `Native: ${data.nativeLanguage || 'English'} · Specialization: ${data.learningLanguages || 'Italian'}`;
    document.getElementById('profile-picture').src = getAvatar(data.avatar, data.name);
    document.getElementById('profile-level-badge').innerText = `Level ${data.level}`;
    document.getElementById('profile-xp-badge').innerText = `${data.xp} XP`;
    
    // Shop Wallet
    document.getElementById('shop-wallet').innerText = data.xp;

    // Forms
    document.getElementById('edit-name').value = data.name || "";
    document.getElementById('edit-native-lang').value = data.nativeLanguage || 'English';
    document.getElementById('edit-learning-lang').value = data.learningLanguages || 'Italian';
  } catch (err) {
    console.warn("Profile fetch error:", err);
  }
}

function setupProfileEdit() {
  const form = document.getElementById('profile-edit-form');
  const btn = document.getElementById('btn-save-profile');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ogHtml = btn.innerHTML;
      btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Saving...';
      try {
        const payload = {
          name: document.getElementById('edit-name').value,
          nativeLanguage: document.getElementById('edit-native-lang').value,
          learningLanguages: document.getElementById('edit-learning-lang').value
        };
        const res = await fetch(`${API_BASE}/profile/edit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          btn.innerHTML = '<i class="ph ph-check"></i> Saved';
          btn.style.background = 'var(--color-success)';
          await loadProfile();
          showToast('Profile updated successfully!');
        }
      } finally {
        setTimeout(() => { btn.innerHTML = ogHtml; btn.style.background = ''; }, 2000);
      }
    });
  }
}

// ─── LEADERBOARD ────────────────────────────────────────────────
async function loadLeaderboard() {
  try {
    const res = await fetch(`${API_BASE}/leaderboard`);
    const data = await res.json();
    const list = document.querySelector('.rank-list');
    list.innerHTML = '';

    if (data.length === 0) {
      list.innerHTML = '<li style="padding: 2rem; text-align: center; color: var(--color-text-muted);">No rankings yet. Start translating to be the first!</li>';
      return;
    }

    data.forEach((user, idx) => {
      const medals = ['🥇', '🥈', '🥉'];
      const rankDisplay = idx < 3 ? medals[idx] : `${idx + 1}`;
      list.innerHTML += `
        <li style="display:flex; align-items:center; gap: 1.25rem; padding: 1.1rem 1.5rem; border-bottom: 1px solid var(--glass-border); transition: 0.3s;" class="pulse-hover">
          <strong style="font-size: 1.3rem; width: 35px; text-align:center;">${rankDisplay}</strong>
          <img src="${getAvatar(user.avatar, user.name)}" referrerpolicy="no-referrer" style="width: 44px; height: 44px; border-radius: 50%;">
          <div style="flex: 1">
            <div style="font-weight: 600; font-size: 1rem">${user.name}</div>
            <div style="font-size: 0.8rem; color: var(--color-primary-light);">Level ${user.level}</div>
          </div>
          <div style="font-weight: 700; font-size: 1.1rem;">${user.score.toLocaleString()} XP</div>
        </li>
      `;
    });
  } catch (err) {}
}

// ─── WORKSPACE ──────────────────────────────────────────────────
async function loadTranslations() {
  try {
    const res = await fetch(`${API_BASE}/tasks/pending`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const task = await res.json();
    if (task) {
      currentActiveTranslationId = task.id;
      document.getElementById('ws-source').value = task.english || "";
      document.getElementById('ws-ai').value = task.automatedItalian || "";
      document.getElementById('ws-input').value = '';
    }
  } catch (err) {}
}

function setupTranslationSubmit() {
  const submitBtn = document.querySelector('.submit-btn');
  if (!submitBtn) return;
  const targetText = document.getElementById('ws-input');
  const freshBtn = submitBtn.cloneNode(true);
  submitBtn.parentNode.replaceChild(freshBtn, submitBtn);

  freshBtn.addEventListener('click', async () => {
    const text = targetText.value.trim();
    if (!text) {
      targetText.style.borderColor = 'var(--color-danger)';
      targetText.parentNode.classList.add('shake');
      setTimeout(() => { targetText.style.borderColor = ''; targetText.parentNode.classList.remove('shake'); }, 500);
      return;
    }
    
    const ogHtml = freshBtn.innerHTML;
    freshBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Submitting...';
    try {
      const res = await fetch(`${API_BASE}/translations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ sourceId: currentActiveTranslationId, text, targetLanguage: activeLangCode })
      });
      if (res.ok) {
        freshBtn.innerHTML = '<i class="ph ph-check-circle"></i> +50 XP!';
        freshBtn.style.background = 'var(--color-success)';
        await loadProfile();
        showToast('Translation submitted! +50 XP earned.');
        setTimeout(async () => { freshBtn.innerHTML = ogHtml; freshBtn.style.background = ''; await loadTranslations(); }, 1500);
      }
    } catch(err) {
      freshBtn.innerHTML = 'Error';
      showToast('Failed to submit. Try again.', 'error');
    }
  });
}

// ─── SHOP ───────────────────────────────────────────────────────
function setupShopActions() {
  document.querySelectorAll('.select-shop-item').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const item = e.target.getAttribute('data-item');
      const cost = parseInt(e.target.getAttribute('data-cost'));
      const og = e.target.innerHTML;
      e.target.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
      
      try {
        const res = await fetch(`${API_BASE}/shop/buy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ itemName: item, cost })
        });
        const data = await res.json();
        if (res.ok) {
          e.target.innerHTML = 'Unlocked!';
          e.target.style.background = 'var(--color-success)';
          e.target.style.color = '#fff';
          await loadProfile();
          showToast(data.message || 'Item unlocked!');
        } else {
          showToast(data.error || 'Purchase failed.', 'error');
        }
      } finally {
        setTimeout(() => { e.target.innerHTML = og; e.target.style.background = ''; e.target.style.color = ''; }, 3000);
      }
    });
  });
}

// ─── PEER REVIEWS ───────────────────────────────────────────────
async function loadReviews() {
  const container = document.getElementById('review-feed-container');
  try {
    const res = await fetch(`${API_BASE}/reviews`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const reviews = await res.json();
    container.innerHTML = '';
    
    if(reviews.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:3rem; color:var(--color-text-muted)">
          <i class="ph ph-users-three" style="font-size: 2.5rem; opacity: 0.4; display: block; margin-bottom: 1rem;"></i>
          No peer translations to review yet. Go to the Workspace to submit one!
        </div>`;
      return;
    }

    reviews.forEach(r => {
      const langName = LANG_NAMES[r.targetLanguage] || 'Translation';
      const voteHTML = r.hasVoted 
        ? `<button class="upvote-btn voted"><i class="ph ph-caret-up"></i> ${r.upvotes} Voted</button>`
        : `<button class="upvote-btn render-vote" data-id="${r.id}"><i class="ph ph-caret-up"></i> ${r.upvotes} Upvote</button>`;
        
      container.innerHTML += `
        <div class="glass-card review-card pulse-hover">
            <div class="header">
                <img src="${getAvatar(r.avatar, r.name)}" referrerpolicy="no-referrer" />
                <div>
                    <strong style="color: var(--color-primary-light)">${r.name}</strong>
                    <span style="font-size: 0.8rem; color: var(--color-text-muted);"> · ${langName}</span>
                </div>
            </div>
            <div class="source-quote">${r.sourceText}</div>
            <div class="review-text">${r.translatedText}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid var(--glass-border); padding-top: 0.75rem;">
                <span style="font-size: 0.8rem; color: var(--color-text-muted)"><i class="ph ph-users"></i> Community verification</span>
                ${voteHTML}
            </div>
        </div>
      `;
    });

    document.querySelectorAll('.render-vote').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        e.currentTarget.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
        const res = await fetch(`${API_BASE}/translations/${id}/vote`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if(res.ok) {
           await loadReviews();
           showToast('Vote recorded! +10 XP to translator.');
        }
      });
    });

  } catch (err) {}
}

import './style.css';

const API_BASE = '/api';
let currentActiveTranslationId = null;
let authToken = localStorage.getItem('token');
let currentTheme = 'default';

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  if (authToken) showApp();
  else showLogin();

  document.getElementById('logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('token');
    authToken = null;
    document.body.className = 'has-login';
    showLogin();
  });

  document.getElementById('btn-new-translation')?.addEventListener('click', () => {
    document.querySelector('.nav-links a[data-target="workspace"]').click();
  });

  document.querySelectorAll('.nav-redirect-workspace').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.nav-links a[data-target="workspace"]').click();
    });
  });

  setupProfileEdit();
  setupShopActions();

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
      alert("Guest mode unavailable.");
    } finally {
      btn.innerHTML = ogText;
    }
  });
});

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
      
      // Auto-load respective dynamic data
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

// Fallback avatar handling
const getAvatar = (url, name) => url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=random`;

async function loadProfile() {
  try {
    const res = await fetch(`${API_BASE}/profile`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) {
      if(res.status === 401) { localStorage.removeItem('token'); showLogin(); }
      return;
    }
    const data = await res.json();
    
    // Theme application
    if (data.theme === 'golden') document.body.className = 'theme-golden';
    else document.body.className = '';
    
    const nameSplit = data.name ? data.name.split(' ') : ['User'];
    document.getElementById('nav-user-name').innerText = nameSplit[0];
    document.getElementById('nav-user-level').innerText = `Level ${data.level}`;
    document.getElementById('nav-user-avatar').src = getAvatar(data.avatar, data.name);
    
    document.getElementById('stat-global').innerText = data.globalTranslations !== undefined ? data.globalTranslations.toLocaleString() : '0';
    document.getElementById('stat-contributions').innerText = data.contributions || 0;
    document.getElementById('stat-streak').innerText = (data.streak || 1) + ' Days';
    
    let xpLimit = data.level * 500;
    const xpLeft = xpLimit - data.xp;
    document.getElementById('dashboard-subtitle').innerText = `Keep translating. ${xpLeft > 0 ? xpLeft : 0} XP to level up.`;

    // Profile Settings View
    document.getElementById('profile-display-name').innerText = data.name || "User";
    document.getElementById('profile-display-email').innerText = data.email || "No Email";
    document.getElementById('profile-display-langs').innerText = `Native: ${data.nativeLanguage || 'English'} • Specialization: ${data.learningLanguages || 'Italian'}`;
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
    console.warn("Profile fetch error");
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
          btn.innerHTML = '<i class="ph ph-check"></i> Applied';
          btn.style.background = 'var(--color-success)';
          await loadProfile();
        }
      } finally {
        setTimeout(() => { btn.innerHTML = ogHtml; btn.style.background = ''; }, 2000);
      }
    });
  }
}

async function loadLeaderboard() {
  try {
    const res = await fetch(`${API_BASE}/leaderboard`);
    const data = await res.json();
    const list = document.querySelector('.rank-list');
    list.innerHTML = '';
    data.forEach((user, idx) => {
      list.innerHTML += `
        <li style="display:flex; align-items:center; gap: 1.5rem; padding: 1.25rem; border-bottom: 1px solid var(--glass-border); transition: 0.3s;" class="pulse-hover">
          <strong style="font-size: 1.5rem; color: ${idx===0?'#f1c40f':(idx===1?'#bdc3c7':(idx===2?'#cd7f32':'inherit'))}; width: 30px; text-align:center;">${idx + 1}</strong>
          <img src="${getAvatar(user.avatar, user.name)}" referrerpolicy="no-referrer" style="width: 50px; height: 50px; border-radius: 50%;">
          <div style="flex: 1">
            <div style="font-weight: 600; font-size: 1.1rem">${user.name}</div>
            <div style="font-size: 0.85rem; color: var(--color-primary-light);">Level ${user.level}</div>
          </div>
          <div style="font-weight: 700; font-size: 1.2rem;">${user.score.toLocaleString()} XP</div>
        </li>
      `;
    });
  } catch (err) {}
}

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
        body: JSON.stringify({ sourceId: currentActiveTranslationId, text })
      });
      if (res.ok) {
        freshBtn.innerHTML = '<i class="ph ph-check-circle"></i> Perfect +50 XP';
        freshBtn.style.background = 'var(--color-success)';
        await loadProfile();
        setTimeout(async () => { freshBtn.innerHTML = ogHtml; freshBtn.style.background = ''; await loadTranslations(); }, 1500);
      }
    } catch(err) {
      freshBtn.innerHTML = 'Error';
    }
  });
}

// SHOP BINDINGS
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
        } else alert(data.error);
      } finally {
        setTimeout(() => { e.target.innerHTML = og; e.target.style.background = ''; e.target.style.color = ''; }, 3000);
      }
    });
  });
}

// REVIEW FEED BINDING
async function loadReviews() {
  const container = document.getElementById('review-feed-container');
  try {
    const res = await fetch(`${API_BASE}/reviews`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const reviews = await res.json();
    container.innerHTML = '';
    
    if(reviews.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:3rem; color:var(--color-text-muted)">No peer translations available yet. Make one!</div>';
        return;
    }

    reviews.forEach(r => {
      const voteHTML = r.hasVoted 
        ? `<button class="upvote-btn voted"><i class="ph ph-caret-up"></i> ${r.upvotes} Voted</button>`
        : `<button class="upvote-btn render-vote" data-id="${r.id}"><i class="ph ph-caret-up"></i> ${r.upvotes} Upvote</button>`;
        
      container.innerHTML += `
        <div class="glass-card review-card pulse-hover">
            <div class="header">
                <img src="${getAvatar(r.avatar, r.name)}" referrerpolicy="no-referrer" />
                <div>
                    <strong style="color: var(--color-primary-light)">${r.name}</strong> translated:
                </div>
            </div>
            <div class="source-quote">${r.sourceText}</div>
            <div class="review-text">${r.translatedText}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid var(--glass-border); padding-top: 0.75rem;">
                <span style="font-size: 0.85rem; color: var(--color-text-muted)"><i class="ph ph-users"></i> Community verification needed</span>
                ${voteHTML}
            </div>
        </div>
      `;
    });

    document.querySelectorAll('.render-vote').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        e.currentTarget.innerHTML = '<i class="ph ph-spinner ph-spin"></i> processing';
        const res = await fetch(`${API_BASE}/translations/${id}/vote`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if(res.ok) {
           await loadReviews();
        }
      });
    });

  } catch (err) {}
}

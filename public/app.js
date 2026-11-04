const $ = selector => document.querySelector(selector);
const messages = $('#messages');

// State management
let currentToken = localStorage.getItem('study_spark_token') || null;
let currentUser = null;
let currentSessionId = null;
let authMode = 'login'; // 'login' or 'register'

/**
 * Helper to build auth headers
 */
function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }
  return headers;
}

/**
 * Update UI reflecting authentication status
 */
function updateAuthUI(user) {
  currentUser = user;
  const avatar = $('#user-avatar');
  const name = $('#user-name');
  const course = $('#user-course');
  const authActionBtn = $('#auth-action-btn');
  const topAuthText = $('#top-auth-text');

  if (user) {
    // Generate initials for avatar
    const initials = user.name
      ? user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
      : 'U';
    avatar.textContent = initials;
    name.textContent = user.name;
    course.textContent = user.course || user.email;
    authActionBtn.textContent = 'Sign out';
    authActionBtn.title = 'Sign out of current account';
    topAuthText.textContent = user.name.split(' ')[0];
  } else {
    avatar.textContent = '✦';
    name.textContent = 'Guest Student';
    course.textContent = 'Sign in to save notes';
    authActionBtn.textContent = 'Sign in';
    authActionBtn.title = 'Sign in or register';
    topAuthText.textContent = 'Sign in';
  }
}

/**
 * Check if the stored token belongs to a valid user session
 */
async function checkAuthSession() {
  if (!currentToken) {
    updateAuthUI(null);
    return;
  }
  try {
    const res = await fetch('/api/auth/me', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      updateAuthUI(data.user);
    } else {
      // Invalid/expired token
      localStorage.removeItem('study_spark_token');
      currentToken = null;
      updateAuthUI(null);
    }
  } catch (err) {
    console.warn('Could not verify auth session:', err);
    updateAuthUI(null);
  }
}

/**
 * Open the authentication modal dialog
 */
function openAuthModal(mode = 'login') {
  authMode = mode;
  const modal = $('#auth-modal');
  const errorEl = $('#auth-error');
  errorEl.style.display = 'none';
  errorEl.textContent = '';

  const tabLogin = $('#tab-login');
  const tabRegister = $('#tab-register');
  const nameGroup = $('#group-name');
  const submitBtn = $('#auth-submit-btn span');
  const modalTitle = $('#auth-modal-title');

  if (mode === 'register') {
    tabLogin.classList.remove('active');
    tabLogin.setAttribute('aria-selected', 'false');
    tabRegister.classList.add('active');
    tabRegister.setAttribute('aria-selected', 'true');
    nameGroup.style.display = 'flex';
    $('#auth-name').required = true;
    submitBtn.textContent = 'Create Account';
    modalTitle.textContent = 'Create Study Spark Account';
  } else {
    tabRegister.classList.remove('active');
    tabRegister.setAttribute('aria-selected', 'false');
    tabLogin.classList.add('active');
    tabLogin.setAttribute('aria-selected', 'true');
    nameGroup.style.display = 'none';
    $('#auth-name').required = false;
    submitBtn.textContent = 'Sign In';
    modalTitle.textContent = 'Sign In to Study Spark';
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    if (mode === 'register') {
      $('#auth-name').focus();
    } else {
      $('#auth-email').focus();
    }
  }, 100);
}

/**
 * Close the authentication modal
 */
function closeAuthModal() {
  const modal = $('#auth-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

/**
 * Handle user sign out
 */
async function handleSignOut() {
  if (currentToken) {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
    } catch (_) {}
  }
  localStorage.removeItem('study_spark_token');
  currentToken = null;
  updateAuthUI(null);
  loadSessions();
  loadProgress();
}

/**
 * Load study sessions from database
 */
async function loadSessions() {
  const sessionList = $('#session-list');
  try {
    const response = await fetch('/api/sessions', { headers: authHeaders() });
    const data = await response.json();
    if (data.sessions && data.sessions.length > 0) {
      sessionList.innerHTML = data.sessions.map((session, index) => `
        <div class="session ${index === 0 && !currentSessionId ? 'active' : ''}" data-id="${session.id}">
          <span class="session-icon">${session.icon || '▣'}</span>
          <div>
            <strong>${escapeHtml(session.title)}</strong>
            <small>${escapeHtml(session.time || 'Recent')}</small>
          </div>
        </div>
      `).join('');

      // Attach click handlers to session items
      sessionList.querySelectorAll('.session').forEach(el => {
        el.addEventListener('click', () => {
          sessionList.querySelectorAll('.session').forEach(s => s.classList.remove('active'));
          el.classList.add('active');
          currentSessionId = el.dataset.id;
          messages.innerHTML = '';
          addMessage(`Switched to study session: ${el.querySelector('strong').textContent}`, 'assistant');
        });
      });
    } else {
      sessionList.innerHTML = '<div class="session"><div><strong>No sessions yet</strong><small>Start asking questions</small></div></div>';
    }
  } catch (error) {
    sessionList.innerHTML = '<div class="session"><div><strong>Could not load sessions</strong><small>API offline</small></div></div>';
  }
}

/**
 * Load student learning progress from database
 */
async function loadProgress() {
  try {
    const res = await fetch('/api/progress', { headers: authHeaders() });
    if (!res.ok) return;
    const p = await res.json();
    if ($('#streak-count')) $('#streak-count').textContent = `${p.streak || 1} day streak`;
    if ($('#mastery-percent')) $('#mastery-percent').textContent = `${p.mastery || 0}%`;
    if ($('#mastery-bar')) $('#mastery-bar').style.width = `${Math.min(100, Math.max(0, p.mastery || 0))}%`;
    if ($('#stat-questions')) $('#stat-questions').textContent = `${p.questions || 0}`;
    if ($('#focus-topic') && p.focus) $('#focus-topic').textContent = p.focus;
  } catch (err) {
    console.warn('Could not load progress snapshot:', err);
  }
}

/**
 * Safely escape HTML to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Append message element to the chat stream
 */
function addMessage(text, kind) {
  const el = document.createElement('div');
  el.className = `message ${kind}`;
  el.textContent = text;
  messages.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return el;
}

/**
 * Ask Spark: sends prompt to the LLM backend with retrieved course context
 */
async function askSpark(prompt) {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) return;

  addMessage(cleanPrompt, 'user');

  // Loading typing indicator
  const typing = document.createElement('div');
  typing.className = 'message assistant';
  typing.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
  messages.appendChild(typing);
  typing.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        message: cleanPrompt,
        sessionId: currentSessionId
      })
    });

    const data = await response.json();
    typing.innerHTML = ''; // Clear typing dots

    if (data.answer) {
      const textContainer = document.createElement('div');
      textContainer.style.whiteSpace = 'pre-wrap';
      textContainer.textContent = data.answer;
      typing.appendChild(textContainer);

      // Display citations if passages were retrieved from course materials
      if (data.citations && data.citations.length > 0) {
        const sourceBox = document.createElement('div');
        sourceBox.style.marginTop = '10px';
        sourceBox.style.paddingTop = '8px';
        sourceBox.style.borderTop = '1px solid rgba(0,0,0,0.08)';

        const citationTitle = document.createElement('small');
        citationTitle.style.display = 'block';
        citationTitle.style.fontWeight = '600';
        citationTitle.style.color = '#5a6266';
        citationTitle.textContent = `📚 Referenced ${data.citations.length} course material passage${data.citations.length > 1 ? 's' : ''}:`;
        sourceBox.appendChild(citationTitle);

        data.citations.forEach((c) => {
          const item = document.createElement('small');
          item.style.display = 'block';
          item.style.color = '#7d8589';
          item.style.marginTop = '2px';
          item.textContent = `• ${c.document} (${Math.round((c.score || 0.8) * 100)}% match)`;
          sourceBox.appendChild(item);
        });

        typing.appendChild(sourceBox);
      }

      // If simulated or warning present, show subtle developer/setup hint
      if (data.demo && !data.provider?.startsWith('huggingface:')) {
        const hint = document.createElement('small');
        hint.style.display = 'block';
        hint.style.marginTop = '8px';
        hint.style.color = '#8b6f38';
        hint.style.fontStyle = 'italic';
        hint.textContent = '✦ RAG context simulated · Set HUGGINGFACE_API_TOKEN in .env for live Llama inference';
        typing.appendChild(hint);
      }
    } else {
      typing.textContent = data.error || 'Spark could not generate a response. Please try again.';
    }

    // Refresh progress statistics to reflect new question
    loadProgress();

  } catch (error) {
    typing.textContent = 'The study partner service is unavailable. Please check the server connection.';
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

// Chat submission
$('#chat-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#message-input');
  askSpark(input.value);
  input.value = '';
  input.style.height = 'auto';
});

$('#message-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    $('#chat-form').requestSubmit();
  }
});

// Auto-expand textarea
$('#message-input').addEventListener('input', event => {
  event.target.style.height = 'auto';
  event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
});

// Prompt cards click
document.querySelectorAll('[data-prompt]').forEach(button => {
  button.addEventListener('click', () => {
    const prompt = button.dataset.prompt;
    $('#message-input').value = prompt;
    $('#message-input').focus();
    if (button.classList.contains('outline-button')) {
      askSpark(prompt);
    }
  });
});

// New study session button
$('#new-session').addEventListener('click', async () => {
  messages.innerHTML = '';
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title: 'New biology study session' })
    });
    if (res.ok) {
      const data = await res.json();
      currentSessionId = data.session.id;
      loadSessions();
    }
  } catch (_) {}
  $('#message-input').focus();
});

// Materials attachment stub button
const attachBtn = $('#attach-btn');
if (attachBtn) {
  attachBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/documents', { headers: authHeaders() });
      const data = await res.json();
      const docNames = data.documents?.map(d => `• ${d.name} (${d.chunks} chunks)`).join('\n') || 'None';
      alert(`Course materials currently ingested in database:\n\n${docNames}\n\nThese materials are automatically queried and provided as context to the AI model.`);
    } catch (_) {
      alert('Could not fetch materials list.');
    }
  });
}

// Help button
const helpBtn = $('#help-btn');
if (helpBtn) {
  helpBtn.addEventListener('click', () => {
    alert(
      'Study Spark Help:\n\n' +
      '1. Type your question in the chat box or pick a suggested topic.\n' +
      '2. Spark searches your course notes in the database and sends matching context to the LLM.\n' +
      '3. To connect live Hugging Face Llama models, configure HUGGINGFACE_API_TOKEN in .env.\n' +
      '4. Sign in to track your mastery progress and persist your sessions!'
    );
  });
}

// Auth modal triggers
$('#auth-action-btn').addEventListener('click', () => {
  if (currentUser) {
    handleSignOut();
  } else {
    openAuthModal('login');
  }
});

$('#top-auth-btn').addEventListener('click', () => {
  if (currentUser) {
    if (confirm(`Signed in as ${currentUser.name} (${currentUser.email}). Do you want to sign out?`)) {
      handleSignOut();
    }
  } else {
    openAuthModal('login');
  }
});

$('#modal-trigger-card').addEventListener('click', () => {
  if (!currentUser) {
    openAuthModal('register');
  } else {
    alert(`Signed in as ${currentUser.name}\nEmail: ${currentUser.email}\nCourse: ${currentUser.course}`);
  }
});

// Auth tab toggles
$('#tab-login').addEventListener('click', () => openAuthModal('login'));
$('#tab-register').addEventListener('click', () => openAuthModal('register'));

// Auth modal close
$('#auth-modal-close').addEventListener('click', closeAuthModal);
$('#auth-modal').addEventListener('click', event => {
  if (event.target === $('#auth-modal')) closeAuthModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#auth-modal').classList.contains('open')) {
    closeAuthModal();
  }
});

// Auth form submit
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = $('#auth-error');
  const submitBtn = $('#auth-submit-btn');
  errorEl.style.display = 'none';
  errorEl.textContent = '';
  submitBtn.disabled = true;

  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const name = $('#auth-name').value.trim();

  try {
    const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = authMode === 'register' ? { email, password, name } : { email, password };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    // Success! Store token & user
    currentToken = data.token;
    localStorage.setItem('study_spark_token', currentToken);
    updateAuthUI(data.user);
    closeAuthModal();

    // Reset inputs
    $('#auth-password').value = '';

    // Reload data for this user
    await loadSessions();
    await loadProgress();

    addMessage(`Welcome, ${data.user.name}! Spark has loaded your course notes and study history.`, 'assistant');

  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
});

// Initial boot
(async function init() {
  await checkAuthSession();
  await loadSessions();
  await loadProgress();
})();

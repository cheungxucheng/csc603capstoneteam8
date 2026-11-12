const $ = selector => document.querySelector(selector);
const messages = $('#messages');

// State management
let currentToken = localStorage.getItem('owlchemy_token') || localStorage.getItem('study_spark_token') || null;
let currentUser = null;
let currentSessionId = null;
let authMode = 'login'; // 'login' or 'register'
let selectedFile = null;

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
    avatar.textContent = '🦉';
    name.textContent = 'Guest Student';
    course.textContent = 'Sign in to sync notes';
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
      localStorage.removeItem('owlchemy_token');
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
    modalTitle.textContent = 'Create OwlChemy Account';
  } else {
    tabRegister.classList.remove('active');
    tabRegister.setAttribute('aria-selected', 'false');
    tabLogin.classList.add('active');
    tabLogin.setAttribute('aria-selected', 'true');
    nameGroup.style.display = 'none';
    $('#auth-name').required = false;
    submitBtn.textContent = 'Sign In';
    modalTitle.textContent = 'Sign In to OwlChemy';
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
  localStorage.removeItem('owlchemy_token');
  localStorage.removeItem('study_spark_token');
  currentToken = null;
  updateAuthUI(null);
  loadSessions();
  loadProgress();
  loadMaterials();
}

/**
 * Open Course Materials & Document Ingestion Modal
 */
function openMaterialsModal(tab = 'list') {
  const modal = $('#materials-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  switchMaterialsTab(tab);
  loadMaterials();
}

/**
 * Close Course Materials Modal
 */
function closeMaterialsModal() {
  const modal = $('#materials-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  $('#chunks-preview-container').style.display = 'none';
  $('#materials-list-container').style.display = 'flex';
}

function switchMaterialsTab(tab) {
  const tabList = $('#tab-mat-list');
  const tabUpload = $('#tab-mat-upload');
  const panelList = $('#panel-mat-list');
  const panelUpload = $('#panel-mat-upload');

  if (tab === 'upload') {
    tabList.classList.remove('active');
    tabList.setAttribute('aria-selected', 'false');
    tabUpload.classList.add('active');
    tabUpload.setAttribute('aria-selected', 'true');
    panelList.style.display = 'none';
    panelUpload.style.display = 'flex';
  } else {
    tabUpload.classList.remove('active');
    tabUpload.setAttribute('aria-selected', 'false');
    tabList.classList.add('active');
    tabList.setAttribute('aria-selected', 'true');
    panelUpload.style.display = 'none';
    panelList.style.display = 'flex';
  }
}

/**
 * Load and render ingested course materials
 */
async function loadMaterials() {
  const container = $('#materials-list-container');
  const countBadge = $('#mat-count');

  try {
    const res = await fetch('/api/documents', { headers: authHeaders() });
    const data = await res.json();
    const docs = data.documents || [];

    if (countBadge) countBadge.textContent = docs.length;

    if (docs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--muted); padding: 30px;">
          <p>No course materials uploaded yet.</p>
          <button class="outline-button" id="btn-switch-upload" style="margin: 0 auto;">Upload your first note <span>→</span></button>
        </div>
      `;
      $('#btn-switch-upload')?.addEventListener('click', () => switchMaterialsTab('upload'));
      return;
    }

    container.innerHTML = docs.map(doc => `
      <div class="material-card" data-id="${doc.id}">
        <div class="material-icon">▤</div>
        <div class="material-info">
          <div class="material-title" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</div>
          <div class="material-meta">
            <span class="material-badge">${doc.chunks || 1} knowledge chunk${doc.chunks === 1 ? '' : 's'}</span>
            <span>•</span>
            <span>Status: ${escapeHtml(doc.status || 'Ready')}</span>
          </div>
        </div>
        <div class="material-actions">
          <button type="button" class="action-btn-small btn-view-chunks" data-id="${doc.id}" data-name="${escapeHtml(doc.name)}">View chunks</button>
          <button type="button" class="action-btn-small danger btn-delete-doc" data-id="${doc.id}" title="Delete document">×</button>
        </div>
      </div>
    `).join('');

    // Attach inspect chunks click handlers
    container.querySelectorAll('.btn-view-chunks').forEach(btn => {
      btn.addEventListener('click', () => inspectDocumentChunks(btn.dataset.id, btn.dataset.name));
    });

    // Attach delete click handlers
    container.querySelectorAll('.btn-delete-doc').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete this course material and its indexed chunks?')) return;
        await deleteDocument(btn.dataset.id);
      });
    });

  } catch (err) {
    container.innerHTML = '<div style="color: #dc2626; padding: 15px;">Failed to load course materials.</div>';
  }
}

/**
 * View chunks for a specific document in the modal
 */
async function inspectDocumentChunks(docId, docName) {
  const container = $('#materials-list-container');
  const preview = $('#chunks-preview-container');
  const title = $('#chunks-doc-title');
  const list = $('#chunks-list');

  title.textContent = `Chunks for: ${docName}`;
  list.innerHTML = '<div style="color: var(--muted); padding: 10px;">Loading chunks...</div>';
  container.style.display = 'none';
  preview.style.display = 'block';

  try {
    const res = await fetch(`/api/documents/chunks?id=${encodeURIComponent(docId)}`, { headers: authHeaders() });
    const data = await res.json();
    const chunks = data.chunks || [];

    if (chunks.length === 0) {
      list.innerHTML = '<div style="color: var(--muted);">No chunks found for this document.</div>';
      return;
    }

    list.innerHTML = chunks.map(c => `
      <div class="chunk-card">
        <span class="chunk-badge">Chunk #${c.chunk_index + 1} (${c.char_count || c.content.length} chars)</span>
        <div>${escapeHtml(c.content)}</div>
      </div>
    `).join('');

  } catch (err) {
    list.innerHTML = '<div style="color: #dc2626;">Could not load chunks.</div>';
  }
}

$('#close-chunks-btn')?.addEventListener('click', () => {
  $('#chunks-preview-container').style.display = 'none';
  $('#materials-list-container').style.display = 'flex';
});

/**
 * Delete a course material from the knowledge base
 */
async function deleteDocument(docId) {
  try {
    const res = await fetch('/api/documents/delete', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ id: docId })
    });
    if (res.ok) {
      loadMaterials();
    } else {
      alert('Could not delete document.');
    }
  } catch (err) {
    alert('Error connecting to server.');
  }
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
 * Ask OwlChemy: sends prompt to the LLM backend with retrieved course context
 */
async function askOwlChemy(prompt) {
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

      // Interactive Citations display
      if (data.citations && data.citations.length > 0) {
        const citationBox = document.createElement('div');
        citationBox.className = 'citation-box';

        const citationHeader = document.createElement('div');
        citationHeader.className = 'citation-header';
        citationHeader.innerHTML = `<span>🦉</span> <span>Grounded in ${data.citations.length} retrieved course passage${data.citations.length > 1 ? 's' : ''}:</span>`;
        citationBox.appendChild(citationHeader);

        data.citations.forEach((c, idx) => {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'citation-pill';
          const matchPct = Math.round((c.score || 0.8) * 100);
          pill.innerHTML = `<span>▤</span> <span>${escapeHtml(c.document)}</span> <small>(${matchPct}% match)</small> ▾`;

          const snippet = document.createElement('div');
          snippet.className = 'citation-snippet';
          snippet.textContent = `"${c.text}"`;

          pill.addEventListener('click', () => {
            snippet.classList.toggle('expanded');
            pill.innerHTML = `<span>▤</span> <span>${escapeHtml(c.document)}</span> <small>(${matchPct}% match)</small> ${snippet.classList.contains('expanded') ? '▴' : '▾'}`;
          });

          citationBox.appendChild(pill);
          citationBox.appendChild(snippet);
        });

        typing.appendChild(citationBox);
      }

      // If simulated fallback notice
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
      typing.textContent = data.error || 'OwlChemy could not generate a response. Please try again.';
    }

    // Refresh progress stats
    loadProgress();

  } catch (error) {
    typing.textContent = 'OwlChemy is currently unreachable. Please check your local server.';
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

// Chat submission
$('#chat-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#message-input');
  askOwlChemy(input.value);
  input.value = '';
  input.style.height = 'auto';
});

$('#message-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    $('#chat-form').requestSubmit();
  }
});

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
      askOwlChemy(prompt);
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

// Course Materials Modal triggers
$('#attach-btn')?.addEventListener('click', () => openMaterialsModal('list'));
$('#nav-materials-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  openMaterialsModal('list');
});
$('#open-materials-topbar')?.addEventListener('click', () => openMaterialsModal('list'));

$('#tab-mat-list')?.addEventListener('click', () => switchMaterialsTab('list'));
$('#tab-mat-upload')?.addEventListener('click', () => switchMaterialsTab('upload'));

$('#materials-modal-close')?.addEventListener('click', closeMaterialsModal);
$('#materials-modal')?.addEventListener('click', event => {
  if (event.target === $('#materials-modal')) closeMaterialsModal();
});

// File dropzone & file input handling
const dropzone = $('#file-dropzone');
const fileInput = $('#file-input');
const dropzoneLabel = $('#dropzone-label');

if (dropzone && fileInput) {
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files?.length) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files?.length) {
      handleSelectedFile(e.target.files[0]);
    }
  });
}

function handleSelectedFile(file) {
  selectedFile = file;
  dropzoneLabel.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
  if (!$('#doc-name-input').value.trim()) {
    $('#doc-name-input').value = file.name.replace(/\.[^/.]+$/, '');
  }
}

// Upload / Add document form submission
$('#upload-doc-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('#doc-name-input').value.trim();
  const textContent = $('#doc-text-input').value.trim();
  const statusEl = $('#upload-status');
  const submitBtn = $('#doc-submit-btn');

  statusEl.style.display = 'none';
  statusEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.querySelector('span').textContent = 'Extracting & Chunking...';

  try {
    let payload = {};
    let endpoint = '/api/documents';

    if (selectedFile) {
      endpoint = '/api/documents/upload';
      const isText = selectedFile.type.includes('text') || selectedFile.name.endsWith('.txt') || selectedFile.name.endsWith('.md') || selectedFile.name.endsWith('.json');

      if (isText) {
        const text = await selectedFile.text();
        payload = {
          name: title,
          filename: selectedFile.name,
          content: text
        };
      } else {
        // Encode binary (e.g. PDF) as base64
        const arrayBuffer = await selectedFile.arrayBuffer();
        const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        payload = {
          name: title,
          filename: selectedFile.name,
          base64: true,
          fileData: base64
        };
      }
    } else if (textContent) {
      payload = {
        name: title,
        content: textContent
      };
    } else {
      throw new Error('Please select a file or paste note text to ingest.');
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to ingest document');
    }

    // Reset form
    $('#doc-name-input').value = '';
    $('#doc-text-input').value = '';
    selectedFile = null;
    dropzoneLabel.textContent = 'Click or drag & drop a course file here';

    // Switch to materials list and reload
    switchMaterialsTab('list');
    await loadMaterials();

    addMessage(`📚 Successfully ingested "${title}" (${data.document?.chunks || 'multiple'} chunks indexed). OwlChemy is now ready to use this in your tutoring sessions!`, 'assistant');

  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('span').textContent = 'Ingest & Index Material';
  }
});

// Help button
$('#help-btn')?.addEventListener('click', () => {
  alert(
    '🦉 OwlChemy Help & Guide:\n\n' +
    '1. Ask anything in the chat box or pick a suggested topic card.\n' +
    '2. Click "Materials" to upload course slides, PDFs, or lecture notes.\n' +
    '3. OwlChemy chunks and indexes your notes, retrieving the most relevant passages for every question.\n' +
    '4. Click the citation badges beneath answers to see the exact excerpts referenced.\n' +
    '5. Sign in to save your sessions and sync your learning progress!'
  );
});

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

$('#modal-trigger-card')?.addEventListener('click', () => {
  if (!currentUser) {
    openAuthModal('register');
  } else {
    alert(`OwlChemy Profile:\n\nSigned in as: ${currentUser.name}\nEmail: ${currentUser.email}\nCourse: ${currentUser.course}`);
  }
});

$('#tab-login').addEventListener('click', () => openAuthModal('login'));
$('#tab-register').addEventListener('click', () => openAuthModal('register'));

$('#auth-modal-close').addEventListener('click', closeAuthModal);
$('#auth-modal').addEventListener('click', event => {
  if (event.target === $('#auth-modal')) closeAuthModal();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if ($('#auth-modal').classList.contains('open')) closeAuthModal();
    if ($('#materials-modal').classList.contains('open')) closeMaterialsModal();
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

    currentToken = data.token;
    localStorage.setItem('owlchemy_token', currentToken);
    updateAuthUI(data.user);
    closeAuthModal();

    $('#auth-password').value = '';

    await loadSessions();
    await loadProgress();
    await loadMaterials();

    addMessage(`Welcome, ${data.user.name}! OwlChemy has loaded your course notes and study history.`, 'assistant');

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
  await loadMaterials();
})();

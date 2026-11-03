const $ = selector => document.querySelector(selector);
const messages = $('#messages');

async function loadSessions() {
  const response = await fetch('/api/sessions');
  const data = await response.json();
  $('#session-list').innerHTML = data.sessions.map(session => `<div class="session"><span class="session-icon">${session.icon}</span><div><strong>${session.title}</strong><small>${session.time}</small></div></div>`).join('');
}

function addMessage(text, kind) {
  const el = document.createElement('div');
  el.className = `message ${kind}`;
  el.textContent = text;
  messages.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function askSpark(prompt) {
  if (!prompt.trim()) return;
  addMessage(prompt.trim(), 'user');
  const typing = document.createElement('div');
  typing.className = 'message assistant';
  typing.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
  messages.appendChild(typing);
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt }) });
    const data = await response.json();
    typing.textContent = data.answer || data.error;
    if (data.citations?.length) {
      const source = document.createElement('small');
      source.textContent = `Based on ${data.citations.length} retrieved course passage${data.citations.length > 1 ? 's' : ''} · Demo RAG`; typing.appendChild(source);
    }
  } catch (error) { typing.textContent = 'The demo service is unavailable. Please try again.'; }
}

$('#chat-form').addEventListener('submit', event => { event.preventDefault(); const input = $('#message-input'); askSpark(input.value); input.value = ''; });
$('#message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('#chat-form').requestSubmit(); });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { const prompt = button.dataset.prompt; $('#message-input').value = prompt; $('#message-input').focus(); if (button.classList.contains('outline-button')) askSpark(prompt); }));
$('#new-session').addEventListener('click', () => { messages.innerHTML = ''; $('#message-input').focus(); });
$('#message-input').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`; });
loadSessions().catch(() => { $('#session-list').innerHTML = '<div class="session"><div><strong>Could not load sessions</strong><small>API offline</small></div></div>'; });

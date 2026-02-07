// app.js - Main application controller for sangyi-tui
import {
  initDB,
  getWorkspaces,
  createWorkspace,
  getWorkspace,
  getMessages,
  addMessage,
  updateWorkspace,
  deleteWorkspace,
  getAgents,
  getSkills,
  getGuides,
  getWorkspaceConfig,
  toggleWorkspaceConfig,
  clearMessages,
  getSessionId,
  getTeam,
  getTeams,
  createTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMember,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
} from './db.js';
import { sendChatMessage, abortCurrentRequest } from './chat.js';
import { renderTeamPanel, showCreateTeamModal } from './teams.js';
import { handleMentionInput, handleMentionKeydown, closeMentionAutocomplete, isMentionActive, extractMentionedAgent } from './mentions.js';

// --- State ---
let currentWorkspaceId = null;
let isStreaming = false;
let currentAssistantContent = '';
let allWorkspaces = [];
let rightPanelOpen = false;
let openSections = new Set(['agents']); // track which sections are open
let currentTeamId = null;

// --- Helpers ---

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatMarkdown(text) {
  if (!text) return '';

  // Phase 1: Parse into segments (text vs code)
  const segments = [];
  const codeRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', raw: text.slice(last, m.index) });
    const lang = m[1] || 'txt';
    const code = m[2].trim();
    segments.push({ type: 'code', lang, code, filename: detectFilename(code, lang) });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', raw: text.slice(last) });

  // Phase 2: Group consecutive code blocks into projects
  const output = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];
    if (seg.type === 'code') {
      // Collect consecutive code blocks (allow short text gaps < 80 chars between them)
      const files = [seg];
      let j = i + 1;
      while (j < segments.length) {
        if (segments[j].type === 'code') {
          files.push(segments[j]);
          j++;
        } else if (segments[j].type === 'text' && segments[j].raw.trim().length < 80 && j + 1 < segments.length && segments[j + 1].type === 'code') {
          // Short text between code blocks — skip it, keep grouping
          j++; // skip text
        } else {
          break;
        }
      }
      // Find project name from the last text segment before this group
      let projName = 'Code';
      for (let k = output.length - 1; k >= 0; k--) {
        if (output[k].type === 'text') {
          const headingMatch = output[k].raw.match(/#{1,3}\s+(.+)/);
          if (headingMatch) { projName = headingMatch[1].trim(); break; }
          break;
        }
      }
      output.push({ type: 'project', name: projName, files });
      i = j;
    } else {
      output.push(seg);
      i++;
    }
  }

  // Phase 3: Render HTML
  let html = '';
  for (const item of output) {
    if (item.type === 'text') {
      html += renderInlineMarkdown(item.raw);
    } else if (item.type === 'project') {
      html += renderProjectContainer(item.name, item.files);
    }
  }
  return html;
}

function renderInlineMarkdown(text) {
  let h = escapeHtml(text);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // Headings
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Lists
  h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/g, (m) => '<ul>' + m + '</ul>');
  h = h.replace(/\n/g, '<br>');
  // Clean up double <br> from headings
  h = h.replace(/<br><(h[234]|ul|li)/g, '<$1');
  h = h.replace(/<\/(h[234]|ul|li)><br>/g, '</$1>');
  return h;
}

function detectFilename(code, lang) {
  const extMap = {
    javascript:'js', js:'js', jsx:'jsx', tsx:'tsx', typescript:'ts', ts:'ts',
    python:'py', py:'py', html:'html', css:'css', json:'json', bash:'sh',
    shell:'sh', sql:'sql', rust:'rs', go:'go', java:'java', kotlin:'kt',
    ruby:'rb', yaml:'yaml', yml:'yml', xml:'xml', markdown:'md', md:'md',
    txt:'txt', code:'txt'
  };
  const ext = extMap[lang.toLowerCase()] || lang || 'txt';
  // Try to detect from first-line comment: // App.jsx, /* styles.css */, # main.py
  const firstLine = code.split('\n')[0].trim();
  const commentFile = firstLine.match(/^(?:\/\/|\/\*|#)\s*(\S+\.\w+)/);
  if (commentFile) return commentFile[1].replace(/\s*\*\//, '');
  // Try export default
  const expMatch = code.match(/export\s+default\s+(?:function\s+)?(\w+)/);
  if (expMatch) return expMatch[1] + '.' + ext;
  // Try class/function name
  const classMatch = code.match(/(?:class|function)\s+(\w+)/);
  if (classMatch && ext !== 'css') return classMatch[1] + '.' + ext;
  // Fallback
  return 'index.' + ext;
}

function renderProjectContainer(name, files) {
  // Encode all files data for ZIP/Run
  const filesData = files.map(f => ({
    filename: f.filename,
    lang: f.lang,
    code: f.code,
    encoded: btoa(unescape(encodeURIComponent(f.code)))
  }));
  const projectData = btoa(unescape(encodeURIComponent(JSON.stringify(filesData))));
  const hasRunnable = files.some(f => ['html','javascript','js','css','jsx','tsx','ts','typescript'].includes(f.lang.toLowerCase()));
  const totalSize = files.reduce((sum, f) => sum + f.code.length, 0);

  let html = `<div class="file-tree-project" data-project="${escapeHtml(projectData)}">`;
  html += `<div class="file-tree-header">`;
  html += `<span class="file-tree-title">📁 ${escapeHtml(name)}</span>`;
  html += `<div class="file-tree-actions">`;
  if (hasRunnable) {
    html += `<button class="file-tree-btn" data-action="run-project" title="Run all files in sandbox">▶ Run</button>`;
  }
  html += `<button class="file-tree-btn" data-action="zip-project" title="Download as ZIP">📦 ZIP</button>`;
  html += `</div></div>`;

  html += `<div class="file-tree-list">`;
  for (let idx = 0; idx < files.length; idx++) {
    const f = files[idx];
    const encoded = filesData[idx].encoded;
    const sizeStr = f.code.length > 1024 ? (f.code.length / 1024).toFixed(1) + ' KB' : f.code.length + ' B';
    const iconMap = { js:'📄', jsx:'⚛️', ts:'📘', tsx:'⚛️', html:'🌐', css:'🎨', py:'🐍', json:'📋', sh:'🔧', sql:'🗄️', rs:'🦀', go:'🐹', java:'☕', kt:'🟣', rb:'💎', yaml:'⚙️', md:'📝' };
    const icon = iconMap[f.lang.toLowerCase()] || '📄';

    html += `<div class="file-tree-item" data-code="${encoded}" data-lang="${escapeHtml(f.lang)}" data-filename="${escapeHtml(f.filename)}">`;
    html += `<div class="file-tree-row">`;
    html += `<span class="file-tree-file-icon">${icon}</span>`;
    html += `<span class="file-tree-filename">${escapeHtml(f.filename)}</span>`;
    html += `<span class="file-tree-meta">${sizeStr}</span>`;
    html += `<button class="file-tree-copy-btn" title="Copy">Copy</button>`;
    html += `</div>`;
    html += `<div class="file-tree-code"><pre><code>${escapeHtml(f.code)}</code></pre></div>`;
    html += `</div>`;
  }
  html += `</div></div>`;
  return html;
}

function getModelShortName(model) {
  if (!model) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet';
}

function scrollToBottom() {
  const container = document.getElementById('messages');
  container.scrollTop = container.scrollHeight;
}

// --- Modal System ---

function showModal({ title, body, buttons = [], onClose }) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const footerEl = document.getElementById('modal-footer');
  const closeBtn = document.getElementById('modal-close');

  titleEl.textContent = title;
  if (typeof body === 'string') {
    bodyEl.innerHTML = body;
  } else {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(body);
  }

  footerEl.innerHTML = '';
  for (const btn of buttons) {
    const el = document.createElement('button');
    el.className = `modal-btn ${btn.class || 'modal-btn-secondary'}`;
    el.textContent = btn.label;
    el.addEventListener('click', () => {
      if (btn.onClick) btn.onClick();
      if (btn.close !== false) hideModal();
    });
    footerEl.appendChild(el);
  }

  overlay.classList.add('active');

  const handleClose = () => {
    hideModal();
    if (onClose) onClose();
  };

  closeBtn.onclick = handleClose;
  overlay.onclick = (e) => {
    if (e.target === overlay) handleClose();
  };

  // Focus first input if any
  setTimeout(() => {
    const firstInput = bodyEl.querySelector('input, textarea');
    if (firstInput) firstInput.focus();
  }, 100);

  return overlay;
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

function showConfirmModal(title, message, onConfirm) {
  showModal({
    title,
    body: `<p>${message}</p>`,
    buttons: [
      { label: 'Cancel', class: 'modal-btn-secondary' },
      { label: 'Confirm', class: 'modal-btn-danger', onClick: onConfirm },
    ],
  });
}

function showInputModal(title, fields, onSubmit) {
  const form = document.createElement('div');
  for (const field of fields) {
    const group = document.createElement('div');
    group.className = 'field-group';
    const label = document.createElement('label');
    label.textContent = field.label;
    group.appendChild(label);

    let input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = field.rows || 3;
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }
    input.placeholder = field.placeholder || '';
    input.value = field.value || '';
    input.dataset.field = field.name;
    group.appendChild(input);
    form.appendChild(group);
  }

  showModal({
    title,
    body: form,
    buttons: [
      { label: 'Cancel', class: 'modal-btn-secondary' },
      {
        label: 'Create',
        class: 'modal-btn-primary',
        onClick: () => {
          const values = {};
          for (const field of fields) {
            const el = form.querySelector(`[data-field="${field.name}"]`);
            values[field.name] = el ? el.value.trim() : '';
          }
          onSubmit(values);
        },
      },
    ],
  });

  // Handle Enter key in single-line inputs
  form.querySelectorAll('input[type="text"]').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const values = {};
        for (const field of fields) {
          const el = form.querySelector(`[data-field="${field.name}"]`);
          values[field.name] = el ? el.value.trim() : '';
        }
        onSubmit(values);
        hideModal();
      }
    });
  });
}

// --- Sidebar ---

function renderSidebar() {
  const list = document.getElementById('workspace-list');
  list.innerHTML = '';

  for (const ws of allWorkspaces) {
    const item = document.createElement('div');
    item.className = 'workspace-item' + (ws.id === currentWorkspaceId ? ' active' : '');
    item.dataset.id = ws.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'workspace-name';
    nameSpan.textContent = ws.name;

    const badge = document.createElement('span');
    badge.className = 'msg-count';
    badge.textContent = ws.message_count || 0;

    item.appendChild(nameSpan);
    item.appendChild(badge);

    // Single-click to switch workspace (with delay to detect double-click)
    let clickTimer = null;
    item.addEventListener('click', (e) => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        switchWorkspace(ws.id);
      }, 250);
    });

    // Double-click nameSpan to rename
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      startInlineRename(item, nameSpan, ws);
    });

    list.appendChild(item);
  }
}

// Inline rename function for sidebar workspace items
function startInlineRename(item, nameSpan, ws) {
  const input = document.createElement('input');
  input.className = 'inline-rename';
  input.value = ws.name;
  input.type = 'text';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  const finish = async (save) => {
    const newName = input.value.trim();
    const newSpan = document.createElement('span');
    newSpan.className = 'workspace-name';
    if (save && newName && newName !== ws.name) {
      await updateWorkspace(ws.id, { name: newName });
      newSpan.textContent = newName;
      if (ws.id === currentWorkspaceId) {
        document.getElementById('workspace-name').textContent = newName;
      }
      allWorkspaces = await getWorkspaces();
    } else {
      newSpan.textContent = ws.name;
    }
    input.replaceWith(newSpan);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    }
    if (e.key === 'Escape') {
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

// --- Workspace Switching ---

async function switchWorkspace(workspaceId) {
  currentWorkspaceId = workspaceId;
  const ws = await getWorkspace(workspaceId);
  if (!ws) return;

  document.getElementById('workspace-name').textContent = ws.name;
  document.getElementById('model-badge').textContent = getModelShortName(ws.model);

  const messages = await getMessages(workspaceId);
  renderMessages(messages);
  renderSidebar();

  if (rightPanelOpen) {
    document.getElementById('system-prompt').value = ws.system_prompt || '';
    await renderRightPanel();
  }
}

// --- Messages ---

function renderMessages(messages) {
  const container = document.getElementById('messages');
  const welcome = document.getElementById('welcome-msg');

  // Remove all message bubbles but keep the welcome element
  const existing = container.querySelectorAll('.message');
  existing.forEach((el) => el.remove());

  if (messages.length === 0) {
    welcome.classList.remove('hidden');
    return;
  }

  welcome.classList.add('hidden');

  for (const msg of messages) {
    appendMessageBubble(msg, container);
  }

  scrollToBottom();
}

function appendMessageBubble(msg, container) {
  const div = document.createElement('div');

  if (msg.role === 'user') {
    div.className = 'message message-user';
    div.innerHTML = `<div class="message-bubble">${escapeHtml(msg.content)}</div>`;
  } else if (msg.role === 'assistant') {
    div.className = 'message message-assistant';
    div.innerHTML = `<div class="message-bubble">${formatMarkdown(msg.content)}</div>`;
  } else if (msg.role === 'tool') {
    div.className = 'message message-tool';
    const toolName = msg.tool_name || 'tool';
    const header = document.createElement('div');
    header.className = 'tool-header';
    header.textContent = `Tool: ${toolName}`;
    header.addEventListener('click', () => {
      div.classList.toggle('expanded');
    });
    const body = document.createElement('div');
    body.className = 'tool-body';
    body.innerHTML = `<pre>${escapeHtml(msg.content)}</pre>`;
    div.appendChild(header);
    div.appendChild(body);
  } else if (msg.role === 'error') {
    div.className = 'message message-error';
    div.innerHTML = `<div class="message-bubble">${escapeHtml(msg.content)}</div>`;
  }

  container.appendChild(div);
}

// --- Streaming ---

function appendStreamingDelta(delta) {
  currentAssistantContent += delta;
  const container = document.getElementById('messages');
  let bubble = container.querySelector('.message.message-assistant.streaming');

  if (!bubble) {
    const welcome = document.getElementById('welcome-msg');
    welcome.classList.add('hidden');
    bubble = document.createElement('div');
    bubble.className = 'message message-assistant streaming';
    bubble.innerHTML = '<div class="message-bubble"></div>';
    container.appendChild(bubble);
  }

  const content = bubble.querySelector('.message-bubble');
  content.innerHTML = formatMarkdown(currentAssistantContent);
  scrollToBottom();
}

// --- Auto-Configuration ---

async function autoConfigWorkspace(userMessage) {
  const agents = await getAgents();
  const skills = await getSkills();
  const guides = await getGuides();

  try {
    const response = await fetch('/api/auto-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMessage,
        agents: agents.map(a => ({ id: a.id, name: a.name, description: a.description || '' })),
        skills: skills.map(s => ({ id: s.id, name: s.name, description: s.description || '' })),
        guides: guides.map(g => ({ id: g.id, name: g.name, description: g.description || '' })),
      }),
    });

    if (!response.ok) return null;
    const result = await response.json();

    // Apply recommendations
    const config = await getWorkspaceConfig(currentWorkspaceId);

    for (const agentId of (result.agents || [])) {
      if (!config.agents.includes(agentId)) {
        await toggleWorkspaceConfig(currentWorkspaceId, 'agent', agentId);
      }
    }
    for (const skillId of (result.skills || [])) {
      if (!config.skills.includes(skillId)) {
        await toggleWorkspaceConfig(currentWorkspaceId, 'skill', skillId);
      }
    }
    for (const guideId of (result.guides || [])) {
      if (!config.guides.includes(guideId)) {
        await toggleWorkspaceConfig(currentWorkspaceId, 'guide', guideId);
      }
    }

    return result;
  } catch (err) {
    console.error('Auto-config failed:', err);
    return null;
  }
}

// --- SQL Console (Cmd+K) ---

function showSQLConsole() {
  const container = document.createElement('div');
  container.className = 'sql-console';

  const presets = [
    { label: 'Messages', sql: "SELECT role, substr(content,1,80) as content, created_at FROM messages ORDER BY created_at DESC LIMIT 20" },
    { label: 'Agents', sql: "SELECT id, name, category FROM agents ORDER BY name" },
    { label: 'Workspaces', sql: "SELECT id, name, model, created_at FROM workspaces" },
    { label: 'Teams', sql: "SELECT t.name, COUNT(DISTINCT tm.agent_id) as members, COUNT(DISTINCT tk.id) as tasks FROM teams t LEFT JOIN team_members tm ON t.id=tm.team_id LEFT JOIN tasks tk ON t.id=tk.team_id GROUP BY t.name" },
  ];

  const presetBar = document.createElement('div');
  presetBar.className = 'sql-presets';
  for (const p of presets) {
    const btn = document.createElement('button');
    btn.className = 'sql-preset-btn';
    btn.textContent = p.label;
    btn.addEventListener('click', () => {
      sqlInput.value = p.sql;
    });
    presetBar.appendChild(btn);
  }
  container.appendChild(presetBar);

  const sqlInput = document.createElement('textarea');
  sqlInput.className = 'sql-input';
  sqlInput.placeholder = 'SELECT * FROM messages LIMIT 10';
  sqlInput.rows = 3;
  container.appendChild(sqlInput);

  const resultArea = document.createElement('div');
  resultArea.className = 'sql-result';
  container.appendChild(resultArea);

  showModal({
    title: 'DuckDB SQL Console',
    body: container,
    buttons: [
      { label: 'Close', class: 'modal-btn-secondary' },
      {
        label: 'Run Query',
        class: 'modal-btn-primary',
        close: false,
        onClick: async () => {
          const sql = sqlInput.value.trim();
          if (!sql) return;
          resultArea.innerHTML = '<span style="color:var(--text-tertiary)">Running...</span>';
          try {
            const { runSQL } = await import('./db.js');
            const rows = await runSQL(sql);
            if (!rows || rows.length === 0) {
              resultArea.innerHTML = '<span style="color:var(--text-tertiary)">No results</span>';
              return;
            }
            const cols = Object.keys(rows[0]);
            let html = '<table class="sql-table"><thead><tr>';
            for (const col of cols) html += '<th>' + escapeHtml(col) + '</th>';
            html += '</tr></thead><tbody>';
            for (const row of rows) {
              html += '<tr>';
              for (const col of cols) {
                const val = row[col];
                html += '<td>' + escapeHtml(String(val ?? '')) + '</td>';
              }
              html += '</tr>';
            }
            html += '</tbody></table>';
            resultArea.innerHTML = html;
          } catch (err) {
            resultArea.innerHTML = '<span style="color:var(--red)">' + escapeHtml(err.message) + '</span>';
          }
        },
      },
    ],
  });

  // Enter to run
  sqlInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('.modal-btn-primary')?.click();
    }
  });
}

async function downloadProjectZip(files, projectName) {
  // Dynamically load JSZip if not loaded
  if (!window.JSZip) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const zip = new JSZip();
  const folderName = projectName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'project';
  const folder = zip.folder(folderName);

  // Deduplicate filenames
  const usedNames = new Set();
  for (const f of files) {
    let name = f.filename;
    let counter = 1;
    while (usedNames.has(name)) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? name.slice(0, dot) + `-${counter++}` + name.slice(dot) : name + `-${counter++}`;
    }
    usedNames.add(name);
    const code = f.code || decodeURIComponent(escape(atob(f.encoded)));
    folder.file(name, code);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Sandbox Execution ---

function runInSandbox(code, lang) {
  let panel = document.getElementById('sandbox-panel');

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'sandbox-panel';
    panel.className = 'sandbox-panel';
    panel.innerHTML = `
      <div class="sandbox-header">
        <span class="sandbox-title">▶ Sandbox Preview</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="sandbox-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div class="sandbox-body">
        <iframe id="sandbox-frame" class="sandbox-frame" sandbox="allow-scripts allow-modals"></iframe>
        <div id="sandbox-console" class="sandbox-console"></div>
      </div>
    `;
    document.getElementById('app').appendChild(panel);

    panel.querySelector('.sandbox-close-btn').addEventListener('click', () => {
      panel.classList.remove('active');
    });
  }

  panel.classList.add('active');
  const frame = document.getElementById('sandbox-frame');
  const consoleEl = document.getElementById('sandbox-console');
  consoleEl.innerHTML = '';

  const langLower = lang.toLowerCase();
  let htmlContent = '';

  if (langLower === 'html') {
    htmlContent = code;
  } else if (langLower === 'css') {
    htmlContent = `<!DOCTYPE html><html><head><style>${code}</style></head><body><div class="preview">CSS Preview</div><p>Your styles are applied to this page.</p></body></html>`;
  } else if (['javascript', 'js', 'typescript', 'ts'].includes(langLower)) {
    // Wrap JS with console capture
    htmlContent = `<!DOCTYPE html>
<html><head><style>
  body { font-family: 'SF Mono', monospace; background: #1c1c1e; color: #e5e5e7; padding: 16px; font-size: 13px; }
  .log { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); white-space: pre-wrap; word-break: break-all; }
  .log.error { color: #FF453A; }
  .log.warn { color: #FFD60A; }
  .log.info { color: #64D2FF; }
</style></head><body>
<script>
  // Override console methods to display output
  const _log = console.log, _err = console.error, _warn = console.warn, _info = console.info;
  function fmt(...args) {
    return args.map(a => {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'object') { try { return JSON.stringify(a, null, 2); } catch { return String(a); } }
      return String(a);
    }).join(' ');
  }
  function addLine(text, cls) {
    const div = document.createElement('div');
    div.className = 'log ' + cls;
    div.textContent = text;
    document.body.appendChild(div);
    // Also post to parent
    window.parent.postMessage({ type: 'sandbox-console', level: cls, text }, '*');
  }
  console.log = (...a) => { addLine(fmt(...a), ''); _log(...a); };
  console.error = (...a) => { addLine(fmt(...a), 'error'); _err(...a); };
  console.warn = (...a) => { addLine(fmt(...a), 'warn'); _warn(...a); };
  console.info = (...a) => { addLine(fmt(...a), 'info'); _info(...a); };

  // Catch errors
  window.onerror = (msg, src, line, col, err) => {
    addLine('Error: ' + msg + ' (line ' + line + ')', 'error');
  };
  window.onunhandledrejection = (e) => {
    addLine('Unhandled Promise: ' + e.reason, 'error');
  };

  try {
    ${code}
  } catch(e) {
    console.error(e.message);
  }
</script></body></html>`;
  } else {
    // Unsupported language
    htmlContent = `<!DOCTYPE html><html><head><style>body{font-family:system-ui;background:#1c1c1e;color:#e5e5e7;padding:20px;display:flex;align-items:center;justify-content:center;height:80vh}</style></head><body><div style="text-align:center"><p style="font-size:48px;margin:0">🚫</p><p>Runtime for <strong>${lang}</strong> is not available in browser sandbox.</p><p style="color:#98989d">Use Export to download and run locally.</p></div></body></html>`;
  }

  frame.srcdoc = htmlContent;

  // Listen for console messages from iframe
  const handler = (e) => {
    if (e.data && e.data.type === 'sandbox-console') {
      const line = document.createElement('div');
      line.className = 'sandbox-console-line ' + (e.data.level || '');
      line.textContent = e.data.text;
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  };
  // Remove old listener if any
  window.removeEventListener('message', window._sandboxHandler);
  window._sandboxHandler = handler;
  window.addEventListener('message', handler);
}

function runProjectInSandbox(files) {
  // Combine all files into a single runnable HTML page
  let htmlFile = files.find(f => f.lang === 'html');
  const cssFiles = files.filter(f => f.lang === 'css');
  const jsFiles = files.filter(f => ['javascript', 'js', 'jsx', 'tsx', 'typescript', 'ts'].includes(f.lang));

  let htmlContent = '';

  if (htmlFile) {
    // Use the HTML file as base, inject CSS and JS
    htmlContent = htmlFile.code;
    if (cssFiles.length > 0) {
      const cssStr = cssFiles.map(f => f.code).join('\n');
      if (htmlContent.includes('</head>')) {
        htmlContent = htmlContent.replace('</head>', `<style>${cssStr}</style></head>`);
      } else {
        htmlContent = `<style>${cssStr}</style>` + htmlContent;
      }
    }
    if (jsFiles.length > 0) {
      const jsStr = jsFiles.map(f => f.code).join('\n;\n');
      if (htmlContent.includes('</body>')) {
        htmlContent = htmlContent.replace('</body>', `<script>${jsStr}<\/script></body>`);
      } else {
        htmlContent += `<script>${jsStr}<\/script>`;
      }
    }
  } else if (jsFiles.length > 0) {
    // JS-only project: wrap with console capture
    const allJs = jsFiles.map(f => f.code).join('\n;\n');
    const allCss = cssFiles.map(f => f.code).join('\n');
    htmlContent = `<!DOCTYPE html>
<html><head><style>
  body { font-family: 'SF Mono', monospace; background: #1c1c1e; color: #e5e5e7; padding: 16px; font-size: 13px; }
  .log { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); white-space: pre-wrap; }
  .log.error { color: #FF453A; }
  .log.warn { color: #FFD60A; }
  ${allCss}
</style></head><body>
<script>
  const _log=console.log,_err=console.error,_warn=console.warn;
  function fmt(...a){return a.map(x=>typeof x==='object'?JSON.stringify(x,null,2):String(x)).join(' ')}
  function add(t,c){const d=document.createElement('div');d.className='log '+c;d.textContent=t;document.body.appendChild(d);window.parent.postMessage({type:'sandbox-console',level:c,text:t},'*')}
  console.log=(...a)=>{add(fmt(...a),'');_log(...a)};
  console.error=(...a)=>{add(fmt(...a),'error');_err(...a)};
  console.warn=(...a)=>{add(fmt(...a),'warn');_warn(...a)};
  window.onerror=(m,s,l)=>{add('Error: '+m+' (line '+l+')','error')};
  try{${allJs}}catch(e){console.error(e.message)}
<\/script></body></html>`;
  } else if (cssFiles.length > 0) {
    const allCss = cssFiles.map(f => f.code).join('\n');
    htmlContent = `<!DOCTYPE html><html><head><style>${allCss}</style></head><body><div class="preview"><h2>CSS Preview</h2><p>Your styles are applied.</p><button>Button</button><a href="#">Link</a><input placeholder="Input"></div></body></html>`;
  } else {
    htmlContent = `<!DOCTYPE html><html><body style="background:#1c1c1e;color:#e5e5e7;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:80vh"><div style="text-align:center"><p style="font-size:48px">🚫</p><p>No runnable files (HTML/JS/CSS) found in this project.</p></div></body></html>`;
  }

  // Reuse the existing sandbox panel
  runInSandbox(htmlContent, 'html');
}

// --- Send Message ---

async function handleSendMessage() {
  const textarea = document.getElementById('message-input');
  const text = textarea.value.trim();
  if (!text || isStreaming) return;

  textarea.value = '';
  textarea.style.height = 'auto';
  updateSendButton();
  closeMentionAutocomplete();

  isStreaming = true;
  setStreamingUI(true);

  // Auto-configure workspace on first message
  const existingMessages = await getMessages(currentWorkspaceId);
  if (existingMessages.length === 0) {
    // Show auto-config indicator
    const container = document.getElementById('messages');
    document.getElementById('welcome-msg').classList.add('hidden');
    const configMsg = document.createElement('div');
    configMsg.className = 'message message-system auto-config-msg';
    configMsg.innerHTML = '<div class="message-bubble"><span class="auto-config-spinner"></span> Analyzing your intent and configuring workspace...</div>';
    container.appendChild(configMsg);
    scrollToBottom();

    const result = await autoConfigWorkspace(text);

    // Replace config message with result
    if (result && result.reasoning) {
      configMsg.innerHTML = `<div class="message-bubble auto-config-done">✨ ${escapeHtml(result.reasoning)}</div>`;
    } else {
      configMsg.remove();
    }

    // Refresh right panel if open
    if (rightPanelOpen) {
      renderRightPanel();
    }
  }

  // Add user message to DB and render
  await addMessage(currentWorkspaceId, 'user', text);
  const container = document.getElementById('messages');
  document.getElementById('welcome-msg').classList.add('hidden');
  appendMessageBubble({ role: 'user', content: text }, container);
  scrollToBottom();

  // Compose system prompt
  const ws = await getWorkspace(currentWorkspaceId);
  const composedPrompt = await composeSystemPrompt(ws);

  // Check for @agent mention
  let finalPrompt = composedPrompt;
  const agents = await getAgents();
  const mentionedAgent = extractMentionedAgent(text, agents);
  if (mentionedAgent && mentionedAgent.system_prompt) {
    finalPrompt = mentionedAgent.system_prompt + '\n\n' + composedPrompt;
  }

  // Get session ID
  const sessionId = await getSessionId(currentWorkspaceId);

  currentAssistantContent = '';

  try {
    await sendChatMessage(text, sessionId, finalPrompt, ws.model, async (event) => {
      switch (event.type) {
        case 'session':
          await updateWorkspace(currentWorkspaceId, { session_id: event.session_id });
          break;

        case 'text_delta':
          appendStreamingDelta(event.content);
          break;

        case 'tool_start': {
          const toolDiv = document.createElement('div');
          toolDiv.className = 'message message-tool';
          toolDiv.dataset.tool = event.tool;
          const header = document.createElement('div');
          header.className = 'tool-header';
          header.textContent = `Tool: ${event.tool}`;
          header.addEventListener('click', () => toolDiv.classList.toggle('expanded'));
          const body = document.createElement('div');
          body.className = 'tool-body';
          body.innerHTML = `<pre>${escapeHtml(event.input || '')}</pre>`;
          toolDiv.appendChild(header);
          toolDiv.appendChild(body);
          container.appendChild(toolDiv);
          scrollToBottom();
          break;
        }

        case 'tool_result': {
          const lastTool = container.querySelector('.message.message-tool:last-of-type .tool-body pre');
          if (lastTool) {
            lastTool.textContent += '\n--- Result ---\n' + (event.output || '');
          }
          break;
        }

        case 'done':
          if (currentAssistantContent) {
            // Finalize the streaming bubble
            const streaming = container.querySelector('.message.message-assistant.streaming');
            if (streaming) streaming.classList.remove('streaming');
            await addMessage(currentWorkspaceId, 'assistant', currentAssistantContent);
          }
          if (event.cost_usd) {
            updateCostDisplay(event.cost_usd);
          }
          // Refresh workspace list to update message counts
          allWorkspaces = await getWorkspaces();
          renderSidebar();
          break;

        case 'error':
          appendMessageBubble({ role: 'error', content: event.message }, container);
          await addMessage(currentWorkspaceId, 'error', event.message);
          scrollToBottom();
          break;
      }
    });
  } catch (err) {
    if (err.name !== 'AbortError') {
      const errMsg = err.message || 'Unknown error';
      appendMessageBubble({ role: 'error', content: errMsg }, container);
      await addMessage(currentWorkspaceId, 'error', errMsg);
      scrollToBottom();
    }
    // Finalize any partial streaming content
    const streaming = container.querySelector('.message.message-assistant.streaming');
    if (streaming) {
      streaming.classList.remove('streaming');
      if (currentAssistantContent) {
        await addMessage(currentWorkspaceId, 'assistant', currentAssistantContent);
      }
    }
  } finally {
    isStreaming = false;
    currentAssistantContent = '';
    setStreamingUI(false);
  }
}

async function runTeamExecution(team, tasks, members) {
  const container = document.getElementById('messages');
  document.getElementById('welcome-msg').classList.add('hidden');

  // Show team execution header
  const headerDiv = document.createElement('div');
  headerDiv.className = 'message message-system';
  headerDiv.innerHTML = `<div class="message-bubble">🚀 Running team "<strong>${escapeHtml(team.name)}</strong>" — ${tasks.length} task(s) in parallel</div>`;
  container.appendChild(headerDiv);
  scrollToBottom();

  // Build agent map from members
  const agentMap = {};
  const agents = await getAgents();
  for (const m of members) {
    const agent = agents.find(a => a.id === m.agent_id);
    if (agent) agentMap[m.agent_id] = agent;
  }

  // Get workspace info
  const ws = await getWorkspace(currentWorkspaceId);
  const sessionId = await getSessionId(currentWorkspaceId);

  // Fire all tasks in parallel
  const promises = tasks.map(async (task) => {
    // Find assigned agent (use first member if no assignee)
    const assigneeId = task.assignee_id || (members[0] ? members[0].agent_id : null);
    const agent = assigneeId ? agentMap[assigneeId] : null;
    const agentName = agent ? agent.name : 'claude';
    const agentIcon = agent ? (agent.icon || '🤖') : '✦';

    // Create agent-labeled bubble
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message message-assistant message-subagent';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'subagent-label';
    labelDiv.innerHTML = `<span class="subagent-icon">${agentIcon}</span> <span class="subagent-name">${escapeHtml(agentName)}</span> <span class="subagent-task">${escapeHtml(task.subject)}</span>`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-bubble';
    contentDiv.innerHTML = '<span class="auto-config-spinner"></span> Working...';

    bubbleDiv.appendChild(labelDiv);
    bubbleDiv.appendChild(contentDiv);
    container.appendChild(bubbleDiv);
    scrollToBottom();

    // Update task status to in_progress
    await updateTask(task.id, { status: 'in_progress' });

    // Build prompt: task description + agent system prompt
    const taskPrompt = `Task: ${task.subject}\n${task.description || ''}`;
    let systemPrompt = agent && agent.system_prompt ? agent.system_prompt : '';
    if (ws.system_prompt) {
      systemPrompt = systemPrompt ? systemPrompt + '\n\n' + ws.system_prompt : ws.system_prompt;
    }

    try {
      let content = '';
      await sendChatMessage(taskPrompt, sessionId, systemPrompt, ws.model, (event) => {
        if (event.type === 'text_delta') {
          content += event.content;
          contentDiv.innerHTML = formatMarkdown(content);
          scrollToBottom();
        }
      });

      // Save to DB
      await addMessage(currentWorkspaceId, 'assistant', content);

      // Update task status to completed
      await updateTask(task.id, { status: 'completed' });

      return { task: task.subject, status: 'completed' };
    } catch (err) {
      contentDiv.innerHTML = `<span style="color:var(--red)">Error: ${escapeHtml(err.message)}</span>`;
      return { task: task.subject, status: 'failed', error: err.message };
    }
  });

  const results = await Promise.allSettled(promises);

  // Show summary
  const completedCount = results.filter(r => r.status === 'fulfilled' && r.value.status === 'completed').length;
  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'message message-system';
  summaryDiv.innerHTML = `<div class="message-bubble auto-config-done">✅ Team execution complete: ${completedCount}/${tasks.length} tasks succeeded</div>`;
  container.appendChild(summaryDiv);
  scrollToBottom();

  // Refresh right panel to show updated task statuses
  if (rightPanelOpen) renderRightPanel();
}

async function composeSystemPrompt(ws) {
  const parts = [];
  if (ws.system_prompt) {
    parts.push(ws.system_prompt);
  }

  const config = await getWorkspaceConfig(currentWorkspaceId);

  if (config.agents.length > 0) {
    const agents = await getAgents();
    for (const agent of agents) {
      if (config.agents.includes(agent.id) && agent.system_prompt) {
        parts.push(`\n\n## Agent: ${agent.name}\n${agent.system_prompt}`);
      }
    }
  }

  if (config.skills.length > 0) {
    const skills = await getSkills();
    for (const skill of skills) {
      if (config.skills.includes(skill.id) && skill.prompt_template) {
        parts.push(`\n\n## Available Skill: ${skill.name}\n${skill.prompt_template}`);
      }
    }
  }

  if (config.guides.length > 0) {
    const guides = await getGuides();
    for (const guide of guides) {
      if (config.guides.includes(guide.id) && guide.content) {
        parts.push(`\n\n## Reference: ${guide.name}\n${guide.content}`);
      }
    }
  }

  return parts.join('');
}

function setStreamingUI(streaming) {
  const sendBtn = document.getElementById('send-btn');
  const textarea = document.getElementById('message-input');

  if (streaming) {
    sendBtn.disabled = true;
    sendBtn.classList.add('loading');
    textarea.disabled = true;
    textarea.placeholder = 'Claude is thinking...';
  } else {
    sendBtn.disabled = false;
    sendBtn.classList.remove('loading');
    textarea.disabled = false;
    textarea.placeholder = 'Message Claude... (@ to mention agent)';
    textarea.focus();
    updateSendButton();
  }
}

function updateSendButton() {
  const textarea = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = !textarea.value.trim() || isStreaming;
}

function updateCostDisplay(costUsd) {
  const el = document.getElementById('cost-display');
  const current = parseFloat(el.dataset.total || '0');
  const total = current + costUsd;
  el.dataset.total = total;
  el.textContent = `$${total.toFixed(4)}`;
}

// --- Right Panel ---

async function renderRightPanel() {
  const panelContent = document.getElementById('panel-content');
  panelContent.innerHTML = '';

  const sections = [
    { id: 'agents', icon: '🤖', title: 'Agents' },
    { id: 'skills', icon: '⚡', title: 'Skills' },
    { id: 'guides', icon: '📖', title: 'Guides' },
    { id: 'teams', icon: '👥', title: 'Teams' },
  ];

  for (const section of sections) {
    const isOpen = openSections.has(section.id);

    const sectionEl = document.createElement('div');
    sectionEl.className = 'panel-section' + (isOpen ? '' : ' collapsed');

    // Header
    const header = document.createElement('div');
    header.className = 'panel-section-header';

    const chevron = document.createElement('span');
    chevron.className = 'section-chevron';
    chevron.textContent = '▸';

    const icon = document.createElement('span');
    icon.className = 'section-icon';
    icon.textContent = section.icon;

    const title = document.createElement('span');
    title.className = 'section-title';
    title.textContent = section.title;

    header.appendChild(chevron);
    header.appendChild(icon);
    header.appendChild(title);

    header.addEventListener('click', () => {
      if (openSections.has(section.id)) {
        openSections.delete(section.id);
      } else {
        openSections.add(section.id);
      }
      renderRightPanel();
    });

    sectionEl.appendChild(header);

    // Body (only render content if open)
    const body = document.createElement('div');
    body.className = 'panel-section-body';
    sectionEl.appendChild(body);
    panelContent.appendChild(sectionEl);

    if (isOpen) {
      if (section.id === 'teams') {
        await renderTeamPanel(body, currentWorkspaceId, currentTeamId, {
          showModal,
          hideModal,
          showConfirmModal,
          showInputModal,
          escapeHtml,
          onTeamSelect: (teamId) => {
            currentTeamId = teamId;
            renderRightPanel();
          },
          onRefresh: () => renderRightPanel(),
          onRunTeam: (team, tasks, members) => runTeamExecution(team, tasks, members),
        });
      } else {
        await renderConfigSection(body, section.id);
      }
    }
  }
}

async function renderConfigSection(container, sectionId) {
  const config = await getWorkspaceConfig(currentWorkspaceId);
  let items = [];
  let activeIds = [];

  if (sectionId === 'agents') {
    items = await getAgents();
    activeIds = config.agents;
  } else if (sectionId === 'skills') {
    items = await getSkills();
    activeIds = config.skills;
  } else if (sectionId === 'guides') {
    items = await getGuides();
    activeIds = config.guides;
  }

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.textContent = `No ${sectionId} available.`;
    container.appendChild(empty);
    return;
  }

  // Add count badge to the section header
  const headerTitle = container.parentElement.querySelector('.section-title');
  const activeCount = items.filter(item => activeIds.includes(item.id)).length;
  if (activeCount > 0) {
    const existingBadge = headerTitle.parentElement.querySelector('.section-badge');
    if (existingBadge) existingBadge.remove();
    const badge = document.createElement('span');
    badge.className = 'section-badge';
    badge.textContent = activeCount;
    headerTitle.parentElement.appendChild(badge);
  }

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'config-card';

    const info = document.createElement('div');
    info.className = 'config-info';

    const icon = document.createElement('span');
    icon.className = 'config-icon';
    icon.textContent = item.icon || '';

    const name = document.createElement('span');
    name.className = 'config-name';
    name.textContent = item.name;

    info.appendChild(icon);
    info.appendChild(name);

    if (item.description) {
      const desc = document.createElement('p');
      desc.className = 'config-desc';
      desc.textContent = item.description;
      info.appendChild(desc);
    }

    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = activeIds.includes(item.id);

    const slider = document.createElement('span');
    slider.className = 'toggle-slider';

    toggle.appendChild(checkbox);
    toggle.appendChild(slider);

    const itemType = sectionId.replace(/s$/, '');
    checkbox.addEventListener('change', async () => {
      await toggleWorkspaceConfig(currentWorkspaceId, itemType, item.id);
      renderRightPanel();
    });

    card.appendChild(info);
    card.appendChild(toggle);
    container.appendChild(card);
  }
}

function toggleRightPanel() {
  const panel = document.getElementById('right-panel');
  rightPanelOpen = !rightPanelOpen;
  document.getElementById('app').classList.toggle('right-panel-open', rightPanelOpen);

  if (rightPanelOpen) {
    panel.classList.remove('hidden');
    getWorkspace(currentWorkspaceId).then((ws) => {
      if (ws) {
        document.getElementById('system-prompt').value = ws.system_prompt || '';
      }
    });
    renderRightPanel();
  } else {
    panel.classList.add('hidden');
  }
}

// --- Event Listeners ---

function setupEventListeners() {
  const sendBtn = document.getElementById('send-btn');
  const textarea = document.getElementById('message-input');
  const newWsBtn = document.getElementById('new-workspace');
  const settingsBtn = document.getElementById('settings-toggle');
  const closePanel = document.getElementById('close-panel');
  const clearBtn = document.getElementById('clear-chat');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const systemPrompt = document.getElementById('system-prompt');
  const workspaceName = document.getElementById('workspace-name');

  // Send message
  sendBtn.addEventListener('click', handleSendMessage);

  // Textarea: Enter to send, Shift+Enter for newline, auto-grow
  textarea.addEventListener('keydown', (e) => {
    if (isMentionActive()) {
      handleMentionKeydown(e, textarea);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    updateSendButton();
    handleMentionInput(textarea, getAgents);
  });

  // New workspace - using modal
  newWsBtn.addEventListener('click', () => {
    showInputModal('New Workspace', [
      { name: 'name', label: 'Name', placeholder: 'My Workspace' },
      { name: 'prompt', label: 'System Prompt', type: 'textarea', placeholder: 'You are a helpful assistant...', value: 'You are Claude, a helpful AI assistant.' },
    ], async (values) => {
      if (!values.name) return;
      const id = await createWorkspace(values.name, values.prompt);
      allWorkspaces = await getWorkspaces();
      renderSidebar();
      await switchWorkspace(id);
    });
  });

  // Settings panel toggle
  settingsBtn.addEventListener('click', toggleRightPanel);

  // Model selector
  const modelBadge = document.getElementById('model-badge');
  modelBadge.style.cursor = 'pointer';
  modelBadge.addEventListener('click', async () => {
    const ws = await getWorkspace(currentWorkspaceId);
    const models = [
      { id: 'claude-sonnet-4-5-20250929', label: 'sonnet', color: 'var(--purple)' },
      { id: 'claude-haiku-4-5-20251001', label: 'haiku', color: 'var(--green)' },
      { id: 'claude-opus-4-6', label: 'opus', color: 'var(--orange)' },
    ];
    const body = document.createElement('div');
    body.className = 'model-select-list';
    for (const m of models) {
      const item = document.createElement('div');
      item.className = 'model-select-item' + (ws.model === m.id ? ' active' : '');
      item.innerHTML = `<span class="model-dot" style="background:${m.color}"></span><span class="model-label">${m.label}</span>`;
      item.addEventListener('click', async () => {
        await updateWorkspace(currentWorkspaceId, { model: m.id });
        document.getElementById('model-badge').textContent = m.label;
        hideModal();
      });
      body.appendChild(item);
    }
    showModal({ title: 'Select Model', body, buttons: [{ label: 'Cancel', class: 'modal-btn-secondary' }] });
  });

  // Close panel
  closePanel.addEventListener('click', () => {
    rightPanelOpen = false;
    const panel = document.getElementById('right-panel');
    panel.classList.add('hidden');
    document.getElementById('app').classList.remove('right-panel-open');
  });

  // Clear chat - using confirm modal
  clearBtn.addEventListener('click', () => {
    showConfirmModal('Clear Chat', 'Delete all messages in this workspace? This cannot be undone.', async () => {
      await clearMessages(currentWorkspaceId);
      await updateWorkspace(currentWorkspaceId, { session_id: null });
      const messages = await getMessages(currentWorkspaceId);
      renderMessages(messages);
      allWorkspaces = await getWorkspaces();
      renderSidebar();
    });
  });

  // Delete workspace
  const deleteWsBtn = document.getElementById('delete-workspace');
  if (deleteWsBtn) {
    deleteWsBtn.addEventListener('click', () => {
      if (allWorkspaces.length <= 1) {
        showModal({ title: 'Cannot Delete', body: '<p>You need at least one workspace.</p>', buttons: [{ label: 'OK', class: 'modal-btn-secondary' }] });
        return;
      }
      showConfirmModal('Delete Workspace', 'Permanently delete this workspace and all its data?', async () => {
        const idToDelete = currentWorkspaceId;
        await deleteWorkspace(idToDelete);
        allWorkspaces = await getWorkspaces();
        currentWorkspaceId = allWorkspaces[0].id;
        renderSidebar();
        await switchWorkspace(currentWorkspaceId);
      });
    });
  }

  // Sidebar toggle (mobile)
  sidebarToggle.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Panel resize handle
  const resizeHandle = document.getElementById('resize-handle');
  if (resizeHandle) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = document.getElementById('right-panel').offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const diff = startX - e.clientX;
      const newWidth = Math.min(Math.max(startWidth + diff, 200), 600);
      document.documentElement.style.setProperty('--right-panel-width', newWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      resizeHandle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // System prompt editing
  let promptDebounce = null;
  systemPrompt.addEventListener('input', () => {
    clearTimeout(promptDebounce);
    promptDebounce = setTimeout(async () => {
      await updateWorkspace(currentWorkspaceId, {
        system_prompt: systemPrompt.value,
      });
    }, 500);
  });

  // Escape to abort streaming, Cmd+K for SQL console
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isStreaming) {
      abortCurrentRequest();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      showSQLConsole();
    }
  });

  // Project & file actions (event delegation)
  document.getElementById('messages').addEventListener('click', (e) => {
    // Project-level actions
    const projBtn = e.target.closest('.file-tree-btn');
    if (projBtn) {
      const container = projBtn.closest('.file-tree-project');
      const projectData = container.dataset.project;
      const files = JSON.parse(decodeURIComponent(escape(atob(projectData))));
      if (projBtn.dataset.action === 'zip-project') {
        downloadProjectZip(files, container.querySelector('.file-tree-title').textContent.replace('📁 ', ''));
      } else if (projBtn.dataset.action === 'run-project') {
        runProjectInSandbox(files);
      }
      return;
    }

    // File copy button
    const copyBtn = e.target.closest('.file-tree-copy-btn');
    if (copyBtn) {
      const file = copyBtn.closest('.file-tree-item');
      const code = decodeURIComponent(escape(atob(file.dataset.code)));
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = '✓';
        setTimeout(() => copyBtn.textContent = 'Copy', 1500);
      });
      return;
    }

    // File header click to toggle expand/collapse
    const fileHeader = e.target.closest('.file-tree-row');
    if (fileHeader && !e.target.closest('.file-tree-copy-btn')) {
      const file = fileHeader.closest('.file-tree-item');
      file.classList.toggle('active');
      return;
    }
  });

  // Double-click workspace name to rename - contenteditable
  workspaceName.addEventListener('dblclick', async () => {
    const ws = await getWorkspace(currentWorkspaceId);
    if (!ws) return;

    workspaceName.contentEditable = 'true';
    workspaceName.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(workspaceName);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = async () => {
      workspaceName.contentEditable = 'false';
      const newName = workspaceName.textContent.trim();
      const currentWs = await getWorkspace(currentWorkspaceId);
      if (newName && newName !== currentWs.name) {
        await updateWorkspace(currentWorkspaceId, { name: newName });
        allWorkspaces = await getWorkspaces();
        renderSidebar();
      } else {
        workspaceName.textContent = currentWs.name;
      }
    };

    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        workspaceName.removeEventListener('keydown', keyHandler);
        finish();
      }
      if (e.key === 'Escape') {
        workspaceName.removeEventListener('keydown', keyHandler);
        getWorkspace(currentWorkspaceId).then((currentWs) => {
          if (currentWs) workspaceName.textContent = currentWs.name;
        });
        workspaceName.contentEditable = 'false';
      }
    };

    workspaceName.addEventListener('keydown', keyHandler);
    workspaceName.addEventListener('blur', finish, { once: true });
  });
}

// --- Boot ---

async function boot() {
  try {
    await initDB();
    document.getElementById('loading-overlay').classList.add('hidden');

    allWorkspaces = await getWorkspaces();
    // initDB already creates a Default workspace if none exist,
    // so allWorkspaces should always have at least one entry.
    if (allWorkspaces.length === 0) {
      await createWorkspace('Default', 'You are Claude, a helpful AI assistant.', 'claude-sonnet-4-5-20250929');
      allWorkspaces = await getWorkspaces();
    }

    currentWorkspaceId = allWorkspaces[0].id;
    renderSidebar();
    await switchWorkspace(currentWorkspaceId);
    setupEventListeners();

    // Pulse settings button hint for new users
    if (allWorkspaces.length === 1 && allWorkspaces[0].name === 'Default') {
      const settingsBtn = document.getElementById('settings-toggle');
      settingsBtn.classList.add('pulse-hint');
      settingsBtn.addEventListener('click', () => settingsBtn.classList.remove('pulse-hint'), { once: true });

      // Add pulse animation style if not exists
      if (!document.getElementById('pulse-hint-style')) {
        const style = document.createElement('style');
        style.id = 'pulse-hint-style';
        style.textContent = `
          .pulse-hint {
            animation: pulse-ring 2s ease-in-out infinite;
          }
          @keyframes pulse-ring {
            0%, 100% { box-shadow: 0 0 0 0 rgba(10,132,255,0.4); }
            50% { box-shadow: 0 0 0 6px rgba(10,132,255,0); }
          }
        `;
        document.head.appendChild(style);
      }
    }
  } catch (err) {
    console.error('Boot failed:', err);
    const overlay = document.getElementById('loading-overlay');
    overlay.innerHTML = `<p style="color:#FF453A">Failed to initialize: ${escapeHtml(err.message)}</p>`;
  }
}

boot();

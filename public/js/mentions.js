// mentions.js - @agent autocomplete module for sangyi-tui

let autocompleteEl = null;
let activeIndex = 0;
let filteredAgents = [];
let cachedAgents = null;

/**
 * Detect @ mention pattern in textarea and show autocomplete.
 * Called on textarea 'input' event.
 * @param {HTMLTextAreaElement} textarea
 * @param {() => Promise<Array>} getAgentsFn - async fn returning agents array
 */
export async function handleMentionInput(textarea, getAgentsFn) {
  const text = textarea.value;
  const cursorPos = textarea.selectionStart;
  const textBeforeCursor = text.slice(0, cursorPos);

  const match = textBeforeCursor.match(/@(\w*)$/);
  if (!match) {
    closeMentionAutocomplete();
    return;
  }

  const filter = match[1].toLowerCase();

  if (!cachedAgents) {
    cachedAgents = await getAgentsFn();
  }

  filteredAgents = cachedAgents.filter((agent) => {
    const nameMatch = agent.name.toLowerCase().includes(filter);
    const idMatch = agent.id.toLowerCase().includes(filter);
    const categoryMatch = agent.category && agent.category.toLowerCase().includes(filter);
    return nameMatch || idMatch || categoryMatch;
  });

  if (filter === '') {
    filteredAgents = cachedAgents.slice();
  }

  filteredAgents = filteredAgents.slice(0, 6);

  if (filteredAgents.length === 0) {
    closeMentionAutocomplete();
    return;
  }

  activeIndex = 0;
  renderAutocomplete(textarea);
}

/**
 * Handle keydown for autocomplete navigation.
 * Called on textarea 'keydown' event.
 * @param {KeyboardEvent} e
 * @param {HTMLTextAreaElement} textarea
 */
export function handleMentionKeydown(e, textarea) {
  if (!autocompleteEl) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % filteredAgents.length;
    updateActiveItem();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = (activeIndex - 1 + filteredAgents.length) % filteredAgents.length;
    updateActiveItem();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    selectAgent(textarea, filteredAgents[activeIndex]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeMentionAutocomplete();
  }
}

/**
 * Close and remove autocomplete from DOM.
 */
export function closeMentionAutocomplete() {
  if (autocompleteEl) {
    autocompleteEl.remove();
    autocompleteEl = null;
  }
  filteredAgents = [];
  activeIndex = 0;
}

/**
 * Returns true if mention autocomplete is currently visible.
 * @returns {boolean}
 */
export function isMentionActive() {
  return autocompleteEl !== null;
}

/**
 * Find @agent-name in text and return the matching agent object.
 * @param {string} text - message text
 * @param {Array} agents - array of agent objects with .id and .name
 * @returns {object|null} matching agent or null
 */
export function extractMentionedAgent(text, agents) {
  if (!text || !agents || agents.length === 0) return null;

  const match = text.match(/@([\w-]+)/);
  if (!match) return null;

  const mentioned = match[1].toLowerCase();

  return agents.find((agent) => {
    return agent.id.toLowerCase() === mentioned ||
           agent.name.toLowerCase().replace(/\s+/g, '-') === mentioned;
  }) || null;
}

// --- Internal helpers ---

function renderAutocomplete(textarea) {
  const inputArea = document.getElementById('input-area');
  if (!inputArea) return;

  // Ensure parent has position relative for absolute child
  if (getComputedStyle(inputArea).position === 'static') {
    inputArea.style.position = 'relative';
  }

  if (!autocompleteEl) {
    autocompleteEl = document.createElement('div');
    autocompleteEl.id = 'mention-autocomplete';
    autocompleteEl.className = 'mention-autocomplete';
    inputArea.appendChild(autocompleteEl);
  }

  autocompleteEl.innerHTML = '';

  for (let i = 0; i < filteredAgents.length; i++) {
    const agent = filteredAgents[i];
    const item = document.createElement('div');
    item.className = 'mention-item' + (i === activeIndex ? ' active' : '');
    item.dataset.index = i;

    const icon = document.createElement('span');
    icon.className = 'mention-icon';
    icon.textContent = agent.icon || '';

    const info = document.createElement('div');
    info.className = 'mention-info';

    const name = document.createElement('span');
    name.className = 'mention-name';
    name.textContent = agent.name;

    const category = document.createElement('span');
    category.className = 'mention-category';
    category.textContent = agent.category || '';

    info.appendChild(name);
    info.appendChild(category);

    item.appendChild(icon);
    item.appendChild(info);

    item.addEventListener('mouseenter', () => {
      activeIndex = i;
      updateActiveItem();
    });

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectAgent(textarea, agent);
    });

    autocompleteEl.appendChild(item);
  }
}

function updateActiveItem() {
  if (!autocompleteEl) return;
  const items = autocompleteEl.querySelectorAll('.mention-item');
  items.forEach((item, i) => {
    item.classList.toggle('active', i === activeIndex);
  });
}

function selectAgent(textarea, agent) {
  if (!agent) return;

  const text = textarea.value;
  const cursorPos = textarea.selectionStart;
  const textBeforeCursor = text.slice(0, cursorPos);
  const textAfterCursor = text.slice(cursorPos);

  const match = textBeforeCursor.match(/@(\w*)$/);
  if (!match) return;

  const matchStart = textBeforeCursor.lastIndexOf('@');
  const before = text.slice(0, matchStart);
  const insertion = '@' + agent.id + ' ';
  const newText = before + insertion + textAfterCursor;

  textarea.value = newText;

  const newCursorPos = matchStart + insertion.length;
  textarea.selectionStart = newCursorPos;
  textarea.selectionEnd = newCursorPos;

  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  closeMentionAutocomplete();

  // Invalidate cache so next @ gets fresh data
  cachedAgents = null;
}

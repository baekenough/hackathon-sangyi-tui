// chat.js - SSE streaming client for Claude API
const API_URL = '/api/chat';
let currentController = null;

/**
 * Send a message to Claude via SSE streaming
 * @param {string} message - User message
 * @param {string|null} sessionId - Session ID for multi-turn
 * @param {string} systemPrompt - Composed system prompt
 * @param {string} model - Model to use
 * @param {function} onEvent - Callback for each SSE event
 * @returns {Promise<void>}
 */
export async function sendChatMessage(message, sessionId, systemPrompt, model, onEvent) {
  currentController = new AbortController();

  const body = { message };
  if (sessionId) body.session_id = sessionId;
  if (systemPrompt) body.system_prompt = systemPrompt;
  if (model) body.model = model;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: currentController.signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const event = JSON.parse(jsonStr);
        onEvent(event);
      } catch { /* skip malformed */ }
    }
  }
}

export function abortCurrentRequest() {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
}

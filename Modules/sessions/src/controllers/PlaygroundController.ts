/**
 * 测试页面控制器
 *
 * 提供一个简单的浏览器测试页面，用于手动验证会话和消息接口。
 */

import type { ServerResponse } from 'node:http';

/**
 * 测试页面控制器类
 */
export class PlaygroundController {
  /**
   * 处理测试页请求（GET /, GET /playground）
   */
  handlePage(response: ServerResponse): void {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(this.renderHtml());
  }

  /**
   * 渲染测试页 HTML
   */
  private renderHtml(): string {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sessions Playground</title>
  <style>
    :root {
      --bg: #f5efe4;
      --panel: rgba(255, 251, 245, 0.9);
      --panel-strong: #fffdf8;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: rgba(31, 41, 55, 0.12);
      --accent: #c4552d;
      --accent-strong: #8f2d14;
      --user: #1d4ed8;
      --assistant: #0f766e;
      --shadow: 0 20px 50px rgba(111, 79, 40, 0.16);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(196, 85, 45, 0.18), transparent 32%),
        radial-gradient(circle at top right, rgba(15, 118, 110, 0.14), transparent 28%),
        linear-gradient(180deg, #fbf7ef 0%, var(--bg) 100%);
      min-height: 100vh;
    }

    .shell {
      max-width: 1300px;
      margin: 0 auto;
      padding: 28px 18px 36px;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: end;
      margin-bottom: 18px;
    }

    .hero h1 {
      margin: 0;
      font-size: clamp(30px, 4vw, 44px);
      line-height: 1;
      letter-spacing: -0.04em;
    }

    .hero p {
      margin: 10px 0 0;
      color: var(--muted);
      max-width: 720px;
    }

    .badge {
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      font-size: 13px;
      color: var(--muted);
    }

    .layout {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 18px;
    }

    .panel {
      background: var(--panel);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }

    .panel-inner {
      padding: 18px;
    }

    .panel-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .panel-title h2 {
      margin: 0;
      font-size: 18px;
    }

    .hint {
      font-size: 13px;
      color: var(--muted);
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
    }

    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.82);
      border-radius: 14px;
      padding: 12px 14px;
      font: inherit;
      color: var(--ink);
      outline: none;
      transition: border-color 140ms ease, transform 140ms ease;
    }

    input:focus, textarea:focus {
      border-color: rgba(196, 85, 45, 0.65);
      transform: translateY(-1px);
    }

    textarea {
      min-height: 120px;
      resize: vertical;
    }

    .stack {
      display: grid;
      gap: 12px;
    }

    .row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    button {
      border: 0;
      border-radius: 999px;
      padding: 11px 16px;
      font: inherit;
      font-weight: 700;
      color: white;
      background: linear-gradient(135deg, var(--accent), var(--accent-strong));
      cursor: pointer;
      transition: transform 160ms ease, opacity 160ms ease;
    }

    button.secondary {
      color: var(--ink);
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid var(--line);
    }

    button.warn {
      background: linear-gradient(135deg, #b42318, #7a271a);
    }

    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }

    button:not(:disabled):hover {
      transform: translateY(-1px);
    }

    .sessions {
      max-height: 520px;
      overflow: auto;
      display: grid;
      gap: 10px;
    }

    .session-card {
      width: 100%;
      text-align: left;
      padding: 14px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid transparent;
      color: var(--ink);
      cursor: pointer;
      transition: border-color 160ms ease, transform 160ms ease;
    }

    .session-card:hover,
    .session-card.active {
      border-color: rgba(196, 85, 45, 0.45);
      transform: translateY(-1px);
    }

    .session-card strong,
    .message-text {
      word-break: break-word;
    }

    .session-meta,
    .meta-grid,
    .status-line {
      color: var(--muted);
      font-size: 12px;
    }

    .chat-grid {
      display: grid;
      grid-template-rows: auto 1fr auto;
      min-height: 760px;
    }

    .chat-head {
      padding: 18px 18px 10px;
      border-bottom: 1px solid var(--line);
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .messages {
      padding: 18px;
      overflow: auto;
      display: grid;
      gap: 14px;
      align-content: start;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0)),
        repeating-linear-gradient(180deg, transparent, transparent 31px, rgba(31, 41, 55, 0.03) 32px);
    }

    .empty {
      border: 1px dashed rgba(31, 41, 55, 0.18);
      border-radius: 18px;
      padding: 22px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.4);
    }

    .message {
      max-width: min(82%, 720px);
      padding: 14px 16px;
      border-radius: 18px;
      background: var(--panel-strong);
      border: 1px solid var(--line);
      box-shadow: 0 8px 24px rgba(31, 41, 55, 0.06);
    }

    .message.user {
      margin-left: auto;
      border-color: rgba(29, 78, 216, 0.18);
      background: rgba(219, 234, 254, 0.78);
    }

    .message.assistant {
      border-color: rgba(15, 118, 110, 0.18);
      background: rgba(204, 251, 241, 0.58);
    }

    .message-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 12px;
      color: var(--muted);
    }

    .role {
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .role.user { color: var(--user); }
    .role.assistant { color: var(--assistant); }

    .composer {
      padding: 16px 18px 18px;
      border-top: 1px solid var(--line);
      display: grid;
      gap: 10px;
    }

    .log {
      background: rgba(24, 24, 27, 0.92);
      color: #f5f5f5;
      border-radius: 16px;
      padding: 14px;
      font-family: Consolas, Monaco, monospace;
      font-size: 12px;
      max-height: 200px;
      overflow: auto;
      white-space: pre-wrap;
    }

    @media (max-width: 960px) {
      .layout { grid-template-columns: 1fr; }
      .chat-grid { min-height: 640px; }
      .meta-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div>
        <h1>Sessions Playground</h1>
        <p>直接测试 sessions 模块的会话创建、列表、删除，以及最小可用的消息收发能力。当前消息回复为模块内置模拟响应，便于联调和冒烟验证。</p>
      </div>
      <div class="badge" id="serviceStatus">服务地址: loading...</div>
    </div>

    <div class="layout">
      <section class="panel">
        <div class="panel-inner stack">
          <div class="panel-title">
            <h2>会话管理</h2>
            <button class="secondary" id="refreshSessionsBtn" type="button">刷新列表</button>
          </div>

          <div class="stack">
            <div>
              <label for="baseUrlInput">API Base URL</label>
              <input id="baseUrlInput" type="text">
            </div>
            <div>
              <label for="externalSourceInput">externalSource</label>
              <input id="externalSourceInput" type="text" placeholder="例如 wechat">
            </div>
            <div>
              <label for="externalConversationIdInput">externalConversationId</label>
              <input id="externalConversationIdInput" type="text" placeholder="例如 conv-001">
            </div>
            <div class="row">
              <button id="createSessionBtn" type="button">创建会话</button>
              <button class="warn" id="deleteSessionBtn" type="button" disabled>删除当前会话</button>
            </div>
            <div class="hint">点击左侧会话可加载消息。页面默认请求当前服务地址，也可以手动改成别的 sessions 实例。</div>
          </div>

          <div class="panel-title" style="margin-top: 8px;">
            <h2>会话列表</h2>
            <span class="hint" id="sessionCount">0 sessions</span>
          </div>
          <div class="sessions" id="sessionsList"></div>
        </div>
      </section>

      <section class="panel chat-grid">
        <div class="chat-head">
          <div class="panel-title" style="margin-bottom: 0;">
            <h2>消息调试</h2>
            <span class="hint" id="selectedSessionLabel">未选择会话</span>
          </div>
          <div class="meta-grid">
            <div>
              <strong>Session ID</strong>
              <div class="status-line" id="selectedSessionId">-</div>
            </div>
            <div>
              <strong>Status</strong>
              <div class="status-line" id="selectedSessionStatus">-</div>
            </div>
            <div>
              <strong>Created</strong>
              <div class="status-line" id="selectedSessionCreatedAt">-</div>
            </div>
            <div>
              <strong>Mappings</strong>
              <div class="status-line" id="selectedSessionMappings">-</div>
            </div>
          </div>
        </div>

        <div class="messages" id="messagesPanel">
          <div class="empty">先创建或选择一个会话，再发送测试消息。</div>
        </div>

        <div class="composer">
          <textarea id="messageInput" placeholder="输入测试消息，例如：你好，帮我确认当前 session 状态" disabled></textarea>
          <div class="row">
            <button id="sendMessageBtn" type="button" disabled>发送消息</button>
            <button class="secondary" id="reloadMessagesBtn" type="button" disabled>重新加载消息</button>
          </div>
          <div>
            <div class="hint" style="margin-bottom: 8px;">最近一次接口响应</div>
            <div class="log" id="responseLog">等待操作...</div>
          </div>
        </div>
      </section>
    </div>
  </div>

  <script>
    const state = {
      baseUrl: window.location.origin,
      sessions: [],
      selectedSessionId: null,
      selectedSession: null
    };

    const elements = {
      baseUrlInput: document.getElementById('baseUrlInput'),
      externalSourceInput: document.getElementById('externalSourceInput'),
      externalConversationIdInput: document.getElementById('externalConversationIdInput'),
      createSessionBtn: document.getElementById('createSessionBtn'),
      refreshSessionsBtn: document.getElementById('refreshSessionsBtn'),
      deleteSessionBtn: document.getElementById('deleteSessionBtn'),
      sessionsList: document.getElementById('sessionsList'),
      sessionCount: document.getElementById('sessionCount'),
      serviceStatus: document.getElementById('serviceStatus'),
      selectedSessionLabel: document.getElementById('selectedSessionLabel'),
      selectedSessionId: document.getElementById('selectedSessionId'),
      selectedSessionStatus: document.getElementById('selectedSessionStatus'),
      selectedSessionCreatedAt: document.getElementById('selectedSessionCreatedAt'),
      selectedSessionMappings: document.getElementById('selectedSessionMappings'),
      messagesPanel: document.getElementById('messagesPanel'),
      messageInput: document.getElementById('messageInput'),
      sendMessageBtn: document.getElementById('sendMessageBtn'),
      reloadMessagesBtn: document.getElementById('reloadMessagesBtn'),
      responseLog: document.getElementById('responseLog')
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function setLog(value) {
      elements.responseLog.textContent = typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2);
    }

    function getBaseUrl() {
      const value = elements.baseUrlInput.value.trim();
      return value || window.location.origin;
    }

    async function api(path, options) {
      const url = new URL(path, getBaseUrl()).toString();
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        },
        ...options
      });

      const text = await response.text();
      let data = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!response.ok) {
        const message = data && data.error ? data.error : 'Request failed: ' + response.status;
        throw new Error(message);
      }

      setLog(data || { ok: true, status: response.status });
      return data;
    }

    function formatTime(value) {
      if (!value) {
        return '-';
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }

      return date.toLocaleString();
    }

    function updateSelectionControls() {
      const hasActiveSession = !!state.selectedSessionId && state.selectedSession && state.selectedSession.status === 'active';
      elements.deleteSessionBtn.disabled = !state.selectedSessionId;
      elements.sendMessageBtn.disabled = !hasActiveSession;
      elements.reloadMessagesBtn.disabled = !state.selectedSessionId;
      elements.messageInput.disabled = !hasActiveSession;
    }

    function renderSessionMeta() {
      const session = state.selectedSession;

      if (!session) {
        elements.selectedSessionLabel.textContent = '未选择会话';
        elements.selectedSessionId.textContent = '-';
        elements.selectedSessionStatus.textContent = '-';
        elements.selectedSessionCreatedAt.textContent = '-';
        elements.selectedSessionMappings.textContent = '-';
        updateSelectionControls();
        return;
      }

      elements.selectedSessionLabel.textContent = '当前会话已连接';
      elements.selectedSessionId.textContent = session.sessionId;
      elements.selectedSessionStatus.textContent = session.status;
      elements.selectedSessionCreatedAt.textContent = formatTime(session.createdAt);
      elements.selectedSessionMappings.textContent = session.externalMappings && session.externalMappings.length
        ? session.externalMappings.map(function(item) {
            return item.source + '/' + item.conversationId;
          }).join(', ')
        : 'none';
      updateSelectionControls();
    }

    function renderSessions() {
      elements.sessionCount.textContent = state.sessions.length + ' sessions';

      if (!state.sessions.length) {
        elements.sessionsList.innerHTML = '<div class="empty">当前没有会话，先创建一个。</div>';
        return;
      }

      elements.sessionsList.innerHTML = state.sessions.map(function(session) {
        const mappings = session.externalMappings && session.externalMappings.length
          ? session.externalMappings.map(function(item) {
              return item.source + '/' + item.conversationId;
            }).join(', ')
          : 'none';
        const activeClass = state.selectedSessionId === session.sessionId ? ' active' : '';

        return '<button type="button" class="session-card' + activeClass + '" data-session-id="' + escapeHtml(session.sessionId) + '">'
          + '<strong>' + escapeHtml(session.sessionId) + '</strong>'
          + '<div class="session-meta">status: ' + escapeHtml(session.status) + '</div>'
          + '<div class="session-meta">created: ' + escapeHtml(formatTime(session.createdAt)) + '</div>'
          + '<div class="session-meta">mappings: ' + escapeHtml(mappings) + '</div>'
          + '</button>';
      }).join('');

      Array.from(elements.sessionsList.querySelectorAll('[data-session-id]')).forEach(function(button) {
        button.addEventListener('click', function() {
          const sessionId = button.getAttribute('data-session-id');
          if (sessionId) {
            selectSession(sessionId).catch(handleError);
          }
        });
      });
    }

    function renderMessages(messages) {
      if (!messages || !messages.length) {
        elements.messagesPanel.innerHTML = '<div class="empty">这个会话还没有消息，发送第一条来验证接口。</div>';
        return;
      }

      elements.messagesPanel.innerHTML = messages.map(function(message) {
        const roleClass = escapeHtml(message.role || 'assistant');
        return '<article class="message ' + roleClass + '">'
          + '<div class="message-head">'
          + '<span class="role ' + roleClass + '">' + escapeHtml(message.role) + '</span>'
          + '<span>' + escapeHtml(formatTime(message.createdAt)) + '</span>'
          + '</div>'
            + '<div class="message-text">' + escapeHtml(message.content).replace(/\\n/g, '<br>') + '</div>'
          + '</article>';
      }).join('');

      elements.messagesPanel.scrollTop = elements.messagesPanel.scrollHeight;
    }

    async function loadSessions() {
      const sessions = await api('/sessions');
      state.sessions = Array.isArray(sessions) ? sessions : [];

      if (state.selectedSessionId) {
        state.selectedSession = state.sessions.find(function(item) {
          return item.sessionId === state.selectedSessionId;
        }) || null;

        if (!state.selectedSession) {
          state.selectedSessionId = null;
          renderMessages([]);
        }
      }

      renderSessions();
      renderSessionMeta();
    }

    async function selectSession(sessionId) {
      const session = await api('/sessions/' + encodeURIComponent(sessionId));
      state.selectedSessionId = session.sessionId;
      state.selectedSession = session;
      renderSessions();
      renderSessionMeta();
      await loadMessages();
    }

    async function loadMessages() {
      if (!state.selectedSessionId) {
        renderMessages([]);
        return;
      }

      const data = await api('/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages');
      renderMessages(data.messages || []);
    }

    async function createSession() {
      const payload = {};
      const source = elements.externalSourceInput.value.trim();
      const conversationId = elements.externalConversationIdInput.value.trim();

      if (source) {
        payload.externalSource = source;
      }
      if (conversationId) {
        payload.externalConversationId = conversationId;
      }

      const data = await api('/sessions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      elements.messageInput.value = '';
      await loadSessions();
      await selectSession(data.sessionId);
    }

    async function deleteSelectedSession() {
      if (!state.selectedSessionId) {
        return;
      }

      await api('/sessions/' + encodeURIComponent(state.selectedSessionId), {
        method: 'DELETE'
      });

      state.selectedSessionId = null;
      state.selectedSession = null;
      renderMessages([]);
      await loadSessions();
    }

    async function sendMessage() {
      if (!state.selectedSessionId) {
        return;
      }

      const message = elements.messageInput.value.trim();
      if (!message) {
        throw new Error('请输入消息内容');
      }

      const data = await api('/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
        method: 'POST',
        body: JSON.stringify({ message: message })
      });

      elements.messageInput.value = '';
      renderMessages(data.messages || []);
      await loadSessions();
    }

    function handleError(error) {
      setLog({ error: error instanceof Error ? error.message : String(error) });
      window.console.error(error);
    }

    async function initialize() {
      elements.baseUrlInput.value = state.baseUrl;
      elements.serviceStatus.textContent = '服务地址: ' + state.baseUrl;

      elements.baseUrlInput.addEventListener('change', function() {
        state.baseUrl = getBaseUrl();
        elements.serviceStatus.textContent = '服务地址: ' + state.baseUrl;
        loadSessions().catch(handleError);
      });

      elements.refreshSessionsBtn.addEventListener('click', function() {
        loadSessions().catch(handleError);
      });

      elements.createSessionBtn.addEventListener('click', function() {
        createSession().catch(handleError);
      });

      elements.deleteSessionBtn.addEventListener('click', function() {
        deleteSelectedSession().catch(handleError);
      });

      elements.reloadMessagesBtn.addEventListener('click', function() {
        loadMessages().catch(handleError);
      });

      elements.sendMessageBtn.addEventListener('click', function() {
        sendMessage().catch(handleError);
      });

      elements.messageInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendMessage().catch(handleError);
        }
      });

      await loadSessions();
      updateSelectionControls();
    }

    initialize().catch(handleError);
  </script>
</body>
</html>`;
  }
}
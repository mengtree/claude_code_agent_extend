/**
 * Platform Dashboard
 * Monitor and manage the Agent Platform
 */

class PlatformDashboard {
  constructor() {
    this.apiUrl = window.location.origin;
    this.modules = [];
    this.processes = [];
    this.messages = [];
    this.subscribers = [];
    this.eventSource = null;
    this.filterStatus = '';
    this.filterKind = '';
    this.autoScroll = true;
    this.currentPage = 'dashboard';
    this.activities = [];

    this.init();
  }

  init() {
    this.bindElements();
    this.bindEvents();
    this.loadInitialData();
    this.connectSSE();
  }

  bindElements() {
    // Navigation elements
    this.navItems = document.querySelectorAll('.nav-item');

    // Page elements
    this.pages = {
      dashboard: document.getElementById('page-dashboard'),
      modules: document.getElementById('page-modules'),
      core: document.getElementById('page-core'),
      adapters: document.getElementById('page-adapters'),
      executors: document.getElementById('page-executors'),
      managers: document.getElementById('page-managers'),
      messages: document.getElementById('page-messages'),
      subscribers: document.getElementById('page-subscribers'),
      settings: document.getElementById('page-settings')
    };

    // Status elements
    this.connectionStatus = document.getElementById('connection-status');
    this.platformVersion = document.getElementById('platform-version');
    this.platformUptime = document.getElementById('platform-uptime');
    this.btnRefresh = document.getElementById('btn-refresh');
    this.pageTitle = document.getElementById('page-title');

    // Stats elements
    this.statTotalModules = document.getElementById('stat-total-modules');
    this.statRunningModules = document.getElementById('stat-running-modules');
    this.statTotalMessages = document.getElementById('stat-total-messages');
    this.statSubscribers = document.getElementById('stat-subscribers');

    // Filter elements
    this.filterStatusSelect = document.getElementById('filter-status');
    this.filterKindSelect = document.getElementById('filter-kind');

    // Table bodies
    this.modulesTableBody = document.getElementById('modules-table-body');
    this.coreTableBody = document.getElementById('core-table-body');
    this.adaptersTableBody = document.getElementById('adapters-table-body');
    this.executorsTableBody = document.getElementById('executors-table-body');
    this.managersTableBody = document.getElementById('managers-table-body');

    // Containers
    this.messagesContainer = document.getElementById('messages-container');
    this.subscribersList = document.getElementById('subscribers-list');
    this.activityList = document.getElementById('activity-list');
    this.autoScrollCheckbox = document.getElementById('auto-scroll-messages');

    // Quick action buttons
    this.quickActionBtns = document.querySelectorAll('.quick-action-btn');

    // Nav badges
    this.navBadges = {
      modules: document.getElementById('nav-badge-modules'),
      core: document.getElementById('nav-badge-core'),
      adapters: document.getElementById('nav-badge-adapters'),
      executors: document.getElementById('nav-badge-executors'),
      managers: document.getElementById('nav-badge-managers'),
      messages: document.getElementById('nav-badge-messages'),
      subscribers: document.getElementById('nav-badge-subscribers')
    };

    // Settings elements
    this.settingVersion = document.getElementById('setting-version');
    this.settingUptime = document.getElementById('setting-uptime');
    this.settingTotalModules = document.getElementById('setting-total-modules');
    this.settingRunningModules = document.getElementById('setting-running-modules');
    this.settingTotalMessages = document.getElementById('setting-total-messages');
    this.settingSubscribers = document.getElementById('setting-subscribers');

    // Modal elements
    this.moduleModal = document.getElementById('module-modal');
    this.modalOverlay = document.getElementById('modal-overlay');
    this.modalClose = document.getElementById('modal-close');
    this.modalTitle = document.getElementById('modal-title');
    this.modalBody = document.getElementById('modal-body');
  }

  bindEvents() {
    // Navigation
    this.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        this.navigateTo(page);
      });
    });

    // Refresh
    this.btnRefresh.addEventListener('click', () => this.refreshData());

    // Filters
    this.filterStatusSelect.addEventListener('change', (e) => {
      this.filterStatus = e.target.value;
      this.renderModules();
    });
    this.filterKindSelect.addEventListener('change', (e) => {
      this.filterKind = e.target.value;
      this.renderModules();
    });

    // Auto scroll
    this.autoScrollCheckbox.addEventListener('change', (e) => {
      this.autoScroll = e.target.checked;
    });

    // Quick actions
    this.quickActionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.executeQuickAction(action);
      });
    });

    // Modal events
    this.modalClose.addEventListener('click', () => this.closeModal());
    this.modalOverlay.addEventListener('click', () => this.closeModal());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
    });

    // Handle hash changes
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.slice(1) || 'dashboard';
      this.navigateTo(hash);
    });
  }

  navigateTo(page) {
    if (!this.pages[page]) {
      page = 'dashboard';
    }

    // Update current page
    this.currentPage = page;

    // Update navigation
    this.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Update pages
    Object.values(this.pages).forEach(p => p?.classList.remove('active'));
    this.pages[page]?.classList.add('active');

    // Update page title
    const titles = {
      dashboard: '仪表板',
      modules: '所有模块',
      core: '核心模块',
      adapters: '适配器',
      executors: '执行器',
      managers: '管理器',
      messages: '消息历史',
      subscribers: 'SSE 订阅者',
      settings: '系统配置'
    };
    this.pageTitle.textContent = titles[page] || '仪表板';

    // Update URL hash
    if (window.location.hash !== `#${page}`) {
      history.pushState(null, '', `#${page}`);
    }

    // Render page-specific content
    this.renderCurrentPage();
  }

  renderCurrentPage() {
    switch (this.currentPage) {
      case 'modules':
        this.renderModulesTable(this.modulesTableBody, this.modules);
        break;
      case 'core':
        this.renderModulesTable(this.coreTableBody, this.modules.filter(m => m.kind === 'core'));
        break;
      case 'adapters':
        this.renderModulesTable(this.adaptersTableBody, this.modules.filter(m => m.kind === 'adapter'));
        break;
      case 'executors':
        this.renderModulesTable(this.executorsTableBody, this.modules.filter(m => m.kind === 'executor'));
        break;
      case 'managers':
        this.renderModulesTable(this.managersTableBody, this.modules.filter(m => m.kind === 'manager'));
        break;
      case 'messages':
        this.renderMessages();
        break;
      case 'subscribers':
        this.renderSubscribers();
        break;
      case 'settings':
        this.renderSettings();
        break;
      default:
        // Dashboard is rendered by loadInitialData
        break;
    }
  }

  async loadInitialData() {
    try {
      const response = await fetch(`${this.apiUrl}/api/dashboard`);
      const data = await response.json();

      if (data.ok) {
        this.platformVersion.textContent = `v${data.version}`;
        this.updateUptime(data.uptimeSec);
        this.modules = data.modules || [];
        this.processes = data.processes || [];
        this.messages = data.messages?.items || [];
        this.subscribers = data.subscribers || [];

        this.updateStats(data);
        this.updateNavBadges();
        this.renderDashboard();
        this.renderCurrentPage();

        this.updateConnectionStatus('connected');
      }
    } catch (error) {
      console.error('Failed to load initial data:', error);
      this.updateConnectionStatus('disconnected');
    }
  }

  refreshData() {
    this.btnRefresh.classList.add('loading');
    this.loadInitialData().finally(() => {
      this.btnRefresh.classList.remove('loading');
    });
  }

  updateStats(data) {
    this.statTotalModules.textContent = data.runtime?.modules?.total || 0;
    this.statRunningModules.textContent = data.runtime?.modules?.byStatus?.running || 0;
    this.statTotalMessages.textContent = data.messages?.count || 0;
    this.statSubscribers.textContent = this.subscribers.length;
  }

  updateNavBadges() {
    const counts = {
      modules: this.modules.length,
      core: this.modules.filter(m => m.kind === 'core').length,
      adapters: this.modules.filter(m => m.kind === 'adapter').length,
      executors: this.modules.filter(m => m.kind === 'executor').length,
      managers: this.modules.filter(m => m.kind === 'manager').length,
      messages: this.messages.length,
      subscribers: this.subscribers.length
    };

    Object.entries(counts).forEach(([key, value]) => {
      if (this.navBadges[key]) {
        this.navBadges[key].textContent = value;
      }
    });
  }

  updateUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    this.platformUptime.textContent = `运行时间: ${hours}h ${minutes}m ${secs}s`;
  }

  updateConnectionStatus(status) {
    const dot = this.connectionStatus.querySelector('.dot');
    const text = this.connectionStatus.querySelector('.text');

    dot.className = 'dot';
    dot.classList.add(status);

    switch (status) {
      case 'connected':
        text.textContent = '已连接';
        break;
      case 'connecting':
        text.textContent = '连接中...';
        break;
      case 'disconnected':
        text.textContent = '已断开';
        break;
    }
  }

  renderDashboard() {
    this.renderActivities();
  }

  renderActivities() {
    // Combine module status changes with recent messages
    const activities = [];

    // Add module status activities
    this.modules.forEach(module => {
      if (module.status === 'failed') {
        activities.push({
          type: 'failed',
          title: `${module.name} 失败`,
          time: module.startedAt || module.registeredAt
        });
      } else if (module.status === 'running' && module.startedAt) {
        activities.push({
          type: 'started',
          title: `${module.name} 已启动`,
          time: module.startedAt
        });
      }
    });

    // Sort by time (most recent first)
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));

    // Take last 10
    const recentActivities = activities.slice(0, 10);

    if (recentActivities.length === 0) {
      this.activityList.innerHTML = '<div class="placeholder">暂无活动</div>';
      return;
    }

    this.activityList.innerHTML = recentActivities.map(activity => `
      <div class="activity-item">
        <div class="activity-icon ${activity.type}">
          ${activity.type === 'started' ?
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>' :
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
          }
        </div>
        <div class="activity-content">
          <div class="activity-title">${this.escapeHtml(activity.title)}</div>
          <div class="activity-time">${this.formatTime(activity.time)}</div>
        </div>
      </div>
    `).join('');
  }

  renderModules() {
    let filteredModules = this.modules;

    if (this.filterStatus) {
      filteredModules = filteredModules.filter(m => m.status === this.filterStatus);
    }

    if (this.filterKind) {
      filteredModules = filteredModules.filter(m => m.kind === this.filterKind);
    }

    this.renderModulesTable(this.modulesTableBody, filteredModules);
  }

  renderModulesTable(tbody, modules) {
    if (!tbody) return;

    if (modules.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="${this.currentPage === 'modules' ? 8 : 7}" class="no-data">没有找到匹配的模块</td>
        </tr>
      `;
      return;
    }

    const isMainPage = this.currentPage === 'modules';

    tbody.innerHTML = modules.map(module => {
      const process = this.processes.find(p => p.moduleId === module.moduleId);
      const statusClass = this.getStatusClass(module.status);
      const kindClass = module.kind;

      return `
        <tr>
          <td><span class="module-id">${this.escapeHtml(module.moduleId)}</span></td>
          <td><span class="module-name">${this.escapeHtml(module.name)}</span></td>
          ${isMainPage ? `<td><span class="module-kind ${kindClass}">${this.getKindLabel(module.kind)}</span></td>` : ''}
          <td>
            <span class="module-status ${statusClass}">
              <span class="status-dot"></span>
              ${this.getStatusLabel(module.status)}
            </span>
          </td>
          <td>${module.pid || '-'}</td>
          <td>${module.startedAt ? this.formatTime(module.startedAt) : '-'}</td>
          <td>${process?.restartCount || 0}</td>
          <td>
            <div class="actions">
              ${this.renderModuleActions(module)}
              <button class="btn-action view" onclick="dashboard.viewModule('${module.moduleId}')" title="查看详情">详情</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Bind action button events
    this.bindModuleActions();
  }

  renderModuleActions(module) {
    const actions = [];

    if (module.status === 'running') {
      actions.push(`<button class="btn-action stop" data-module="${module.moduleId}" data-action="stop" title="停止模块">停止</button>`);
      actions.push(`<button class="btn-action restart" data-module="${module.moduleId}" data-action="restart" title="重启模块">重启</button>`);
    } else if (module.status === 'stopped' || module.status === 'failed' || module.status === 'registered') {
      actions.push(`<button class="btn-action start" data-module="${module.moduleId}" data-action="start" title="启动模块">启动</button>`);
    }

    return actions.join('');
  }

  bindModuleActions() {
    const actionButtons = document.querySelectorAll('.btn-action.start, .btn-action.stop, .btn-action.restart');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const moduleId = e.target.dataset.module;
        const action = e.target.dataset.action;
        await this.executeModuleAction(moduleId, action);
      });
    });
  }

  async executeQuickAction(action) {
    switch (action) {
      case 'start-all':
        const stoppedModules = this.modules.filter(m => m.status === 'stopped' || m.status === 'registered');
        for (const module of stoppedModules) {
          await this.executeModuleAction(module.moduleId, 'start');
        }
        break;
      case 'stop-all':
        const runningModules = this.modules.filter(m => m.status === 'running');
        for (const module of runningModules) {
          await this.executeModuleAction(module.moduleId, 'stop');
        }
        break;
      case 'restart-failed':
        const failedModules = this.modules.filter(m => m.status === 'failed');
        for (const module of failedModules) {
          await this.executeModuleAction(module.moduleId, 'restart');
        }
        break;
    }
  }

  async executeModuleAction(moduleId, action) {
    const button = document.querySelector(`[data-module="${moduleId}"][data-action="${action}"]`);
    if (button) {
      button.disabled = true;
      button.textContent = action === 'start' ? '启动中...' : action === 'stop' ? '停止中...' : '重启中...';
    }

    try {
      const response = await fetch(`${this.apiUrl}/modules/${moduleId}/${action}`, {
        method: 'POST'
      });
      const result = await response.json();

      if (result.ok) {
        // Refresh data after a short delay
        setTimeout(() => this.refreshData(), 1000);
      } else {
        alert(`操作失败: ${result.error}`);
        if (button) {
          button.disabled = false;
          button.textContent = action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启';
        }
      }
    } catch (error) {
      console.error(`Failed to ${action} module:`, error);
      alert(`操作失败: ${error.message}`);
      if (button) {
        button.disabled = false;
        button.textContent = action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启';
      }
    }
  }

  renderMessages() {
    if (this.messages.length === 0) {
      this.messagesContainer.innerHTML = '<div class="message-placeholder">暂无消息</div>';
      return;
    }

    this.messagesContainer.innerHTML = this.messages.map(msg => `
      <div class="message-item">
        <div class="message-header">
          <div>
            <span class="message-from">${this.escapeHtml(msg.fromModule)}</span>
            <span class="message-arrow">→</span>
            <span class="message-to">${this.escapeHtml(msg.toModule || 'broadcast')}</span>
          </div>
          <span class="message-time">${this.formatTime(msg.createdAt)}</span>
        </div>
        <div class="message-action">${this.escapeHtml(msg.action)}</div>
        ${msg.payload ? `<div class="message-payload">${this.escapeHtml(JSON.stringify(msg.payload, null, 2))}</div>` : ''}
      </div>
    `).join('');

    if (this.autoScroll) {
      this.scrollToBottom(this.messagesContainer);
    }
  }

  renderSubscribers() {
    if (this.subscribers.length === 0) {
      this.subscribersList.innerHTML = '<div class="placeholder">暂无订阅者</div>';
      return;
    }

    this.subscribersList.innerHTML = this.subscribers.map(sub => `
      <div class="subscriber-item">
        <span class="subscriber-module">${this.escapeHtml(sub.module)}</span>
        <span class="subscriber-time">${this.formatTime(sub.connectedAt)}</span>
      </div>
    `).join('');
  }

  renderSettings() {
    this.settingVersion.textContent = this.platformVersion.textContent.replace('v', '');
    this.settingUptime.textContent = this.platformUptime.textContent.replace('运行时间: ', '');
    this.settingTotalModules.textContent = this.statTotalModules.textContent;
    this.settingRunningModules.textContent = this.statRunningModules.textContent;
    this.settingTotalMessages.textContent = this.statTotalMessages.textContent;
    this.settingSubscribers.textContent = this.statSubscribers.textContent;
  }

  addMessage(message) {
    this.messages.push(message);
    // Keep only last 100 messages
    if (this.messages.length > 100) {
      this.messages = this.messages.slice(-100);
    }

    // Update nav badge
    if (this.navBadges.messages) {
      this.navBadges.messages.textContent = this.messages.length;
    }
    this.statTotalMessages.textContent = this.messages.length;

    // Add to DOM if on messages page
    if (this.currentPage === 'messages') {
      const messageEl = document.createElement('div');
      messageEl.className = 'message-item';
      messageEl.innerHTML = `
        <div class="message-header">
          <div>
            <span class="message-from">${this.escapeHtml(message.fromModule)}</span>
            <span class="message-arrow">→</span>
            <span class="message-to">${this.escapeHtml(message.toModule || 'broadcast')}</span>
          </div>
          <span class="message-time">${this.formatTime(message.createdAt)}</span>
        </div>
        <div class="message-action">${this.escapeHtml(message.action)}</div>
        ${message.payload ? `<div class="message-payload">${this.escapeHtml(JSON.stringify(message.payload, null, 2))}</div>` : ''}
      `;

      // Remove placeholder if exists
      const placeholder = this.messagesContainer.querySelector('.message-placeholder');
      if (placeholder) {
        placeholder.remove();
      }

      this.messagesContainer.appendChild(messageEl);

      if (this.autoScroll) {
        this.scrollToBottom(this.messagesContainer);
      }
    }
  }

  scrollToBottom(element) {
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }

  connectSSE() {
    this.updateConnectionStatus('connecting');

    // Create a unique subscription for dashboard
    const dashboardId = `dashboard-${Date.now()}`;
    this.eventSource = new EventSource(`${this.apiUrl}/subscribe?module=${dashboardId}`);

    this.eventSource.addEventListener('connected', (e) => {
      this.updateConnectionStatus('connected');
    });

    this.eventSource.addEventListener('heartbeat', (e) => {
      // Keep alive, ignore
    });

    this.eventSource.addEventListener('message', (e) => {
      try {
        const message = JSON.parse(e.data);
        this.addMessage(message);
      } catch (error) {
        console.error('Failed to parse SSE message:', error);
      }
    });

    this.eventSource.onerror = () => {
      this.updateConnectionStatus('disconnected');
      // Reconnect after 5 seconds
      setTimeout(() => {
        if (this.eventSource.readyState === EventSource.CLOSED) {
          this.connectSSE();
        }
      }, 5000);
    };
  }

  async viewModule(moduleId) {
    try {
      const response = await fetch(`${this.apiUrl}/api/modules/${moduleId}`);
      if (response.status === 404) {
        alert('模块未找到');
        return;
      }
      const module = await response.json();
      this.showModuleDetail(module);
    } catch (error) {
      console.error('Failed to load module details:', error);
      alert('加载模块详情失败');
    }
  }

  showModuleDetail(module) {
    this.modalTitle.textContent = `模块详情 - ${module.manifest.name}`;
    this.modalBody.innerHTML = `
      <div class="module-detail-section">
        <h4 class="module-detail-title">基本信息</h4>
        <div class="module-detail-row">
          <span class="module-detail-label">模块 ID</span>
          <span class="module-detail-value"><code>${this.escapeHtml(module.moduleId)}</code></span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">名称</span>
          <span class="module-detail-value">${this.escapeHtml(module.manifest.name)}</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">版本</span>
          <span class="module-detail-value">${this.escapeHtml(module.manifest.version)}</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">类型</span>
          <span class="module-detail-value">${this.getKindLabel(module.manifest.kind)}</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">状态</span>
          <span class="module-detail-value">${this.getStatusLabel(module.status)}</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">描述</span>
          <span class="module-detail-value">${this.escapeHtml(module.manifest.description || '-')}</span>
        </div>
        ${module.pid ? `
        <div class="module-detail-row">
          <span class="module-detail-label">进程 ID</span>
          <span class="module-detail-value"><code>${module.pid}</code></span>
        </div>
        ` : ''}
        <div class="module-detail-row">
          <span class="module-detail-label">注册时间</span>
          <span class="module-detail-value">${this.formatTime(module.registeredAt)}</span>
        </div>
        ${module.startedAt ? `
        <div class="module-detail-row">
          <span class="module-detail-label">启动时间</span>
          <span class="module-detail-value">${this.formatTime(module.startedAt)}</span>
        </div>
        ` : ''}
      </div>

      <div class="module-detail-section">
        <h4 class="module-detail-title">启动配置</h4>
        <div class="module-detail-row">
          <span class="module-detail-label">自动启动</span>
          <span class="module-detail-value">${module.manifest.startup?.autoStart ? '是' : '否'}</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">守护进程</span>
          <span class="module-detail-value">${module.manifest.startup?.daemon ? '是' : '否'}</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">重启策略</span>
          <span class="module-detail-value">${module.manifest.startup?.restartPolicy || '-'}</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">启动延迟</span>
          <span class="module-detail-value">${module.manifest.startup?.delayMs || '-'} ms</span>
        </div>
      </div>

      <div class="module-detail-section">
        <h4 class="module-detail-title">启动命令</h4>
        <div class="module-detail-row">
          <span class="module-detail-label">命令</span>
          <span class="module-detail-value"><code>${this.escapeHtml(module.manifest.entry.command)}</code></span>
        </div>
        ${module.manifest.entry.args ? `
        <div class="module-detail-row">
          <span class="module-detail-label">参数</span>
          <span class="module-detail-value"><code>${this.escapeHtml(module.manifest.entry.args.join(' '))}</code></span>
        </div>
        ` : ''}
      </div>

      ${module.manifest.healthCheck ? `
      <div class="module-detail-section">
        <h4 class="module-detail-title">健康检查</h4>
        <div class="module-detail-row">
          <span class="module-detail-label">类型</span>
          <span class="module-detail-value">${module.manifest.healthCheck.type}</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">路径</span>
          <span class="module-detail-value"><code>${this.escapeHtml(module.manifest.healthCheck.path || '/health')}</code></span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">检查间隔</span>
          <span class="module-detail-value">${module.manifest.healthCheck.intervalMs || '-'} ms</span>
        </div>
        <div class="module-detail-row">
          <span class="module-detail-label">超时</span>
          <span class="module-detail-value">${module.manifest.healthCheck.timeoutMs || '-'} ms</span>
        </div>
      </div>
      ` : ''}

      ${module.manifest.capabilities && module.manifest.capabilities.length > 0 ? `
      <div class="module-detail-section">
        <h4 class="module-detail-title">能力</h4>
        <div class="capability-list">
          ${module.manifest.capabilities.map(cap => `
            <div class="capability-item">
              <div class="capability-action">${this.escapeHtml(cap.action)}</div>
              <div class="capability-desc">${this.escapeHtml(cap.description || '-')}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <div class="module-detail-section">
        <h4 class="module-detail-title">模块清单</h4>
        <pre>${this.escapeHtml(JSON.stringify(module.manifest, null, 2))}</pre>
      </div>
    `;

    this.moduleModal.classList.add('active');
  }

  closeModal() {
    this.moduleModal.classList.remove('active');
  }

  getStatusClass(status) {
    const statusMap = {
      'running': 'running',
      'stopped': 'stopped',
      'starting': 'starting',
      'restarting': 'restarting',
      'failed': 'failed',
      'unhealthy': 'unhealthy',
      'registered': 'stopped',
      'installing': 'starting',
      'paused': 'stopped',
      'disabled': 'stopped'
    };
    return statusMap[status] || 'stopped';
  }

  getStatusLabel(status) {
    const labels = {
      'registered': '已注册',
      'installing': '安装中',
      'stopped': '已停止',
      'starting': '启动中',
      'running': '运行中',
      'unhealthy': '不健康',
      'restarting': '重启中',
      'paused': '已暂停',
      'failed': '失败',
      'disabled': '已禁用'
    };
    return labels[status] || status;
  }

  getKindLabel(kind) {
    const labels = {
      'core': '核心',
      'adapter': '适配器',
      'executor': '执行器',
      'manager': '管理器'
    };
    return labels[kind] || kind;
  }

  formatTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    // Less than 1 minute
    if (diff < 60000) {
      return '刚刚';
    }

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes} 分钟前`;
    }

    // Less than 1 day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} 小时前`;
    }

    // Format date
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
}

// Initialize dashboard when DOM is ready
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
  dashboard = new PlatformDashboard();

  // Handle initial hash
  const initialHash = window.location.hash.slice(1) || 'dashboard';
  dashboard.navigateTo(initialHash);
});

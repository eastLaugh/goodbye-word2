// 弹出窗口脚本
class PopupManager {
  constructor() {
    this.currentTab = 'vocabulary';
    this.vocabulary = [];
    this.filteredVocabulary = [];
    this.init();
  }

  async init() {
    this.bindEvents();
    await this.loadSettings();
    await this.loadVocabulary();
    this.updateStatusIndicator();
  }

  bindEvents() {
    // 标签页切换
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // 搜索功能
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.filterVocabulary(e.target.value);
    });

    // 清空生词本
    document.getElementById('clearVocabulary').addEventListener('click', () => {
      this.clearVocabulary();
    });

    // 设置相关
    document.getElementById('saveSettings').addEventListener('click', () => {
      this.saveSettings();
    });

    document.getElementById('testApi').addEventListener('click', () => {
      this.testApi();
    });

    document.getElementById('toggleApiKey').addEventListener('click', () => {
      this.toggleApiKeyVisibility();
    });
  }

  switchTab(tabName) {
    // 更新标签页按钮状态
    document.querySelectorAll('.tab-button').forEach(button => {
      button.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // 更新标签页内容
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');

    this.currentTab = tabName;
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['deepseek_api_key', 'settings'], (result) => {
        const apiKey = result.deepseek_api_key || '';
        const settings = result.settings || {};

        document.getElementById('apiKeyInput').value = apiKey;

        resolve();
      });
    });
  }

  async saveSettings() {
    const apiKey = document.getElementById('apiKeyInput').value;

    const settings = {
      deepseek_api_key: apiKey,
      settings: {}
    };

    return new Promise((resolve) => {
      chrome.storage.sync.set(settings, () => {
        // 通知所有标签页设置已更新
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: 'settingsUpdated' }).catch(() => {
              // 忽略错误（某些标签页可能没有content script）
            });
          });
        });
        
        this.showMessage('设置已保存！', 'success');
        this.updateStatusIndicator();
        resolve();
      });
    });
  }

  async testApi() {
    const apiKey = document.getElementById('apiKeyInput').value;
    
    if (!apiKey) {
      this.showMessage('请先输入API密钥', 'error');
      return;
    }

    // 显示API收费警告
    const warningMessage = '⚠️ 警告：测试API连接可能会产生DeepSeek API费用。\n\n确定要继续测试吗？';
    if (!confirm(warningMessage)) {
      return;
    }

    this.showMessage('正在测试API连接...', 'info');

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'user',
              content: 'Hello'
            }
          ],
          max_tokens: 10
        })
      });

      if (response.ok) {
        this.showMessage('API连接成功！DeepSeek V3 已就绪', 'success');
      } else {
        this.showMessage(`API连接失败: ${response.status}`, 'error');
      }
    } catch (error) {
      this.showMessage(`API连接错误: ${error.message}`, 'error');
    }
  }

  toggleApiKeyVisibility() {
    const input = document.getElementById('apiKeyInput');
    const button = document.getElementById('toggleApiKey');
    
    if (input.type === 'password') {
      input.type = 'text';
      button.textContent = '🙈';
    } else {
      input.type = 'password';
      button.textContent = '👁';
    }
  }

  async loadVocabulary() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['vocabulary'], (result) => {
        this.vocabulary = result.vocabulary || [];
        this.filteredVocabulary = [...this.vocabulary];
        this.renderVocabulary();
        resolve();
      });
    });
  }

  filterVocabulary(query) {
    if (!query.trim()) {
      this.filteredVocabulary = [...this.vocabulary];
    } else {
      const lowerQuery = query.toLowerCase();
      this.filteredVocabulary = this.vocabulary.filter(item => 
        item.word.toLowerCase().includes(lowerQuery) ||
        item.translation.toLowerCase().includes(lowerQuery) ||
        item.context.toLowerCase().includes(lowerQuery) ||
        item.explanation.toLowerCase().includes(lowerQuery)
      );
    }
    this.renderVocabulary();
  }

  renderVocabulary() {
    const vocabularyList = document.getElementById('vocabularyList');
    const emptyState = document.getElementById('emptyState');

    if (this.filteredVocabulary.length === 0) {
      vocabularyList.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    vocabularyList.style.display = 'block';
    emptyState.style.display = 'none';

    vocabularyList.innerHTML = this.filteredVocabulary.map((item, index) => `
      <div class="vocabulary-item" data-index="${index}">
        <div class="vocabulary-content">
          <div class="vocabulary-word">${this.escapeHtml(item.word)}</div>
          <div class="vocabulary-translation">${this.escapeHtml(item.translation)}</div>
          ${item.phonetic ? `<div class="vocabulary-phonetic">${this.escapeHtml(item.phonetic)}</div>` : ''}
          <div class="vocabulary-context">${this.escapeHtml(item.context)}</div>
          <div class="vocabulary-explanation">${this.escapeHtml(item.explanation)}</div>
          <div class="vocabulary-time">${this.formatTime(item.timestamp)}</div>
        </div>
        <button class="vocabulary-delete" title="删除此单词">🗑️</button>
      </div>
    `).join('');

    // 绑定删除按钮事件
    vocabularyList.querySelectorAll('.vocabulary-delete').forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.vocabulary-item');
        const index = parseInt(item.dataset.index);
        this.deleteVocabularyItem(index);
      });
    });
  }

  async deleteVocabularyItem(index) {
    const item = this.filteredVocabulary[index];
    if (!item) return;

    if (confirm(`确定要删除单词 "${item.word}" 吗？`)) {
      // 从原始词汇表中找到并删除
      const originalIndex = this.vocabulary.findIndex(v => 
        v.word === item.word && v.timestamp === item.timestamp
      );
      
      if (originalIndex !== -1) {
        this.vocabulary.splice(originalIndex, 1);
        
        // 更新存储
        return new Promise((resolve) => {
          chrome.storage.local.set({ vocabulary: this.vocabulary }, () => {
            // 重新过滤和渲染
            this.filterVocabulary(document.getElementById('searchInput').value);
            this.showMessage(`已删除单词 "${item.word}"`, 'success');
            
            // 通知所有标签页更新词汇表
            chrome.tabs.query({}, (tabs) => {
              tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'vocabularyUpdated' }).catch(() => {
                  // 忽略错误（某些标签页可能没有content script）
                });
              });
            });
            
            resolve();
          });
        });
      }
    }
  }

  async clearVocabulary() {
    if (confirm('确定要清空所有生词吗？此操作不可恢复。')) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ vocabulary: [] }, () => {
          this.vocabulary = [];
          this.filteredVocabulary = [];
          this.renderVocabulary();
          this.showMessage('生词本已清空', 'success');
          
          // 通知所有标签页更新词汇表
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
              chrome.tabs.sendMessage(tab.id, { action: 'vocabularyUpdated' }).catch(() => {
                // 忽略错误（某些标签页可能没有content script）
              });
            });
          });
          
          resolve();
        });
      });
    }
  }

  updateStatusIndicator() {
    const indicator = document.getElementById('statusIndicator');
    const apiKey = document.getElementById('apiKeyInput').value;
    
    if (apiKey) {
      indicator.classList.remove('error');
    } else {
      indicator.classList.add('error');
    }
  }

  showMessage(message, type = 'info') {
    // 创建消息元素
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${type}`;
    messageEl.textContent = message;
    messageEl.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 16px;
      border-radius: 6px;
      color: white;
      font-size: 14px;
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    `;

    // 根据类型设置背景色
    switch (type) {
      case 'success':
        messageEl.style.background = '#4caf50';
        break;
      case 'error':
        messageEl.style.background = '#f44336';
        break;
      case 'info':
      default:
        messageEl.style.background = '#2196f3';
        break;
    }

    document.body.appendChild(messageEl);

    // 3秒后自动移除
    setTimeout(() => {
      messageEl.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        if (messageEl.parentNode) {
          messageEl.parentNode.removeChild(messageEl);
        }
      }, 300);
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) { // 1分钟内
      return '刚刚';
    } else if (diff < 3600000) { // 1小时内
      return `${Math.floor(diff / 60000)}分钟前`;
    } else if (diff < 86400000) { // 1天内
      return `${Math.floor(diff / 3600000)}小时前`;
    } else {
      return date.toLocaleDateString();
    }
  }
}

// 添加消息动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// 初始化弹出窗口
new PopupManager(); 
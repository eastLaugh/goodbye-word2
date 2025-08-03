

/**
 * 智能选中翻译插件 - 内容脚本
 * 主要功能：
 * 1. 双击选中文本，单击激活翻译
 * 2. 自动扫描页面中的生词本单词并添加气泡
 * 3. 管理翻译气泡和生词本气泡
 * 4. 与background script通信处理API请求
 */
class SmartSelectionTranslator {
  constructor() {
    // 智能选中状态管理
    this.isListening = false; // 是否正在监听单击事件
    this.lastSelection = null; // 最后一次选中的文本信息
    this.isReady = false; // 标记是否可以响应单击（延迟激活）
    this.clickTimeout = null; // 延迟激活的定时器
    this.clickDelay = 200; // 双击后必须等待的时间间隔（毫秒）
    
    // 气泡管理
    this.bubbles = new Map(); // 存储翻译气泡，key为唯一ID
    this.vocabularyBubbles = new Map(); // 存储生词本气泡
    this.bubbleCounter = 0; // 用于生成唯一气泡ID
    
    // 设置
    this.settings = null;
    
    this.init();
  }

  /**
   * 初始化插件
   * 设置事件监听器、消息处理器，并开始扫描生词本
   */
  async init() {
    // 获取设置
    this.settings = await this.getSettings();
    
    // 设置事件监听器
    document.addEventListener('dblclick', this.handleDoubleClick.bind(this)); // 双击选中
    document.addEventListener('click', this.handleSingleClick.bind(this)); // 单击激活
    document.addEventListener('selectionchange', this.handleSelectionChange.bind(this)); // 选择变化
    
    // 监听来自popup和background的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'settingsUpdated') {
        this.refreshSettings();
      } else if (message.action === 'vocabularyUpdated') {
        this.scanPageForVocabulary(); // 重新扫描生词本
      } else if (message.action === 'showAlert') {
        // 处理来自DeepSeek的alert提醒
        alert(message.message);
      }
    });
    
    // 显示初始化成功通知
    if (window.notificationManager) {
      window.notificationManager.show({
        html: `
          <div style="font-weight: 600; margin-bottom: 2px;">再见单词</div>
          <div style="font-size: 12px; opacity: 0.9;">content.js 已成功注入</div>
        `
      });
    }
    
    // 初始化生词本扫描
    this.scanPageForVocabulary();
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['settings'], (result) => {
        const settings = result.settings || {};
        resolve(settings);
      });
    });
  }

  async refreshSettings() {
    this.settings = await this.getSettings();
  }

  /**
   * 处理双击事件 - 开始智能选中流程
   * @param {Event} event - 双击事件对象
   */
  handleDoubleClick(event) {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    // 检查选中文本是否有效（长度1-50字符）
    if (selectedText && selectedText.length > 0 && selectedText.length < 50) {
      // 重置之前的状态
      this.resetListeningState();
      
      // 设置新的监听状态
      this.isListening = true;
      this.isReady = false;
      this.lastSelection = {
        range: selection.getRangeAt(0).cloneRange(),
        text: selectedText,
        rect: selection.getRangeAt(0).getBoundingClientRect()
      };
      
      // 设置延迟激活 - 防止误触
      this.clickTimeout = setTimeout(() => {
        const currentSelection = window.getSelection();
        const currentText = currentSelection.toString().trim();
        
        if (currentText === this.lastSelection.text) {
          this.isReady = true; // 可以响应单击了
        } else {
          this.resetListeningState(); // 选择已改变，重置状态
        }
      }, this.clickDelay);
    }
  }

  handleSingleClick(event) {
    if (!this.isListening || !this.isReady || !this.lastSelection) {
      return;
    }

    // 检查当前选择是否还存在
    const currentSelection = window.getSelection();
    const currentText = currentSelection.toString().trim();
    
    if (currentText !== this.lastSelection.text) {
      this.resetListeningState();
      return;
    }
    
    // 检查点击位置是否在选中文本范围内
    const clickedElement = document.elementFromPoint(event.clientX, event.clientY);
    if (!clickedElement) {
      this.resetListeningState();
      return;
    }
    
    // 检查点击的元素是否包含选中的文本
    const containsSelectedText = this.elementContainsSelection(clickedElement, this.lastSelection);
    
    if (containsSelectedText) {
      // 清除超时
      if (this.clickTimeout) {
        clearTimeout(this.clickTimeout);
        this.clickTimeout = null;
      }
      
      this.showTranslationBubble();
      this.resetListeningState();
    } else {
      this.resetListeningState();
    }
  }

  elementContainsSelection(element, selection) {
    try {
      const range = selection.range;
      const container = range.commonAncestorContainer;
      
      // 检查元素是否包含选中文本的容器
      if (container.nodeType === Node.TEXT_NODE) {
        return element.contains(container.parentElement);
      } else {
        return element.contains(container);
      }
    } catch (error) {
      return false;
    }
  }

  handleSelectionChange() {
    if (!this.isListening) return;
    
    const selection = window.getSelection();
    const currentText = selection.toString().trim();
    
    if (currentText !== (this.lastSelection?.text || '')) {
      this.resetListeningState();
    }
  }

  /**
   * 重置智能选中监听状态
   */
  resetListeningState() {
    this.isListening = false;
    this.isReady = false;
    this.lastSelection = null;
    
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
    }
    
    // 清除音标显示
    this.removePhonetic();
  }

  showTranslationBubble() {
    if (!this.lastSelection) return;

    const selectedText = this.lastSelection.text.trim();
    
    // 检查是否已经有生词气泡在附近
    const existingBubble = this.findNearbyVocabularyBubble(this.lastSelection.range, selectedText);
    
    if (existingBubble) {
      this.highlightExistingBubble(existingBubble);
      return;
    }

    // 生成唯一ID
    const bubbleId = `bubble_${++this.bubbleCounter}_${Date.now()}`;
    
    // 创建气泡元素
    const bubbleElement = document.createElement('span');
    bubbleElement.className = 'smart-translation-bubble loading';
    bubbleElement.dataset.bubbleId = bubbleId;
    bubbleElement.innerHTML = '<span class="bubble-content"></span>';
    
    // 添加关闭按钮
    const closeButton = document.createElement('span');
    closeButton.className = 'bubble-close';
    closeButton.innerHTML = '×';
    closeButton.onclick = (e) => {
      e.stopPropagation();
      this.removeBubble(bubbleId);
    };
    bubbleElement.appendChild(closeButton);
    
    // 插入气泡到选中文本后
    this.insertBubbleAfterSelection(bubbleElement, this.lastSelection.range);
    
    // 存储气泡信息
    this.bubbles.set(bubbleId, {
      element: bubbleElement,
      selection: { ...this.lastSelection },
      range: this.lastSelection.range.cloneRange()
    });
    
    // 开始翻译
    this.translateText(bubbleId);
  }

  insertBubbleAfterSelection(bubbleElement, range) {
    try {
      const textNode = range.endContainer;
      
      if (textNode.nodeType === Node.TEXT_NODE) {
        // 在文本节点中插入
        const textContent = textNode.textContent;
        const endOffset = range.endOffset;
        
        // 分割文本
        const beforeText = textContent.substring(0, endOffset);
        const afterText = textContent.substring(endOffset);
        
        // 创建新的文本节点
        const beforeNode = document.createTextNode(beforeText);
        const afterNode = document.createTextNode(afterText);
        
        // 替换原文本节点并插入气泡
        const parent = textNode.parentNode;
        parent.insertBefore(beforeNode, textNode);
        parent.insertBefore(bubbleElement, beforeNode.nextSibling);
        parent.insertBefore(afterNode, bubbleElement.nextSibling);
        parent.removeChild(textNode);
      } else {
        // 在元素后插入
        const parent = range.commonAncestorContainer;
        if (parent.nodeType === Node.ELEMENT_NODE) {
          parent.appendChild(bubbleElement);
        } else {
          document.body.appendChild(bubbleElement);
        }
      }
    } catch (error) {
      // 备用方案
      document.body.appendChild(bubbleElement);
    }
  }

  findNearbyVocabularyBubble(range, selectedText) {
    try {
      const container = range.commonAncestorContainer;
      const parent = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      
      if (!parent) return null;
      
      // 在父元素中查找生词气泡
      const vocabularyBubbles = parent.querySelectorAll('.vocabulary-bubble');
      
      for (const bubble of vocabularyBubbles) {
        const prevNode = bubble.previousSibling;
        if (prevNode && prevNode.nodeType === Node.TEXT_NODE) {
          const text = prevNode.textContent.trim();
          if (text.toLowerCase().includes(selectedText.toLowerCase())) {
            return bubble;
          }
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  highlightExistingBubble(bubbleElement) {
    bubbleElement.style.animation = 'bubbleHighlight 0.6s ease-in-out';
    
    if (window.notificationManager) {
      window.notificationManager.show({
        html: `
          <div style="font-weight: 600; margin-bottom: 2px;">生词已存在</div>
          <div style="font-size: 12px; opacity: 0.9;">该单词已在生词本中</div>
        `
      });
    }
    
    setTimeout(() => {
      bubbleElement.style.animation = '';
    }, 600);
  }

  removeBubble(bubbleId = null) {
    if (bubbleId) {
      const bubbleInfo = this.bubbles.get(bubbleId);
      if (bubbleInfo && bubbleInfo.element) {
        bubbleInfo.element.remove();
        this.bubbles.delete(bubbleId);
      }
    } else {
      // 移除所有气泡
      this.bubbles.forEach((bubbleInfo) => {
        if (bubbleInfo.element) {
          bubbleInfo.element.remove();
        }
      });
      this.bubbles.clear();
    }
  }

  removeAllTranslationBubbles() {
    this.bubbles.forEach((bubbleInfo, bubbleId) => {
      if (bubbleInfo.element && !bubbleInfo.element.classList.contains('vocabulary-bubble')) {
        bubbleInfo.element.remove();
        this.bubbles.delete(bubbleId);
      }
    });
  }

  /**
   * 翻译选中的文本
   * @param {string} bubbleId - 气泡ID
   */
  async translateText(bubbleId) {
    const bubbleInfo = this.bubbles.get(bubbleId);
    if (!bubbleInfo) return;

    const selectedText = bubbleInfo.selection.text;
    
    try {
      const context = this.getContext(bubbleInfo.selection);
      const result = await this.sendTranslationRequest(selectedText, context);
      
      // 显示翻译结果
      this.updateBubbleContent(bubbleId, result.translation, 'success');
      
      // 显示音标（如果有的话）
      if (result.phonetic) {
        this.showPhonetic(bubbleInfo.selection, result.phonetic);
      }
      
      // 保存到生词本
      await this.saveTranslation({
        word: result.word || selectedText,
        translation: result.translation,
        phonetic: result.phonetic || '',
        context: context,
        explanation: result.explanation || '',
        timestamp: Date.now()
      });
      
    } catch (error) {
      this.updateBubbleContent(bubbleId, this.getErrorMessage(error), 'error');
    }
  }

  getContext(selection = null) {
    if (!selection) return '';
    
    try {
      const range = selection.range;
      const container = range.commonAncestorContainer;
      
      let contextElement;
      if (container.nodeType === Node.TEXT_NODE) {
        contextElement = container.parentElement;
      } else {
        contextElement = container;
      }
      
      // 获取包含选中文本的段落或容器
      let contextContainer = contextElement;
      while (contextContainer && !['P', 'DIV', 'ARTICLE', 'SECTION'].includes(contextContainer.tagName)) {
        contextContainer = contextContainer.parentElement;
      }
      
      if (contextContainer) {
        return contextContainer.textContent.trim().substring(0, 200);
      }
      
      return contextElement.textContent.trim().substring(0, 200);
    } catch (error) {
      return '';
    }
  }

  /**
   * 发送翻译请求到background script
   * @param {string} text - 要翻译的文本
   * @param {string} context - 上下文
   * @returns {Promise<Object>} 返回包含翻译数据的对象
   */
  async sendTranslationRequest(text, context) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'translate',
        text: text,
        context: context
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response.data); // 返回完整的data对象
        } else {
          reject(new Error(response?.error || '翻译失败'));
        }
      });
    });
  }

  /**
   * 更新气泡内容
   * @param {string} bubbleId - 气泡ID
   * @param {string} content - 显示内容
   * @param {string} type - 气泡类型
   * @param {string} errorType - 错误类型
   */
  updateBubbleContent(bubbleId, content, type = 'success', errorType = null) {
    const bubbleInfo = this.bubbles.get(bubbleId);
    if (!bubbleInfo || !bubbleInfo.element) return;

    const bubbleElement = bubbleInfo.element;
    const contentElement = bubbleElement.querySelector('.bubble-content');
    
    if (!contentElement) return;

    // 移除加载状态
    bubbleElement.classList.remove('loading');
    
    // 设置内容
    contentElement.textContent = content;
    
    // 设置状态样式
    bubbleElement.className = `smart-translation-bubble ${type}`;
    if (errorType) {
      bubbleElement.classList.add(errorType);
    }
    
    // 添加tooltip - 显示解释信息
    bubbleElement.title = content;
  }

  /**
   * 在选中文本上方显示音标
   * @param {Object} selection - 选择信息对象
   * @param {string} phonetic - 音标文本
   */
  showPhonetic(selection, phonetic) {
    if (!selection || !selection.range || !phonetic) return;

    try {
      // 移除之前的音标
      this.removePhonetic();

      const range = selection.range;
      const rect = range.getBoundingClientRect();
      
      // 创建音标元素
      const phoneticElement = document.createElement('div');
      phoneticElement.className = 'smart-phonetic-display';
      phoneticElement.textContent = phonetic;
      phoneticElement.id = 'smart-phonetic-current';
      
      // 设置位置样式
      phoneticElement.style.cssText = `
        position: fixed;
        top: ${rect.top + window.scrollY - 25}px;
        left: ${rect.left + window.scrollX + (rect.width / 2)}px;
        transform: translateX(-50%);
        z-index: 10001;
        pointer-events: none;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        color: rgba(103, 80, 164, 0.7);
        background: rgba(255, 255, 255, 0.9);
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: normal;
        font-style: italic;
        backdrop-filter: blur(2px);
        box-shadow: 0 1px 3px rgba(103, 80, 164, 0.1);
        animation: phoneticFadeIn 0.3s ease-out;
      `;

      document.body.appendChild(phoneticElement);

      // 3秒后自动移除
      setTimeout(() => {
        this.removePhonetic();
      }, 3000);

    } catch (error) {
      console.error('显示音标失败:', error);
    }
  }

  /**
   * 移除当前显示的音标
   */
  removePhonetic() {
    const existingPhonetic = document.getElementById('smart-phonetic-current');
    if (existingPhonetic) {
      existingPhonetic.style.animation = 'phoneticFadeOut 0.2s ease-in';
      setTimeout(() => {
        if (existingPhonetic.parentNode) {
          existingPhonetic.parentNode.removeChild(existingPhonetic);
        }
      }, 200);
    }
  }

  /**
   * 保存翻译结果到生词本
   * @param {Object} data - 翻译数据对象
   */
  async saveTranslation(data) {
    try {
      const vocabulary = await this.getVocabulary();
      
      // 检查是否存在相同的单词（不区分大小写）
      const existingIndex = vocabulary.findIndex(item => 
        item.word.toLowerCase() === data.word.toLowerCase()
      );
      
      if (existingIndex !== -1) {
        // 如果存在，更新现有条目，保留原有数据
        const existing = vocabulary[existingIndex];
        vocabulary[existingIndex] = {
          ...existing,
          translation: data.translation,
          phonetic: data.phonetic || existing.phonetic,
          explanation: data.explanation || existing.explanation,
          context: data.context || existing.context,
          timestamp: data.timestamp // 更新时间戳
        };
      } else {
        // 如果不存在，添加到开头
        vocabulary.unshift(data);
      }
      
      // 保存到存储
      await new Promise((resolve) => {
        chrome.storage.local.set({ vocabulary: vocabulary }, resolve);
      });
      
      // 移除翻译气泡
      this.removeAllTranslationBubbles();
      
      // 如果是新单词，重新扫描页面
      if (existingIndex === -1) {
        setTimeout(() => this.scanPageForVocabulary(), 200);
      }
      
    } catch (error) {
      console.error('保存翻译失败:', error);
    }
  }

  getErrorMessage(error) {
    if (error.message.includes('API key')) {
      return '请配置API密钥';
    } else if (error.message.includes('network')) {
      return '网络连接失败';
    } else if (error.message.includes('server')) {
      return '服务器错误';
    } else {
      return '翻译失败';
    }
  }

  /**
   * 扫描页面中的生词本单词并添加气泡
   * 这是生词本功能的核心方法
   */
  async scanPageForVocabulary() {
    try {
      // 清除现有的生词本气泡
      this.clearVocabularyBubbles();
      
      // 获取生词本数据
      const vocabulary = await this.getVocabulary();
      if (vocabulary.length === 0) return;
      
      // 为每个单词创建正则表达式模式
      const wordPatterns = vocabulary.map(item => ({
        word: item.word,
        pattern: new RegExp(`\\b${this.escapeRegExp(item.word)}\\b`, 'gi'),
        data: item
      }));
      
      // 扫描页面文本节点
      this.scanTextNodes(document.body, wordPatterns);
      
    } catch (error) {
      console.error('扫描生词失败:', error);
    }
  }

  clearVocabularyBubbles() {
    document.querySelectorAll('.vocabulary-bubble').forEach(bubble => {
      bubble.remove();
    });
    this.vocabularyBubbles.clear();
  }

  scanTextNodes(element, wordPatterns) {
    try {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            return this.shouldProcessTextNode(node) ? 
              NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        }
      );
      
      const textNodes = [];
      let node;
      while (node = walker.nextNode()) {
        textNodes.push(node);
      }
      
      textNodes.forEach(textNode => {
        this.processTextNode(textNode, wordPatterns);
      });
      
    } catch (error) {
      console.error('扫描文本节点失败:', error);
    }
  }

  shouldProcessTextNode(textNode) {
    try {
      const parent = textNode.parentElement;
      if (!parent) return false;
      
      const tagName = parent.tagName.toLowerCase();
      const className = this.getClassName(parent);
      
      // 排除的标签
      const excludedTags = ['script', 'style', 'noscript', 'iframe', 'textarea', 'input', 'select'];
      if (excludedTags.includes(tagName)) return false;
      
      // 排除UI元素
      const uiKeywords = ['button', 'nav', 'menu', 'header', 'footer', 'toolbar'];
      if (uiKeywords.some(keyword => className.includes(keyword))) return false;
      
      // 检查内容长度
      const text = textNode.textContent.trim();
      if (text.length < 3 || text.length > 500) return false;
      
      // 检查是否已有气泡
      if (parent.querySelector('.vocabulary-bubble, .smart-translation-bubble')) return false;
      
      // 检查元素是否隐藏
      const style = window.getComputedStyle(parent);
      return style.display !== 'none' && style.visibility !== 'hidden';
      
    } catch (error) {
      return false;
    }
  }

  getClassName(element) {
    if (typeof element.className === 'string') {
      return element.className;
    } else if (element.className?.baseVal) {
      return element.className.baseVal;
    }
    return element.getAttribute('class') || '';
  }

  processTextNode(textNode, wordPatterns) {
    try {
      const text = textNode.textContent;
      const matches = [];
      
      wordPatterns.forEach(({ pattern, word, data }) => {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          matches.push({
            word: word,
            data: data,
            start: match.index,
            end: match.index + match[0].length,
            text: match[0]
          });
        }
      });
      
      if (matches.length > 0) {
        matches.sort((a, b) => b.start - a.start);
        this.processAllMatches(textNode, matches);
      }
    } catch (error) {
      console.error('处理文本节点失败:', error);
    }
  }

  processAllMatches(textNode, matches) {
    try {
      const text = textNode.textContent;
      const parent = textNode.parentNode;
      const fragment = document.createDocumentFragment();
      let lastIndex = text.length;
      
      matches.forEach(match => {
        const afterText = text.substring(match.end, lastIndex);
        if (afterText) {
          fragment.insertBefore(document.createTextNode(afterText), fragment.firstChild);
        }
        
        const bubbleElement = this.createVocabularyBubbleElement(match);
        fragment.insertBefore(bubbleElement, fragment.firstChild);
        
        const beforeText = text.substring(match.start, match.end);
        fragment.insertBefore(document.createTextNode(beforeText), fragment.firstChild);
        
        lastIndex = match.start;
      });
      
      if (lastIndex > 0) {
        fragment.insertBefore(document.createTextNode(text.substring(0, lastIndex)), fragment.firstChild);
      }
      
      parent.replaceChild(fragment, textNode);
      
    } catch (error) {
      console.error('处理所有匹配失败:', error);
    }
  }

  /**
   * 创建生词本气泡元素
   * @param {Object} match - 匹配的单词信息
   * @returns {HTMLElement} 气泡元素
   */
  createVocabularyBubbleElement(match) {
    const bubbleElement = document.createElement('span');
    bubbleElement.className = 'smart-translation-bubble vocabulary-bubble';
    bubbleElement.textContent = match.data.translation;
    
    // 设置tooltip显示解释信息
    const explanation = match.data.explanation || '';
    bubbleElement.title = explanation ? `${match.text} - ${match.data.translation}\n\n解释：${explanation}` : `${match.text} - ${match.data.translation}`;
    
    // 添加右键菜单
    bubbleElement.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showVocabularyContextMenu(event, match);
    });
    
    return bubbleElement;
  }

  showVocabularyContextMenu(event, match) {
    // 创建自定义右键菜单
    const menu = document.createElement('div');
    menu.style.cssText = `
      position: fixed;
      top: ${event.clientY}px;
      left: ${event.clientX}px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      padding: 8px 0;
      min-width: 120px;
    `;
    
    menu.innerHTML = `
      <div style="padding: 8px 16px; cursor: pointer; hover: background: #f5f5f5;" onclick="this.parentElement.remove()">
        Hello World
      </div>
    `;
    
    document.body.appendChild(menu);
    
    // 点击其他地方关闭菜单
    const closeMenu = () => {
      if (menu.parentNode) {
        menu.parentNode.removeChild(menu);
      }
      document.removeEventListener('click', closeMenu);
    };
    
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 100);
  }

  async getVocabulary() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['vocabulary'], (result) => {
        resolve(result.vocabulary || []);
      });
    });
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// 初始化插件
new SmartSelectionTranslator(); 
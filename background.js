// 后台脚本 - 处理DeepSeek API请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request, sendResponse);
    return true; // 保持消息通道开放
  }
});

/**
 * 处理翻译请求的主函数
 * @param {Object} request - 包含text和context的请求对象
 * @param {Function} sendResponse - 响应回调函数
 */
async function handleTranslation(request, sendResponse) {
  try {
    const { text, context } = request;

    // 获取API密钥
    const result = await new Promise((resolve) => {
      chrome.storage.sync.get(['deepseek_api_key'], resolve);
    });

    const apiKey = result.deepseek_api_key;
    if (!apiKey) {
      sendResponse({ success: false, error: 'API密钥未设置' });
      return;
    }

    // 构建提示词 - 要求返回JSON格式
    const prompt = `你是一个浏览器翻译插件。请翻译以下单词并提供详细信息。

单词: ${text}
上下文: ${context}

请严格按照以下JSON格式返回，不要包含任何其他内容：

{
  "word": "原单词",
  "translation": "词性.翻译",
  "phonetic": "音标",
  "explanation": "详细解释",
  "function_calls": []
}

在以下情况下，请在function_calls中添加alert函数进行特别提醒：

1. 包含冒犯意思的单词（如种族、性别、身体缺陷相关的贬义词）
2. 极其少见、不具有迁移意义的翻译（如古英语、方言、专业术语）
3. 容易被误用或有文化敏感性的词汇

示例1 - 冒犯性词汇：
{
  "word": "retarded",
  "translation": "adj.迟钝的",
  "phonetic": "/rɪˈtɑːdɪd/",
  "explanation": "原意为迟缓、延迟，但现在被认为是对智力障碍者的冒犯性用词。",
  "function_calls": [
    {
      "name": "alert",
      "arguments": {
        "message": "⚠️ 敏感词汇提醒：此词曾用于描述智力障碍，现被认为极不尊重，建议使用 'person with intellectual disability'"
      }
    }
  ]
}

示例2 - 极少见翻译：
{
  "word": "defenestration",
  "translation": "n.从窗户扔出去",
  "phonetic": "/ˌdiːfɛnɪˈstreɪʃən/",
  "explanation": "一个极其特殊的词汇，专指从窗户扔东西或人的行为，源于历史事件。",
  "function_calls": [
    {
      "name": "alert",
      "arguments": {
        "message": "📚 罕见词汇：这是一个极其少见的专门术语，日常使用价值很低，主要出现在历史语境中"
      }
    }
  ]
}`;

    // 输出API调用信息
    console.log('🚀 发送翻译请求到DeepSeek API:', {
      text,
      context,
      timestamp: new Date().toISOString()
    });

    // 发送请求到DeepSeek API
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorMessage = response.status === 401 ? 'API密钥无效' :
                          response.status === 429 ? '请求频率超限' :
                          `API请求失败 (${response.status})`;
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    // 输出完整回复
    console.log('📥 DeepSeek API 完整回复:', content);

    if (!content) {
      sendResponse({ success: false, error: 'API响应格式错误' });
      return;
    }

    // 尝试解析JSON响应
    let parsedResponse;
    try {
      // 清理可能的markdown代码块标记
      const cleanContent = content.replace(/```json\s*|\s*```/g, '').trim();
      parsedResponse = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('JSON解析失败:', parseError);
      // 如果JSON解析失败，尝试从文本中提取信息
      const fallbackResponse = parseFallbackResponse(content, text);
      parsedResponse = fallbackResponse;
    }

    // 处理function calls
    if (parsedResponse.function_calls && parsedResponse.function_calls.length > 0) {
      for (const funcCall of parsedResponse.function_calls) {
        if (funcCall.name === 'alert' && funcCall.arguments?.message) {
          // 在background script中无法直接alert，发送消息到content script
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'showAlert',
                message: funcCall.arguments.message
              }).catch(() => {
                // 忽略错误
              });
            }
          });
        }
      }
    }

    // 返回成功响应
    sendResponse({ 
      success: true, 
      data: parsedResponse
    });

  } catch (error) {
    console.error('翻译请求错误:', error);
    sendResponse({ 
      success: false, 
      error: error.message || '翻译失败' 
    });
  }
}

/**
 * 解析失败时的备用解析函数
 * @param {string} content - API返回的原始内容
 * @param {string} originalWord - 原始单词
 * @returns {Object} 解析后的响应对象
 */
function parseFallbackResponse(content, originalWord) {
  // 尝试从文本中提取信息
  const lines = content.split('\n');
  let translation = '';
  let explanation = '';
  let phonetic = '';

  for (const line of lines) {
    if (line.includes('.') && !translation) {
      translation = line.trim();
    } else if (line.includes('|') && !explanation) {
      const parts = line.split('|');
      if (parts[1]) {
        explanation = parts[1].trim();
      }
    } else if (line.includes('/') && !phonetic) {
      // 简单的音标检测
      const phoneticMatch = line.match(/\/[^\/]+\//);
      if (phoneticMatch) {
        phonetic = phoneticMatch[0];
      }
    }
  }

  return {
    word: originalWord,
    translation: translation || `${originalWord}的翻译`,
    phonetic: phonetic || '',
    explanation: explanation || '',
    function_calls: []
  };
}

// 监听安装事件，设置默认配置
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      deepseek_api_key: '',
      settings: {},
      vocabulary: []
    });
  }
}); 
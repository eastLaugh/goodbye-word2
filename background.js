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

如果遇到需要特别提醒用户的情况，请在function_calls中添加alert函数：
{
  "word": "retarded",
  "translation": "adj. 迟钝的",
  "phonetic": "/rɪˈtɑːdɪd/",
  "explanation": "retarded 是一个形容词，意思是迟钝的。",
  "function_calls": [
    {
      "name": "alert",
      "arguments": {
        "message": "曾用于 “智力迟缓者”，现被认为极不尊重，建议用 person with intellectual disability"
      }
    }
  ]
}`;

    console.group('🚀');
    // 输出API调用信息
    console.log(prompt);

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
    console.log('📥', content);
    console.groupEnd();

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
// Content script for AI provider pages
console.log('AI Uinify content script loaded on:', window.location.href);

// Detect which AI provider we're on
const provider = detectProvider();

if (provider) {
    console.log(`AI Uinify: Detected provider - ${provider}`);
    initializeProvider(provider);
}

function detectProvider() {
    const hostname = window.location.hostname;
    
    if (hostname.includes('openai.com') || hostname.includes('chat.openai.com')) {
        return 'chatgpt';
    } else if (hostname.includes('claude.ai')) {
        return 'claude';
    } else if (hostname.includes('perplexity.ai')) {
        return 'perplexity';
    } else if (hostname.includes('gemini.google.com')) {
        return 'gemini';
    }
    
    return null;
}

function initializeProvider(provider) {
    // Add visual indicator that extension is active
    addExtensionIndicator(provider);
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'SEND_PROMPT') {
            handlePromptInjection(message.payload, provider)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        }
    });
}

function addExtensionIndicator(provider) {
    const indicator = document.createElement('div');
    indicator.id = 'ai-uinify-indicator';
    indicator.textContent = '🤖 AI Uinify Active';
    indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(74, 158, 255, 0.9);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        z-index: 999999;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    `;
    
    document.body.appendChild(indicator);
    
    // Fade out after 3 seconds
    setTimeout(() => {
        indicator.style.transition = 'opacity 0.5s';
        indicator.style.opacity = '0';
        setTimeout(() => indicator.remove(), 500);
    }, 3000);
}

async function handlePromptInjection(payload, provider) {
    const { prompt } = payload;
    
    console.log(`Injecting prompt into ${provider}:`, prompt);
    
    // Provider-specific prompt injection logic
    // This is a placeholder - actual implementation would need to
    // interact with each provider's specific DOM structure
    
    switch (provider) {
        case 'chatgpt':
            return injectChatGPTPrompt(prompt);
        case 'claude':
            return injectClaudePrompt(prompt);
        case 'perplexity':
            return injectPerplexityPrompt(prompt);
        case 'gemini':
            return injectGeminiPrompt(prompt);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

// Placeholder injection functions
// These would need to be customized for each provider's actual UI

function injectChatGPTPrompt(prompt) {
    console.log('ChatGPT prompt injection:', prompt);
    // TODO: Find ChatGPT's textarea and inject prompt
    return { injected: true, provider: 'chatgpt' };
}

function injectClaudePrompt(prompt) {
    console.log('Claude prompt injection:', prompt);
    // TODO: Find Claude's textarea and inject prompt
    return { injected: true, provider: 'claude' };
}

function injectPerplexityPrompt(prompt) {
    console.log('Perplexity prompt injection:', prompt);
    // TODO: Find Perplexity's textarea and inject prompt
    return { injected: true, provider: 'perplexity' };
}

function injectGeminiPrompt(prompt) {
    console.log('Gemini prompt injection:', prompt);
    // TODO: Find Gemini's textarea and inject prompt
    return { injected: true, provider: 'gemini' };
}
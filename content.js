// Content script for AI provider pages
console.log('AI Uinify content script loaded on:', window.location.href);

const pageProvider = detectProvider();
if (pageProvider) {
    console.log(`AI Uinify: Detected provider - ${pageProvider}`);
    addExtensionIndicator();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'SEND_PROMPT') {
        return false;
    }

    const requestedProvider = message.payload?.provider;
    if (!pageProvider || pageProvider !== requestedProvider) {
        sendResponse({
            success: false,
            error: `Provider mismatch on page. Expected ${requestedProvider}, detected ${pageProvider || 'unknown'}.`
        });
        return false;
    }

    handlePromptInjection(message.payload, pageProvider)
        .then(result => sendResponse({ success: true, result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
});

function detectProvider() {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com') || hostname.includes('openai.com')) {
        return 'gpt';
    }
    if (hostname.includes('gemini.google.com')) {
        return 'gem';
    }
    if (hostname.includes('perplexity.ai')) {
        return 'perp';
    }
    return null;
}

function addExtensionIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'ai-uinify-indicator';
    indicator.textContent = 'AI Uinify active';
    indicator.style.cssText = `
        position: fixed;
        top: 12px;
        right: 12px;
        background: rgba(27, 124, 219, 0.9);
        color: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        z-index: 2147483647;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        font-family: Segoe UI, Arial, sans-serif;
        pointer-events: none;
    `;
    document.body.appendChild(indicator);
    setTimeout(() => indicator.remove(), 2200);
}

async function handlePromptInjection(payload, provider) {
    const prompt = String(payload?.prompt || '').trim();
    if (!prompt) {
        throw new Error('Prompt is empty');
    }

    const beforeSnapshot = getResponseSnapshot(provider);
    const input = await waitForInput(provider, 10000);
    setInputText(input, prompt);
    await delay(100);

    const sent = clickSendButton(provider);
    if (!sent) {
        const submitted = submitNearestForm(input);
        if (!submitted) {
            triggerEnter(input);
        }
    }

    const output = await waitForNewResponse(provider, beforeSnapshot, 90000);
    return { injected: true, provider, output };
}

function selectorsByProvider(provider) {
    if (provider === 'gpt') {
        return {
            inputs: ['#prompt-textarea', 'textarea[data-id]', 'textarea'],
            sendButtons: ['button[data-testid="send-button"]', 'form button[type="submit"]', 'button[aria-label*="Send"]'],
            responses: ['[data-message-author-role="assistant"]', 'article [data-message-author-role="assistant"]', '.markdown']
        };
    }
    if (provider === 'gem') {
        return {
            inputs: ['div[contenteditable="true"][role="textbox"]', 'textarea', 'div.ql-editor[contenteditable="true"]'],
            sendButtons: ['button[aria-label*="Send"]', 'button[mattooltip*="Send"]', 'form button[type="submit"]'],
            responses: ['message-content', '.model-response-text', '.response-content', '.markdown']
        };
    }
    return {
        inputs: ['textarea', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
        sendButtons: ['button[aria-label*="Submit"]', 'button[aria-label*="Send"]', 'form button[type="submit"]'],
        responses: ['[data-testid="answer"]', '.prose', '.markdown', 'article']
    };
}

function waitForInput(provider, timeoutMs) {
    const selectors = selectorsByProvider(provider).inputs;
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && isElementVisible(element)) {
                    resolve(element);
                    return;
                }
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error('Prompt input not found on provider page'));
                return;
            }
            setTimeout(tick, 250);
        };
        tick();
    });
}

function isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function setInputText(element, text) {
    element.focus();
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }

    if (element.isContentEditable) {
        element.textContent = text;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        return;
    }

    throw new Error('Unsupported input element type');
}

function clickSendButton(provider) {
    const selectors = selectorsByProvider(provider).sendButtons;
    for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button && !button.disabled) {
            button.click();
            return true;
        }
    }
    return false;
}

function submitNearestForm(input) {
    const form = input.closest('form');
    if (!form) {
        return false;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton && !submitButton.disabled) {
        submitButton.click();
        return true;
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
}

function triggerEnter(input) {
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
}

function getResponseSnapshot(provider) {
    const selectors = selectorsByProvider(provider).responses;
    const texts = [];
    for (const selector of selectors) {
        document.querySelectorAll(selector).forEach(node => {
            const text = normalizeText(node.textContent || '');
            if (text.length >= 20) {
                texts.push(text);
            }
        });
    }
    return new Set(texts.slice(-8));
}

function waitForNewResponse(provider, beforeSnapshot, timeoutMs) {
    const started = Date.now();
    let lastCandidate = '';
    let stableCount = 0;
    return new Promise((resolve, reject) => {
        const tick = () => {
            const candidate = findLatestResponseCandidate(provider);
            const hasNew = candidate && !beforeSnapshot.has(candidate);
            if (hasNew) {
                if (candidate === lastCandidate) {
                    stableCount += 1;
                } else {
                    lastCandidate = candidate;
                    stableCount = 1;
                }

                if (stableCount >= 3) {
                    resolve(candidate);
                    return;
                }
            }

            if (Date.now() - started > timeoutMs) {
                if (lastCandidate) {
                    resolve(lastCandidate);
                    return;
                }
                reject(new Error('No provider response detected before timeout'));
                return;
            }
            setTimeout(tick, 1000);
        };
        tick();
    });
}

function findLatestResponseCandidate(provider) {
    const selectors = selectorsByProvider(provider).responses;
    const candidates = [];
    for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes.slice(-6)) {
            const text = normalizeText(node.textContent || '');
            if (text.length >= 20 && !/thinking|searching|drafting/i.test(text)) {
                candidates.push(text);
            }
        }
    }
    return candidates.at(-1) || '';
}

function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Content script for AI provider pages
console.log('AI Uinify content script loaded on:', window.location.href);

const pageProvider = detectProvider();
if (pageProvider) {
    console.log(`AI Uinify: Detected provider - ${pageProvider}`);
    addExtensionIndicator();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AI_UINIFY_PING') {
        sendResponse({ ok: true, provider: pageProvider || 'unknown' });
        return false;
    }

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
    const input = await waitForInput(provider, 15000);
    setInputText(input, prompt);
    await delay(120);

    const sent = clickSendButton(provider);
    if (!sent) {
        const submitted = submitNearestForm(input);
        if (!submitted) {
            triggerEnter(input);
        }
    }

    const response = await waitForNewResponse(provider, beforeSnapshot, 120000);
    return {
        injected: true,
        provider,
        output: response.text,
        outputHtml: response.html
    };
}

function selectorsByProvider(provider) {
    if (provider === 'gpt') {
        return {
            inputs: ['#prompt-textarea', 'textarea[data-id]', 'textarea'],
            sendButtons: ['button[data-testid="send-button"]', 'form button[type="submit"]', 'button[aria-label*="Send"]'],
            responses: ['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]', '.markdown']
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
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    if (element.isContentEditable) {
        element.textContent = '';
        document.execCommand('insertText', false, text);
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
    const candidates = collectResponseCandidates(provider);
    return new Set(candidates.map(item => item.signature).slice(-12));
}

function waitForNewResponse(provider, beforeSnapshot, timeoutMs) {
    const started = Date.now();
    let lastCandidate = null;
    let stableCount = 0;

    return new Promise((resolve, reject) => {
        const tick = () => {
            const candidate = findLatestResponseCandidate(provider, beforeSnapshot);
            if (candidate) {
                if (lastCandidate && lastCandidate.signature === candidate.signature) {
                    stableCount += 1;
                } else {
                    lastCandidate = candidate;
                    stableCount = 1;
                }

                if (stableCount >= 2) {
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

function findLatestResponseCandidate(provider, beforeSnapshot) {
    const candidates = collectResponseCandidates(provider);
    const fresh = candidates.filter(item => !beforeSnapshot.has(item.signature));
    return fresh.at(-1) || null;
}

function collectResponseCandidates(provider) {
    const selectors = selectorsByProvider(provider).responses;
    const results = [];

    for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes.slice(-8)) {
            const text = normalizeText(node.textContent || '');
            if (text.length < 20 || /thinking|searching|drafting/i.test(text)) {
                continue;
            }

            const html = normalizeHtml(node.innerHTML || '');
            const signature = `${text.slice(0, 260)}::${text.length}`;
            results.push({ text, html, signature });
        }
    }

    return dedupeBySignature(results);
}

function dedupeBySignature(items) {
    const map = new Map();
    for (const item of items) {
        map.set(item.signature, item);
    }
    return Array.from(map.values());
}

function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeHtml(value) {
    return String(value || '').trim();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

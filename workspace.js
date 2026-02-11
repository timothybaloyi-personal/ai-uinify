const providerLabels = {
    gpt: 'ChatGPT',
    gem: 'Gemini',
    perp: 'Perplexity'
};

const promptInput = document.getElementById('promptInput');
const dispatchBtn = document.getElementById('dispatchBtn');
const globalStatus = document.getElementById('globalStatus');
const activityList = document.getElementById('activityList');

const paneStatus = {
    gpt: document.getElementById('status-gpt'),
    gem: document.getElementById('status-gem'),
    perp: document.getElementById('status-perp')
};

const paneOutput = {
    gpt: document.getElementById('output-gpt'),
    gem: document.getElementById('output-gem'),
    perp: document.getElementById('output-perp')
};

document.querySelectorAll('.provider-link').forEach(button => {
    button.addEventListener('click', () => openProviderTab(button.dataset.provider));
});

dispatchBtn.addEventListener('click', dispatchPrompt);
promptInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        dispatchPrompt();
    }
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ACTIVITY_EVENT') {
        applyActivityEvent(message.event);
    }
});

function setGlobalStatus(text, type = 'info') {
    globalStatus.textContent = text;
    globalStatus.style.color = type === 'error' ? '#c0392b' : type === 'success' ? '#1f7a3d' : '#334';
}

function setPaneStatus(provider, text, className = '') {
    const element = paneStatus[provider];
    if (!element) {
        return;
    }
    element.textContent = text;
    element.className = `pane-status${className ? ` ${className}` : ''}`;
}

function appendPaneResponse(provider, payload) {
    const element = paneOutput[provider];
    if (!element) {
        return;
    }

    if (element.classList.contains('empty')) {
        element.classList.remove('empty');
        element.textContent = '';
    }

    const card = document.createElement('article');
    card.className = 'response-card';

    const head = document.createElement('div');
    head.className = 'response-head';
    head.textContent = `Assistant • ${new Date().toLocaleTimeString()}`;

    const body = document.createElement('div');
    body.className = 'response-body';

    const html = payload?.output_html ? sanitizeHtml(payload.output_html) : '';
    if (html) {
        body.innerHTML = html;
    } else {
        const pre = document.createElement('pre');
        pre.textContent = payload?.output || 'No response captured.';
        body.appendChild(pre);
    }

    card.append(head, body);
    element.appendChild(card);
    element.scrollTop = element.scrollHeight;
}

function appendUserPrompt(provider, prompt) {
    const element = paneOutput[provider];
    if (!element || !prompt) {
        return;
    }

    if (element.classList.contains('empty')) {
        element.classList.remove('empty');
        element.textContent = '';
    }

    const card = document.createElement('article');
    card.className = 'response-card user';

    const head = document.createElement('div');
    head.className = 'response-head';
    head.textContent = `You • ${new Date().toLocaleTimeString()}`;

    const body = document.createElement('div');
    body.className = 'response-body';

    const pre = document.createElement('pre');
    pre.textContent = prompt;
    body.appendChild(pre);

    card.append(head, body);
    element.appendChild(card);
    element.scrollTop = element.scrollHeight;
}

function sanitizeHtml(unsafeHtml) {
    const template = document.createElement('template');
    template.innerHTML = unsafeHtml;

    const blockedTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'noscript'];
    blockedTags.forEach(tag => {
        template.content.querySelectorAll(tag).forEach(node => node.remove());
    });

    template.content.querySelectorAll('*').forEach(node => {
        for (const attribute of Array.from(node.attributes)) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value || '';
            if (name.startsWith('on')) {
                node.removeAttribute(attribute.name);
                continue;
            }
            if ((name === 'src' || name === 'href') && /^javascript:/i.test(value.trim())) {
                node.removeAttribute(attribute.name);
                continue;
            }
            if (name === 'target') {
                node.setAttribute('target', '_blank');
                node.setAttribute('rel', 'noopener noreferrer');
            }
        }
    });

    return template.innerHTML;
}

async function dispatchPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) {
        setGlobalStatus('Enter a prompt first.', 'error');
        return;
    }
    if (!/@(gpt|gem|perp|pplx|chatgpt|gemini|perplexity)/i.test(prompt)) {
        setGlobalStatus('Use at least one mention: @gpt, @gem, @perp, or @pplx.', 'error');
        return;
    }

    const outgoingPrompt = prompt;
    promptInput.value = '';
    dispatchBtn.disabled = true;
    setDispatchWaiting(true);
    setGlobalStatus('Dispatching...', 'info');
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'DISPATCH_PROMPT',
            payload: { prompt: outgoingPrompt }
        });
        if (response.success) {
            const anySuccess = response.result.responses.some(item => item.status === 'completed');
            setGlobalStatus(anySuccess ? 'Dispatch finished.' : 'Dispatch finished with errors.', anySuccess ? 'success' : 'error');
            response.result.responses.forEach(item => {
                const provider = item.provider_key;
                if (item.status === 'completed') {
                    setPaneStatus(provider, 'Completed', 'complete');
                } else {
                    setPaneStatus(provider, item.error || 'Failed', 'error');
                }
            });
        } else {
            setGlobalStatus(response.error || 'Dispatch failed.', 'error');
        }
    } catch (error) {
        setGlobalStatus(error.message || 'Dispatch failed.', 'error');
    } finally {
        setDispatchWaiting(false);
        dispatchBtn.disabled = false;
    }
}

function applyActivityEvent(event) {
    const provider = event.provider_key;
    if (provider) {
        if (event.type === 'dispatch.created') {
            setPaneStatus(provider, 'Queued', 'active');
            appendUserPrompt(provider, event.payload?.prompt || '');
        }
        if (event.type === 'dispatch.started') {
            setPaneStatus(provider, 'Sending to open tab...', 'active');
        }
        if (event.type === 'dispatch.completed') {
            setPaneStatus(provider, 'Completed', 'complete');
            appendPaneResponse(provider, {
                output: event.payload?.output || '',
                output_html: event.payload?.output_html || ''
            });
        }
        if (event.type === 'dispatch.failed') {
            setPaneStatus(provider, event.payload?.error || 'Failed', 'error');
        }
    }
    prependActivity(event);
}

function prependActivity(event) {
    const item = document.createElement('div');
    item.className = `activity-item ${event.type.includes('completed') ? 'completed' : event.type.includes('failed') ? 'failed' : ''}`;
    const label = providerLabels[event.provider_key] || event.provider_alias || 'Unknown';
    let summary = '';
    if (event.type === 'dispatch.created') {
        summary = `${label}: queued`;
    } else if (event.type === 'dispatch.started') {
        summary = `${label}: started`;
    } else if (event.type === 'dispatch.completed') {
        summary = `${label}: completed`;
    } else {
        summary = `${label}: ${event.payload?.error || 'failed'}`;
    }

    item.innerHTML = `<div>${summary}</div><div class="activity-time">${new Date(event.timestamp).toLocaleTimeString()}</div>`;
    activityList.prepend(item);
    while (activityList.children.length > 50) {
        activityList.removeChild(activityList.lastChild);
    }
}

function setDispatchWaiting(waiting) {
    const icon = dispatchBtn.querySelector('.send-icon');
    if (!icon) {
        return;
    }
    if (waiting) {
        dispatchBtn.classList.add('waiting');
        icon.textContent = '■';
    } else {
        dispatchBtn.classList.remove('waiting');
        icon.textContent = '↑';
    }
}

function openProviderTab(provider) {
    const urlByProvider = {
        gpt: 'https://chatgpt.com/',
        gem: 'https://gemini.google.com/',
        perp: 'https://www.perplexity.ai/'
    };
    const url = urlByProvider[provider];
    if (!url) {
        return;
    }
    chrome.tabs.create({ url });
}

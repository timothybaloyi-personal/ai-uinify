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
    if (event.key === 'Enter' && event.shiftKey) {
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

function setPaneOutput(provider, text) {
    const element = paneOutput[provider];
    if (!element) {
        return;
    }
    element.textContent = text || 'No response captured.';
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

    dispatchBtn.disabled = true;
    setGlobalStatus('Dispatching...', 'info');
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'DISPATCH_PROMPT',
            payload: { prompt }
        });
        if (response.success) {
            const anySuccess = response.result.responses.some(item => item.status === 'completed');
            setGlobalStatus(anySuccess ? 'Dispatch finished.' : 'Dispatch finished with errors.', anySuccess ? 'success' : 'error');
            response.result.responses.forEach(item => {
                const provider = item.provider_key;
                if (item.status === 'completed') {
                    setPaneStatus(provider, 'Completed', 'complete');
                    setPaneOutput(provider, item.output);
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
        dispatchBtn.disabled = false;
    }
}

function applyActivityEvent(event) {
    const provider = event.provider_key;
    if (provider) {
        if (event.type === 'dispatch.created') {
            setPaneStatus(provider, 'Queued', 'active');
        }
        if (event.type === 'dispatch.started') {
            setPaneStatus(provider, 'Sending to open tab...', 'active');
        }
        if (event.type === 'dispatch.completed') {
            setPaneStatus(provider, 'Completed', 'complete');
            setPaneOutput(provider, event.payload?.output || '');
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
    while (activityList.children.length > 30) {
        activityList.removeChild(activityList.lastChild);
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

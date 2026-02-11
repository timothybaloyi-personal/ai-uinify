// Background service worker
console.log('AI Uinify background service worker loaded');

const WORKSPACE_PATH = 'workspace.html';
const PROVIDERS = {
    gpt: {
        key: 'gpt',
        label: 'ChatGPT',
        aliases: ['gpt', 'chatgpt'],
        tabPatterns: ['*://chatgpt.com/*', '*://chat.openai.com/*']
    },
    gem: {
        key: 'gem',
        label: 'Gemini',
        aliases: ['gem', 'gemini'],
        tabPatterns: ['*://gemini.google.com/*']
    },
    perp: {
        key: 'perp',
        label: 'Perplexity',
        aliases: ['perp', 'perplexity', 'pplx'],
        tabPatterns: ['*://www.perplexity.ai/*', '*://perplexity.ai/*']
    }
};

const ALIAS_TO_PROVIDER = Object.values(PROVIDERS).reduce((acc, provider) => {
    for (const alias of provider.aliases) {
        acc[alias] = provider;
    }
    return acc;
}, {});

function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emitActivity(event) {
    chrome.runtime.sendMessage({
        type: 'ACTIVITY_EVENT',
        event
    }).catch(() => {});
}

function parseMentionPrompt(rawPrompt) {
    const prompt = String(rawPrompt || '').trim();
    const mentionRegex = /@([a-z0-9_]+)\s*/gi;
    const chunks = [];
    let match;
    let current = null;

    while ((match = mentionRegex.exec(prompt)) !== null) {
        const alias = match[1].toLowerCase();
        const provider = ALIAS_TO_PROVIDER[alias];
        if (!provider) {
            continue;
        }

        if (current) {
            current.prompt = prompt.slice(current.startIndex, match.index).trim();
            if (current.prompt) {
                chunks.push(current);
            }
        }

        current = {
            providerKey: provider.key,
            providerAlias: `@${provider.aliases[0]}`,
            startIndex: mentionRegex.lastIndex,
            prompt: ''
        };
    }

    if (current) {
        current.prompt = prompt.slice(current.startIndex).trim();
        if (current.prompt) {
            chunks.push(current);
        }
    }

    return chunks;
}

async function getOpenProviderTab(provider) {
    for (const pattern of provider.tabPatterns) {
        const tabs = await chrome.tabs.query({ url: pattern });
        const normalTabs = tabs.filter(tab => tab.id && !tab.discarded);
        if (normalTabs.length > 0) {
            normalTabs.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
            return normalTabs[0];
        }
    }
    return null;
}

async function dispatchToProvider(chunk, conversationId) {
    const provider = PROVIDERS[chunk.providerKey];
    const dispatchId = generateId();

    emitActivity({
        type: 'dispatch.created',
        provider_alias: chunk.providerAlias,
        provider_key: provider.key,
        conversation_id: conversationId,
        dispatch_id: dispatchId,
        timestamp: new Date().toISOString(),
        payload: { prompt: chunk.prompt }
    });

    const targetTab = await getOpenProviderTab(provider);
    if (!targetTab || !targetTab.id) {
        const message = `${provider.label} tab is not open`;
        emitActivity({
            type: 'dispatch.failed',
            provider_alias: chunk.providerAlias,
            provider_key: provider.key,
            conversation_id: conversationId,
            dispatch_id: dispatchId,
            timestamp: new Date().toISOString(),
            payload: { error: message }
        });
        return {
            provider_key: provider.key,
            provider_alias: chunk.providerAlias,
            status: 'failed',
            error: message
        };
    }

    const activeContext = await getActiveTabContext();
    await ensureTabReady(targetTab.id);

    emitActivity({
        type: 'dispatch.started',
        provider_alias: chunk.providerAlias,
        provider_key: provider.key,
        conversation_id: conversationId,
        dispatch_id: dispatchId,
        timestamp: new Date().toISOString(),
        payload: { tabId: targetTab.id, tabUrl: targetTab.url || '' }
    });

    try {
        const response = await sendPromptToProviderTab(targetTab.id, chunk.prompt, provider.key, {
            forceFocus: true
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Provider script did not return success');
        }

        emitActivity({
            type: 'dispatch.completed',
            provider_alias: chunk.providerAlias,
            provider_key: provider.key,
            conversation_id: conversationId,
            dispatch_id: dispatchId,
            timestamp: new Date().toISOString(),
            payload: {
                output: response.result?.output || '',
                output_html: response.result?.outputHtml || '',
                tabId: targetTab.id,
                tabUrl: targetTab.url || ''
            }
        });

        return {
            provider_key: provider.key,
            provider_alias: chunk.providerAlias,
            status: 'completed',
            output: response.result?.output || '',
            output_html: response.result?.outputHtml || ''
        };
    } catch (error) {
        const message = error?.message || 'Failed to communicate with provider tab';
        emitActivity({
            type: 'dispatch.failed',
            provider_alias: chunk.providerAlias,
            provider_key: provider.key,
            conversation_id: conversationId,
            dispatch_id: dispatchId,
            timestamp: new Date().toISOString(),
            payload: { error: message, tabId: targetTab.id }
        });
        return {
            provider_key: provider.key,
            provider_alias: chunk.providerAlias,
            status: 'failed',
            error: message
        };
    } finally {
        await restoreActiveTabContext(activeContext);
    }
}

async function sendPromptToProviderTab(tabId, prompt, providerKey, options = {}) {
    const payload = {
        type: 'SEND_PROMPT',
        payload: { prompt, provider: providerKey }
    };

    if (options.forceFocus) {
        await focusTab(tabId);
        await delay(180);
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await ensureContentScriptReady(tabId);
            return await sendMessageWithTimeout(tabId, payload, 130000);
        } catch (error) {
            if (attempt === 3) {
                throw error;
            }
            await delay(300 * attempt);
        }
    }
}

async function sendMessageWithTimeout(tabId, message, timeoutMs) {
    const messagePromise = chrome.tabs.sendMessage(tabId, message);
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for provider tab response')), timeoutMs);
    });
    return Promise.race([messagePromise, timeoutPromise]);
}

async function getActiveTabContext() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
        return null;
    }
    return {
        tabId: activeTab.id,
        windowId: activeTab.windowId
    };
}

async function focusTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
}

async function restoreActiveTabContext(context) {
    if (!context?.tabId) {
        return;
    }
    try {
        if (context.windowId) {
            await chrome.windows.update(context.windowId, { focused: true });
        }
        await chrome.tabs.update(context.tabId, { active: true });
    } catch (_) {
        // Original tab may have been closed; ignore restore failures.
    }
}

async function ensureTabReady(tabId) {
    try {
        await chrome.tabs.update(tabId, { autoDiscardable: false });
    } catch (_) {
        // Some Chrome versions may reject this property.
    }

    const tab = await chrome.tabs.get(tabId);
    if (tab.discarded) {
        await chrome.tabs.reload(tabId);
        await waitForTabComplete(tabId, 15000);
    }
}

async function ensureContentScriptReady(tabId) {
    try {
        const ping = await chrome.tabs.sendMessage(tabId, { type: 'AI_UINIFY_PING' });
        if (ping?.ok) {
            return;
        }
    } catch (_) {
        // Retry via script injection below.
    }

    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
    });

    try {
        await chrome.scripting.insertCSS({
            target: { tabId },
            files: ['content.css']
        });
    } catch (_) {
        // Content CSS is optional for dispatch behavior.
    }

    for (let i = 0; i < 5; i += 1) {
        try {
            const ping = await chrome.tabs.sendMessage(tabId, { type: 'AI_UINIFY_PING' });
            if (ping?.ok) {
                return;
            }
        } catch (_) {
            // Wait and retry.
        }
        await delay(200);
    }

    throw new Error('Content script did not initialize in target tab');
}

function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let finished = false;

        const cleanup = () => {
            finished = true;
            chrome.tabs.onUpdated.removeListener(onUpdated);
        };

        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId) {
                return;
            }
            if (changeInfo.status === 'complete') {
                cleanup();
                resolve();
            }
        };

        chrome.tabs.onUpdated.addListener(onUpdated);

        const checkTimeout = () => {
            if (finished) {
                return;
            }
            if (Date.now() - startedAt > timeoutMs) {
                cleanup();
                reject(new Error('Timed out waiting for provider tab to load'));
                return;
            }
            setTimeout(checkTimeout, 250);
        };
        checkTimeout();
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleDispatch(payload) {
    const prompt = payload?.prompt || '';
    const conversationId = generateId();
    const chunks = parseMentionPrompt(prompt);
    if (chunks.length === 0) {
        throw new Error('No valid mention segments found. Use @gpt, @gem, or @perp.');
    }

    const responses = [];
    for (const chunk of chunks) {
        const result = await dispatchToProvider(chunk, conversationId);
        responses.push(result);
    }

    return {
        conversation_id: conversationId,
        status: responses.some(item => item.status === 'completed') ? 'completed' : 'failed',
        responses
    };
}

async function openWorkspace() {
    const workspaceUrl = chrome.runtime.getURL(WORKSPACE_PATH);
    const existingTabs = await chrome.tabs.query({ url: workspaceUrl });
    if (existingTabs.length > 0 && existingTabs[0].id) {
        await chrome.tabs.update(existingTabs[0].id, { active: true });
        if (existingTabs[0].windowId) {
            await chrome.windows.update(existingTabs[0].windowId, { focused: true });
        }
        return;
    }
    await chrome.tabs.create({ url: workspaceUrl });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DISPATCH_PROMPT') {
        handleDispatch(message.payload)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'OPEN_WORKSPACE') {
        openWorkspace()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'PING_WORKSPACE') {
        sendResponse({ success: true, workspace: chrome.runtime.getURL(WORKSPACE_PATH) });
        return false;
    }

    return false;
});

chrome.action.onClicked.addListener(() => {
    openWorkspace().catch(error => {
        console.error('Failed to open workspace:', error);
    });
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('AI Uinify extension installed');
});

// Background service worker
console.log('AI Uinify background service worker loaded');

const WORKSPACE_PATH = 'workspace.html';
const AI_TAB_GROUP_STORAGE_KEY = 'ai_uinify_tab_group_id';
const AI_TAB_GROUP_TITLE = 'AI Uinify';
const AI_TAB_GROUP_COLOR = 'blue';
const PROVIDERS = {
    gpt: {
        key: 'gpt',
        label: 'ChatGPT',
        aliases: ['gpt', 'chatgpt'],
        tabPatterns: ['*://chatgpt.com/*', '*://chat.openai.com/*'],
        homeUrl: 'https://chatgpt.com/'
    },
    gem: {
        key: 'gem',
        label: 'Gemini',
        aliases: ['gem', 'gemini'],
        tabPatterns: ['*://gemini.google.com/*'],
        homeUrl: 'https://gemini.google.com/'
    },
    perp: {
        key: 'perp',
        label: 'Perplexity',
        aliases: ['perp', 'perplexity', 'pplx'],
        tabPatterns: ['*://www.perplexity.ai/*', '*://perplexity.ai/*'],
        homeUrl: 'https://www.perplexity.ai/'
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

async function getStoredAiGroupId() {
    const saved = await chrome.storage.local.get(AI_TAB_GROUP_STORAGE_KEY);
    const groupId = saved?.[AI_TAB_GROUP_STORAGE_KEY];
    return Number.isInteger(groupId) ? groupId : null;
}

async function setStoredAiGroupId(groupId) {
    await chrome.storage.local.set({ [AI_TAB_GROUP_STORAGE_KEY]: groupId });
}

async function getAllOpenProviderTabs() {
    const uniqueById = new Map();
    for (const provider of Object.values(PROVIDERS)) {
        for (const pattern of provider.tabPatterns) {
            const tabs = await chrome.tabs.query({ url: pattern });
            tabs.forEach(tab => {
                if (tab.id) {
                    uniqueById.set(tab.id, tab);
                }
            });
        }
    }
    return Array.from(uniqueById.values());
}

async function ensureAiProviderTabGroup() {
    if (!chrome.tabs.group || !chrome.tabGroups) {
        return;
    }

    const providerTabs = await getAllOpenProviderTabs();
    const tabIds = providerTabs.map(tab => tab.id).filter(Boolean);
    if (tabIds.length === 0) {
        return;
    }

    let groupId = await getStoredAiGroupId();
    if (groupId !== null) {
        try {
            await chrome.tabGroups.get(groupId);
        } catch (_) {
            groupId = null;
        }
    }

    if (groupId !== null) {
        await chrome.tabs.group({ groupId, tabIds });
    } else {
        groupId = await chrome.tabs.group({ tabIds });
        await setStoredAiGroupId(groupId);
    }

    await chrome.tabGroups.update(groupId, {
        title: AI_TAB_GROUP_TITLE,
        color: AI_TAB_GROUP_COLOR,
        collapsed: false
    });
}

async function getOrCreateProviderTab(provider) {
    const existingTab = await getOpenProviderTab(provider);
    if (existingTab?.id) {
        await ensureAiProviderTabGroup();
        return existingTab;
    }

    const newTab = await chrome.tabs.create({
        url: provider.homeUrl,
        active: false
    });

    if (newTab?.id) {
        await waitForTabComplete(newTab.id, 20000);
    }

    await ensureAiProviderTabGroup();
    return newTab;
}

const chatGptConversationContext = {
    conversationId: null,
    lastMessageId: null
};

const geminiConversationContext = {
    atValue: null,
    blValue: null,
    contextIds: ['', '', '']
};

function safeJsonParse(raw) {
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function makeUuid() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return generateId();
}

async function proxyFetchText(tabId, url, options = {}, timeoutMs = 120000) {
    await ensureContentScriptReady(tabId);

    return new Promise((resolve, reject) => {
        const port = chrome.tabs.connect(tabId, { name: `ai-uinify-proxy-${generateId()}` });
        const chunks = [];
        let metadata = null;
        let settled = false;

        const done = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            port.onMessage.removeListener(onMessage);
            port.onDisconnect.removeListener(onDisconnect);
            try {
                port.disconnect();
            } catch (_) {
                // no-op
            }
            resolve(value);
        };

        const fail = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            port.onMessage.removeListener(onMessage);
            port.onDisconnect.removeListener(onDisconnect);
            try {
                port.disconnect();
            } catch (_) {
                // no-op
            }
            reject(error instanceof Error ? error : new Error(String(error || 'Proxy fetch failed')));
        };

        const onDisconnect = () => {
            fail(new Error('Proxy fetch port disconnected'));
        };

        const onMessage = (message) => {
            if (message?.type === 'PROXY_RESPONSE_METADATA') {
                metadata = message.metadata || null;
                return;
            }

            if (message?.type === 'PROXY_RESPONSE_BODY_CHUNK') {
                if (message.done) {
                    done({
                        status: metadata?.status ?? 0,
                        statusText: metadata?.statusText ?? '',
                        headers: metadata?.headers ?? {},
                        text: chunks.join('')
                    });
                    return;
                }
                chunks.push(String(message.value || ''));
                return;
            }

            if (message?.type === 'PROXY_RESPONSE_ERROR') {
                fail(new Error(message.error || 'Proxy fetch execution failed'));
            }
        };

        const timer = setTimeout(() => {
            fail(new Error('Timed out waiting for proxy fetch response'));
        }, timeoutMs);

        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        port.postMessage({
            type: 'PROXY_FETCH',
            url,
            options: {
                method: options.method || 'GET',
                headers: options.headers || undefined,
                body: options.body || undefined
            }
        });
    });
}

function parseChatGptSseOutput(sseText) {
    let output = '';
    let conversationId = null;
    let messageId = null;
    let finishedOutput = '';

    const lines = String(sseText || '').split('\n');
    for (const line of lines) {
        if (!line.startsWith('data: ')) {
            continue;
        }

        const payloadText = line.slice(6).trim();
        if (!payloadText || payloadText === '[DONE]') {
            continue;
        }

        const payload = safeJsonParse(payloadText);
        if (!payload?.message) {
            continue;
        }

        const role = payload.message?.author?.role;
        if (role !== 'assistant' && role !== 'tool') {
            continue;
        }

        conversationId = payload.conversation_id || conversationId;
        messageId = payload.message?.id || messageId;

        const content = payload.message?.content;
        if (!content) {
            continue;
        }

        const candidate = extractChatGptContentText(content);

        if (candidate.trim().length >= output.trim().length) {
            output = candidate;
        }

        if (payload.message?.status === 'finished_successfully' && candidate.trim()) {
            finishedOutput = candidate;
        }
    }

    const resolvedOutput = (finishedOutput || output || '').trim();
    return { output: resolvedOutput, conversationId, messageId };
}

function extractChatGptContentText(content) {
    if (!content || typeof content !== 'object') {
        return '';
    }

    if (content.content_type === 'code' && typeof content.text === 'string') {
        return content.text;
    }

    if (content.content_type === 'tether_browsing_display' && typeof content.result === 'string') {
        return content.result;
    }

    if (!Array.isArray(content.parts)) {
        return '';
    }

    const parts = content.parts
        .map(part => extractTextDeep(part))
        .filter(Boolean);
    return parts.join('\n').trim();
}

function extractTextDeep(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (!value || typeof value !== 'object') {
        return '';
    }

    const directKeys = ['text', 'content', 'result', 'value'];
    for (const key of directKeys) {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate;
        }
    }

    if (Array.isArray(value.parts)) {
        return value.parts.map(part => extractTextDeep(part)).filter(Boolean).join('\n');
    }
    if (Array.isArray(value.content)) {
        return value.content.map(item => extractTextDeep(item)).filter(Boolean).join('\n');
    }
    if (Array.isArray(value.items)) {
        return value.items.map(item => extractTextDeep(item)).filter(Boolean).join('\n');
    }

    return '';
}

async function dispatchChatGptViaWebApp(prompt, tabId) {
    const authResp = await proxyFetchText(tabId, 'https://chat.openai.com/api/auth/session', {
        method: 'GET'
    });

    if (authResp.status === 403) {
        throw new Error('ChatGPT security check required in provider tab');
    }

    const authJson = safeJsonParse(authResp.text);
    const accessToken = authJson?.accessToken;
    if (!accessToken) {
        throw new Error('No logged-in ChatGPT session found');
    }

    const body = JSON.stringify({
        action: 'next',
        messages: [
            {
                id: makeUuid(),
                author: { role: 'user' },
                content: { content_type: 'text', parts: [prompt] }
            }
        ],
        model: 'auto',
        conversation_id: chatGptConversationContext.conversationId || undefined,
        parent_message_id: chatGptConversationContext.lastMessageId || makeUuid(),
        conversation_mode: { kind: 'primary_assistant' }
    });

    const conversationResp = await proxyFetchText(tabId, 'https://chat.openai.com/backend-api/conversation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
        },
        body
    }, 180000);

    if (conversationResp.status >= 400) {
        throw new Error(`ChatGPT backend request failed (${conversationResp.status})`);
    }

    const parsed = parseChatGptSseOutput(conversationResp.text);
    if (parsed.conversationId) {
        chatGptConversationContext.conversationId = parsed.conversationId;
    }
    if (parsed.messageId) {
        chatGptConversationContext.lastMessageId = parsed.messageId;
    }

    if (!parsed.output) {
        throw new Error('ChatGPT returned an empty response');
    }

    return { output: parsed.output, output_html: '' };
}

function extractTokenFromHtml(variableName, html) {
    const regex = new RegExp(`"${variableName}":"([^"]+)"`);
    return regex.exec(html)?.[1] || null;
}

function parseGeminiWebResponse(rawText) {
    const lines = String(rawText || '').split('\n');
    if (!lines[3]) {
        throw new Error('Unexpected Gemini response payload');
    }
    const data = safeJsonParse(lines[3]);
    const payload = safeJsonParse(data?.[0]?.[2]);
    if (!payload) {
        throw new Error('Failed to parse Gemini response');
    }

    const text = payload?.[4]?.[0]?.[1]?.[0];
    const ids = payload?.[1] && payload?.[4]?.[0]?.[0]
        ? [...payload[1], payload[4][0][0]]
        : null;

    return {
        output: String(text || '').trim(),
        ids: Array.isArray(ids) && ids.length >= 3 ? [ids[0], ids[1], ids[2]] : null
    };
}

async function dispatchGeminiViaWebApp(prompt, tabId) {
    if (!geminiConversationContext.atValue) {
        const homeResp = await proxyFetchText(tabId, 'https://gemini.google.com/', { method: 'GET' }, 90000);
        geminiConversationContext.atValue = extractTokenFromHtml('SNlM0e', homeResp.text);
        geminiConversationContext.blValue = extractTokenFromHtml('cfb2h', homeResp.text);
    }

    if (!geminiConversationContext.atValue) {
        throw new Error('No logged-in Gemini session found');
    }

    const payload = [
        null,
        JSON.stringify([
            [prompt, 0, null, []],
            null,
            geminiConversationContext.contextIds
        ])
    ];

    const query = new URLSearchParams({
        bl: geminiConversationContext.blValue || '',
        _reqid: String(Math.floor(Math.random() * 900000) + 100000),
        rt: 'c'
    }).toString();

    const endpointCandidates = [
        `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${query}`,
        `https://bard.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${query}`
    ];

    let lastError = null;
    for (const endpoint of endpointCandidates) {
        try {
            const resp = await proxyFetchText(tabId, endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: new URLSearchParams({
                    at: geminiConversationContext.atValue,
                    'f.req': JSON.stringify(payload)
                }).toString()
            }, 120000);

            if (resp.status >= 400) {
                throw new Error(`Gemini request failed (${resp.status})`);
            }

            const parsed = parseGeminiWebResponse(resp.text);
            if (parsed.ids) {
                geminiConversationContext.contextIds = parsed.ids;
            }
            if (!parsed.output) {
                throw new Error('Gemini returned an empty response');
            }
            return { output: parsed.output, output_html: '' };
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(lastError?.message || 'Gemini web request failed');
}

async function createPerplexitySession() {
    const sidResp = await fetch('https://labs-api.perplexity.ai/socket.io/?transport=polling&EIO=4', {
        method: 'GET'
    });
    if (!sidResp.ok) {
        throw new Error(`Perplexity session init failed (${sidResp.status})`);
    }
    const sidRaw = await sidResp.text();
    const sidPayload = safeJsonParse(String(sidRaw).slice(1));
    const sid = sidPayload?.sid;
    if (!sid) {
        throw new Error('Perplexity session id missing');
    }

    const initResp = await fetch(`https://labs-api.perplexity.ai/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: '40{"jwt":"anonymous-ask-user"}'
    });
    const initBody = await initResp.text();
    if (!initResp.ok || initBody !== 'OK') {
        throw new Error('Perplexity session bootstrap failed');
    }

    return sid;
}

async function dispatchPerplexityViaWebApp(prompt) {
    const sessionId = await createPerplexitySession();

    return new Promise((resolve, reject) => {
        let output = '';
        let started = false;

        const ws = new WebSocket(`wss://labs-api.perplexity.ai/socket.io/?EIO=4&transport=websocket&sid=${sessionId}`);
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Timed out waiting for Perplexity response'));
        }, 120000);

        const cleanup = () => {
            clearTimeout(timer);
            ws.onopen = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };

        ws.onopen = () => {
            ws.send('2probe');
            ws.send('5');
        };

        ws.onerror = () => {
            cleanup();
            reject(new Error('Perplexity websocket error'));
        };

        ws.onmessage = (event) => {
            const data = String(event.data || '');
            if (data === '2') {
                ws.send('3');
                return;
            }

            if (data === '6' && !started) {
                started = true;
                ws.send(`42${JSON.stringify([
                    'perplexity_playground',
                    {
                        version: '2.1',
                        source: 'default',
                        model: 'pplx-70b-online',
                        messages: [{ role: 'user', content: prompt, priority: 0 }]
                    }
                ])}`);
                return;
            }

            if (!data.startsWith('42')) {
                return;
            }

            const payload = safeJsonParse(data.slice(2));
            if (!payload || payload[0] !== 'pplx-70b-online_query_progress') {
                return;
            }

            const chunk = payload[1] || {};
            if (typeof chunk.output === 'string') {
                output = chunk.output;
            }

            if (chunk.status === 'completed') {
                cleanup();
                if (!output.trim()) {
                    reject(new Error('Perplexity returned an empty response'));
                    return;
                }
                resolve({ output: output.trim(), output_html: '' });
                return;
            }

            if (chunk.status === 'failed') {
                cleanup();
                reject(new Error('Perplexity request failed'));
            }
        };
    });
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

    let targetTab = null;
    if (provider.key !== 'perp') {
        targetTab = await getOrCreateProviderTab(provider);
    } else {
        try {
            targetTab = await getOrCreateProviderTab(provider);
        } catch (_) {
            // Perplexity web socket flow can still work without an open tab.
        }
    }

    if ((provider.key === 'gpt' || provider.key === 'gem') && (!targetTab || !targetTab.id)) {
        const message = `Unable to open ${provider.label} proxy tab`;
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

    if (targetTab?.id) {
        await ensureTabReady(targetTab.id);
    }

    emitActivity({
        type: 'dispatch.started',
        provider_alias: chunk.providerAlias,
        provider_key: provider.key,
        conversation_id: conversationId,
        dispatch_id: dispatchId,
        timestamp: new Date().toISOString(),
        payload: { tabId: targetTab?.id || null, tabUrl: targetTab?.url || '' }
    });

    try {
        let response;
        if (provider.key === 'gpt') {
            response = await dispatchChatGptViaWebApp(chunk.prompt, targetTab.id);
        } else if (provider.key === 'gem') {
            response = await dispatchGeminiViaWebApp(chunk.prompt, targetTab.id);
        } else if (provider.key === 'perp') {
            response = await dispatchPerplexityViaWebApp(chunk.prompt);
        } else {
            throw new Error(`Unsupported provider route: ${provider.key}`);
        }

        emitActivity({
            type: 'dispatch.completed',
            provider_alias: chunk.providerAlias,
            provider_key: provider.key,
            conversation_id: conversationId,
            dispatch_id: dispatchId,
            timestamp: new Date().toISOString(),
            payload: {
                output: response.output || '',
                output_html: response.output_html || '',
                tabId: targetTab?.id || null,
                mode: 'webapp-api'
            }
        });

        return {
            provider_key: provider.key,
            provider_alias: chunk.providerAlias,
            dispatch_id: dispatchId,
            status: 'completed',
            output: response.output || '',
            output_html: response.output_html || ''
        };
    } catch (primaryError) {
        emitActivity({
            type: 'dispatch.update',
            provider_alias: chunk.providerAlias,
            provider_key: provider.key,
            conversation_id: conversationId,
            dispatch_id: dispatchId,
            timestamp: new Date().toISOString(),
            payload: {
                note: `Webapp API path failed, falling back to DOM transport: ${primaryError?.message || 'unknown error'}`
            }
        });

        try {
            if (!targetTab?.id) {
                throw new Error('Fallback unavailable because provider tab is missing');
            }

            const fallbackResponse = await sendPromptToProviderTab(targetTab.id, chunk.prompt, provider.key, {
                forceFocus: false,
                dispatchId,
                conversationId,
                providerAlias: chunk.providerAlias
            });

            if (!fallbackResponse || !fallbackResponse.success || !fallbackResponse.accepted) {
                throw new Error(fallbackResponse?.error || 'Provider script did not accept fallback dispatch');
            }

            return {
                provider_key: provider.key,
                provider_alias: chunk.providerAlias,
                dispatch_id: dispatchId,
                status: 'in_flight'
            };
        } catch (fallbackError) {
            const message = fallbackError?.message || primaryError?.message || 'Failed to communicate with provider tab';
            emitActivity({
                type: 'dispatch.failed',
                provider_alias: chunk.providerAlias,
                provider_key: provider.key,
                conversation_id: conversationId,
                dispatch_id: dispatchId,
                timestamp: new Date().toISOString(),
                payload: { error: message, tabId: targetTab?.id || null }
            });
            return {
                provider_key: provider.key,
                provider_alias: chunk.providerAlias,
                dispatch_id: dispatchId,
                status: 'failed',
                error: message
            };
        }
    }
}

async function sendPromptToProviderTab(tabId, prompt, providerKey, options = {}) {
    const payload = {
        type: 'SEND_PROMPT',
        payload: {
            prompt,
            provider: providerKey,
            dispatchId: options.dispatchId,
            conversationId: options.conversationId,
            providerAlias: options.providerAlias
        }
    };

    if (options.forceFocus) {
        await focusTab(tabId);
        await delay(180);
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await ensureContentScriptReady(tabId);
            return await sendMessageWithTimeout(tabId, payload, 30000);
        } catch (error) {
            if (attempt === 3) {
                throw (error instanceof Error ? error : new Error('Failed to communicate with provider tab'));
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
        return;
    }

    if (tab.status !== 'complete') {
        await waitForTabComplete(tabId, 20000);
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
        status: responses.some(item => item.status === 'completed')
            ? 'completed'
            : responses.some(item => item.status === 'in_flight')
                ? 'in_flight'
                : 'failed',
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

    if (message.type === 'OPEN_PROVIDER_TAB') {
        const provider = PROVIDERS[message.provider];
        if (!provider) {
            sendResponse({ success: false, error: 'Unknown provider' });
            return false;
        }

        getOrCreateProviderTab(provider)
            .then(tab => sendResponse({ success: true, tabId: tab?.id || null }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'PROVIDER_RESPONSE_EVENT') {
        const payload = message.payload || {};
        const status = payload.status;
        const providerKey = payload.providerKey;
        const providerAlias = payload.providerAlias || `@${providerKey || 'unknown'}`;
        const timestamp = new Date().toISOString();

        if (status === 'completed') {
            emitActivity({
                type: 'dispatch.completed',
                provider_alias: providerAlias,
                provider_key: providerKey,
                conversation_id: payload.conversationId || '',
                dispatch_id: payload.dispatchId || generateId(),
                timestamp,
                payload: {
                    output: payload.output || '',
                    output_html: payload.outputHtml || ''
                }
            });
        } else {
            emitActivity({
                type: 'dispatch.failed',
                provider_alias: providerAlias,
                provider_key: providerKey,
                conversation_id: payload.conversationId || '',
                dispatch_id: payload.dispatchId || generateId(),
                timestamp,
                payload: {
                    error: payload.error || 'Provider response failed'
                }
            });
        }

        sendResponse({ success: true });
        return false;
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

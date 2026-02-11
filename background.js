// Background service worker
console.log('AI Uinify background service worker loaded');

// Import orchestrator (this will be updated when we compile TypeScript)
// For now, we'll use a mock implementation until TypeScript is compiled

let orchestratorService = null;

// Initialize orchestrator
function initializeOrchestrator() {
    // This will be replaced with actual orchestrator once TypeScript is compiled
    // For now, create a mock structure
    orchestratorService = {
        coordinator: {
            dispatch: async (prompt, conversationId) => {
                console.log('Mock dispatch:', prompt);
                
                // Simulate dispatch process
                const mentions = prompt.match(/@(gpt|gem|perp|chatgpt|gemini|perplexity)/gi) || [];
                
                for (const mention of mentions) {
                    const alias = mention.toLowerCase();
                    
                    // Emit activity events
                    await emitActivity({
                        type: 'dispatch.created',
                        provider_alias: alias,
                        conversation_id: conversationId,
                        dispatch_id: generateId(),
                        timestamp: new Date().toISOString(),
                        payload: {}
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    await emitActivity({
                        type: 'dispatch.started',
                        provider_alias: alias,
                        conversation_id: conversationId,
                        dispatch_id: generateId(),
                        timestamp: new Date().toISOString(),
                        payload: {}
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    await emitActivity({
                        type: 'dispatch.completed',
                        provider_alias: alias,
                        conversation_id: conversationId,
                        dispatch_id: generateId(),
                        timestamp: new Date().toISOString(),
                        payload: { output: 'Mock response completed' }
                    });
                }
                
                return {
                    conversation_id: conversationId,
                    status: 'completed',
                    responses: mentions.map(m => ({
                        provider_alias: m.toLowerCase(),
                        status: 'completed',
                        output: 'Mock response'
                    }))
                };
            }
        },
        activityFeed: {
            subscribe: (callback) => {
                // Store callback for activity events
                return () => {}; // Unsubscribe function
            }
        }
    };
}

function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emitActivity(event) {
    // Send activity event to all popup instances
    chrome.runtime.sendMessage({
        type: 'ACTIVITY_EVENT',
        event: event
    }).catch(() => {
        // Popup might not be open
    });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DISPATCH_PROMPT') {
        handleDispatch(message.payload)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
    }
});

async function handleDispatch(payload) {
    const { prompt } = payload;
    const conversationId = generateId();
    
    if (!orchestratorService) {
        initializeOrchestrator();
    }
    
    try {
        const result = await orchestratorService.coordinator.dispatch(prompt, conversationId);
        console.log('Dispatch result:', result);
        return result;
    } catch (error) {
        console.error('Dispatch error:', error);
        throw error;
    }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
    console.log('AI Uinify extension installed');
    initializeOrchestrator();
});

// Initialize on startup
initializeOrchestrator();
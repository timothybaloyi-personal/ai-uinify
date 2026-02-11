// Popup UI controller
let activityBuffer = [];

const promptInput = document.getElementById('promptInput');
const dispatchBtn = document.getElementById('dispatchBtn');
const statusArea = document.getElementById('statusArea');
const activityList = document.getElementById('activityList');

dispatchBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    
    if (!prompt) {
        showStatus('Please enter a prompt', 'error');
        return;
    }
    
    // Check if prompt contains any mention aliases
    if (!/@(gpt|gem|perp|chatgpt|gemini|perplexity)/i.test(prompt)) {
        showStatus('Prompt must include at least one mention (@gpt, @gem, or @perp)', 'error');
        return;
    }
    
    dispatchBtn.disabled = true;
    activityBuffer = [];
    activityList.innerHTML = '';
    
    showStatus('Dispatching to providers...', 'info');
    
    try {
        // Send message to background script
        const response = await chrome.runtime.sendMessage({
            type: 'DISPATCH_PROMPT',
            payload: { prompt }
        });
        
        if (response.success) {
            showStatus('Dispatch completed successfully!', 'success');
        } else {
            showStatus(`Error: ${response.error}`, 'error');
        }
    } catch (error) {
        showStatus(`Failed to dispatch: ${error.message}`, 'error');
    } finally {
        dispatchBtn.disabled = false;
    }
});

// Listen for activity events from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ACTIVITY_EVENT') {
        addActivityItem(message.event);
    }
});

function showStatus(text, type = 'info') {
    statusArea.innerHTML = `<div class="status ${type}">${text}</div>`;
    
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            statusArea.innerHTML = '';
        }, 5000);
    }
}

function addActivityItem(event) {
    activityBuffer.push(event);
    
    const item = document.createElement('div');
    item.className = `activity-item ${event.type.includes('completed') ? 'completed' : event.type.includes('failed') ? 'failed' : ''}`;
    
    let message = '';
    switch (event.type) {
        case 'dispatch.created':
            message = `<span class="activity-provider">${event.provider_alias}</span> - Dispatch created`;
            break;
        case 'dispatch.started':
            message = `<span class="activity-provider">${event.provider_alias}</span> - Started processing`;
            break;
        case 'dispatch.update':
            message = `<span class="activity-provider">${event.provider_alias}</span> - Receiving response...`;
            break;
        case 'dispatch.completed':
            message = `<span class="activity-provider">${event.provider_alias}</span> - ✓ Completed`;
            break;
        case 'dispatch.failed':
            message = `<span class="activity-provider">${event.provider_alias}</span> - ✗ Failed: ${event.payload?.error || 'Unknown error'}`;
            break;
    }
    
    const time = new Date(event.timestamp).toLocaleTimeString();
    item.innerHTML = `${message}<div class="activity-time">${time}</div>`;
    
    activityList.insertBefore(item, activityList.firstChild);
    
    // Keep only last 20 items
    while (activityList.children.length > 20) {
        activityList.removeChild(activityList.lastChild);
    }
}
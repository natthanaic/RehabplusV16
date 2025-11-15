/**
 * LINE Webhook ID Capture Page
 * Auto-refreshes to capture User/Group IDs from LINE webhook events
 */

// Refresh interval (30 seconds - increased from 10 to reduce server load)
const REFRESH_INTERVAL = 30000;
let refreshTimer = null;

/**
 * Load webhook events from server
 */
async function loadEvents() {
    try {
        const data = await apiGet('/api/admin/notification/line/webhook-ids');

        if (data && data.events) {
            displayEvents(data.events);
        }
    } catch (error) {
        console.error('Error loading events:', error);
        showAlert('Failed to load webhook events', 'danger');
    }
}

/**
 * Display webhook events
 * @param {Array} events - Array of webhook events
 */
function displayEvents(events) {
    const container = document.getElementById('eventsContainer');

    if (!events || events.length === 0) {
        container.innerHTML = `
            <div class="no-events">
                <i class="bi bi-inbox"></i>
                <p><strong>No events captured yet</strong></p>
                <p>Send a message to your LINE bot to see User/Group IDs here</p>
                <button class="btn btn-primary mt-3" onclick="loadEvents()">
                    <i class="bi bi-arrow-clockwise me-2"></i>Check Again
                </button>
            </div>
        `;
        return;
    }

    let html = '';
    events.forEach((event) => {
        const targetId = event.userId || event.groupId || event.roomId;
        const targetType = event.userId ? 'User ID' : event.groupId ? 'Group ID' : 'Room ID';
        const badgeClass = event.userId ? 'bg-success' : event.groupId ? 'bg-primary' : 'bg-info';

        html += `
            <div class="event-card">
                <div class="d-flex justify-content-between align-items-start mb-3">
                    <div>
                        <span class="badge ${badgeClass}">${escapeHtml(targetType)}</span>
                        <span class="badge bg-secondary ms-2">${escapeHtml(event.type)}</span>
                    </div>
                    <span class="timestamp">${formatDateTime(event.timestamp)}</span>
                </div>

                ${targetId ? `
                    <div>
                        <strong>${escapeHtml(targetType)}:</strong>
                        <div class="id-display">${escapeHtml(targetId)}</div>
                        <button class="copy-btn" onclick="copyToClipboard('${escapeHtml(targetId)}')">
                            <i class="bi bi-clipboard me-2"></i>Copy ${escapeHtml(targetType)}
                        </button>
                    </div>
                ` : ''}

                ${event.message ? `
                    <div class="mt-3">
                        <strong>Message:</strong> ${escapeHtml(event.message)}
                    </div>
                ` : ''}
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 */
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            showAlert(`Copied to clipboard!\n\n${text}\n\nNow paste this into the Notification Settings page.`, 'success');
        })
        .catch(err => {
            console.error('Failed to copy:', err);
            // Fallback for browsers that don't support clipboard API
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                showAlert(`Copied to clipboard!\n\n${text}`, 'success');
            } catch (err) {
                prompt('Copy this ID:', text);
            }
            document.body.removeChild(textArea);
        });
}

/**
 * Start auto-refresh
 */
function startAutoRefresh() {
    stopAutoRefresh(); // Clear any existing timer
    refreshTimer = setInterval(loadEvents, REFRESH_INTERVAL);
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

/**
 * Handle page visibility changes
 * Pause auto-refresh when tab is hidden to save resources
 */
function handleVisibilityChange() {
    if (document.hidden) {
        stopAutoRefresh();
    } else {
        loadEvents(); // Refresh immediately when returning to tab
        startAutoRefresh();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    loadEvents();
    startAutoRefresh();

    // Pause auto-refresh when tab is hidden
    document.addEventListener('visibilitychange', handleVisibilityChange);
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
});

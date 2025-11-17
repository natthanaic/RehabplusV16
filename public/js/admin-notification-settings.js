/**
 * Notification Settings Management
 * Uses utils.js for getCookie(), showAlert(), validateEmail(), apiGet(), apiPost()
 */
document.addEventListener('DOMContentLoaded', function() {
    loadSMTPSettings();
    loadLINESettings();
    setupFormHandlers();
});

// Setup form handlers
function setupFormHandlers() {
    // SMTP Form Submit
    document.getElementById('smtpForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        await saveSMTPSettings();
    });

    // LINE Form Submit
    document.getElementById('lineForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        await saveLINESettings();
    });

    // Update status badges when enabled/disabled
    document.getElementById('smtpEnabled').addEventListener('change', function() {
        updateStatusBadge('smtp', this.value === '1');
    });

    document.getElementById('lineEnabled').addEventListener('change', function() {
        updateStatusBadge('line', this.value === '1');
    });
}

// Update status badge
function updateStatusBadge(type, enabled) {
    const badge = document.getElementById(`${type}Status`);
    if (enabled) {
        badge.className = 'notification-status active';
        badge.textContent = 'Active';
    } else {
        badge.className = 'notification-status inactive';
        badge.textContent = 'Inactive';
    }
}

// Load SMTP Settings
async function loadSMTPSettings() {
    try {
        const settings = await apiGet('/api/admin/notification/smtp');
        populateSMTPForm(settings);
    } catch (error) {
        // 404 is okay - means no settings yet, use defaults
        if (error.message && (error.message.includes('404') || error.message.includes('Not Found'))) {
            console.log('No SMTP settings found, using defaults');
        } else {
            console.error('Error loading SMTP settings:', error);
            showAlert('Failed to load SMTP settings: ' + error.message, 'danger');
        }
    }
}

// Populate SMTP Form
function populateSMTPForm(settings) {
    if (!settings) return;

    document.getElementById('smtpEnabled').value = settings.enabled || '0';
    document.getElementById('smtpHost').value = settings.host || '';
    document.getElementById('smtpPort').value = settings.port || '';
    document.getElementById('smtpSecure').value = settings.secure || 'none';
    document.getElementById('smtpUser').value = settings.user || '';
    document.getElementById('smtpPassword').value = settings.password || '';
    document.getElementById('smtpFromName').value = settings.fromName || '';
    document.getElementById('smtpFromEmail').value = settings.fromEmail || '';

    updateStatusBadge('smtp', settings.enabled === 1 || settings.enabled === '1');
}

// Save SMTP Settings
async function saveSMTPSettings() {
    try {
        const settings = {
            enabled: document.getElementById('smtpEnabled').value,
            host: document.getElementById('smtpHost').value.trim(),
            port: document.getElementById('smtpPort').value,
            secure: document.getElementById('smtpSecure').value,
            user: document.getElementById('smtpUser').value.trim(),
            password: document.getElementById('smtpPassword').value,
            fromName: document.getElementById('smtpFromName').value.trim(),
            fromEmail: document.getElementById('smtpFromEmail').value.trim()
        };

        // Validate required fields
        if (settings.enabled === '1') {
            if (!settings.host || !settings.port || !settings.user || !settings.password || !settings.fromEmail) {
                showAlert('Please fill in all required fields', 'warning');
                return;
            }

            // Validate email format using utils.js
            if (!validateEmail(settings.fromEmail)) {
                showAlert('Please enter a valid email address', 'warning');
                return;
            }
        }

        await apiPost('/api/admin/notification/smtp', settings);
        showAlert('SMTP settings saved successfully', 'success');
        updateStatusBadge('smtp', settings.enabled === '1');
    } catch (error) {
        console.error('Error saving SMTP settings:', error);
        showAlert(error.message || 'Failed to save SMTP settings', 'danger');
    }
}

// Test SMTP Configuration
async function testSMTP() {
    const testEmail = document.getElementById('smtpTestEmail').value.trim();

    if (!testEmail) {
        showAlert('Please enter a test email address', 'warning');
        return;
    }

    // Validate email format using utils.js
    if (!validateEmail(testEmail)) {
        showAlert('Please enter a valid email address', 'warning');
        return;
    }

    try {
        showAlert('Sending test email...', 'info');
        await apiPost('/api/admin/notification/smtp/test', { email: testEmail });
        showAlert('Test email sent successfully! Please check your inbox.', 'success');
    } catch (error) {
        console.error('Error testing SMTP:', error);
        showAlert(error.message || 'Failed to send test email. Please check your settings.', 'danger');
    }
}

// Load LINE Settings
async function loadLINESettings() {
    try {
        const settings = await apiGet('/api/admin/notification/line');
        populateLINEForm(settings);
    } catch (error) {
        // 404 is okay - means no settings yet, use defaults
        if (error.message && (error.message.includes('404') || error.message.includes('Not Found'))) {
            console.log('No LINE settings found, using defaults');
        } else {
            console.error('Error loading LINE settings:', error);
            showAlert('Failed to load LINE settings: ' + error.message, 'danger');
        }
    }
}

// Populate LINE Form
function populateLINEForm(settings) {
    if (!settings) return;

    document.getElementById('lineEnabled').value = settings.enabled || '0';
    document.getElementById('lineAccessToken').value = settings.accessToken || '';
	document.getElementById('lineTargetId').value = settings.targetId || '';

    // Parse event notifications JSON
    if (settings.eventNotifications) {
        let events;
        if (typeof settings.eventNotifications === 'string') {
            try {
                events = JSON.parse(settings.eventNotifications);
            } catch (e) {
                events = {};
            }
        } else {
            events = settings.eventNotifications;
        }

        document.getElementById('lineNewAppointment').checked = events.newAppointment || false;
        document.getElementById('lineAppointmentCancelled').checked = events.appointmentCancelled || false;
        document.getElementById('lineNewPatient').checked = events.newPatient || false;
        document.getElementById('linePaymentReceived').checked = events.paymentReceived || false;
    }

    updateStatusBadge('line', settings.enabled === 1 || settings.enabled === '1');
}

// Save LINE Settings
async function saveLINESettings() {
    try {
        const eventNotifications = {
            newAppointment: document.getElementById('lineNewAppointment').checked,
            appointmentCancelled: document.getElementById('lineAppointmentCancelled').checked,
            newPatient: document.getElementById('lineNewPatient').checked,
            paymentReceived: document.getElementById('linePaymentReceived').checked
        };

        const settings = {
            enabled: document.getElementById('lineEnabled').value,
            accessToken: document.getElementById('lineAccessToken').value.trim(),
			targetId: document.getElementById('lineTargetId').value.trim(),
            eventNotifications: JSON.stringify(eventNotifications)
        };

        // Validate required fields
        if (settings.enabled === '1') {
            if (!settings.accessToken) {
                showAlert('Please enter Channel Access Token', 'warning');
                return;
            }
            if (!settings.targetId) {
                showAlert('Please enter Target User ID or Group ID', 'warning');
                return;
            }
        }

        await apiPost('/api/admin/notification/line', settings);
        showAlert('LINE settings saved successfully', 'success');
        updateStatusBadge('line', settings.enabled === '1');
    } catch (error) {
        console.error('Error saving LINE settings:', error);
        showAlert(error.message || 'Failed to save LINE settings', 'danger');
    }
}

// Test LINE Notification
async function testLINE() {
    const testMessage = document.getElementById('lineTestMessage').value.trim();

    if (!testMessage) {
        showAlert('Please enter a test message', 'warning');
        return;
    }

    try {
        showAlert('Sending test notification...', 'info');
        await apiPost('/api/admin/notification/line/test', { message: testMessage });
        showAlert('Test notification sent successfully! Please check your LINE app.', 'success');
    } catch (error) {
        console.error('Error testing LINE:', error);
        showAlert(error.message || 'Failed to send test notification. Please check your settings.', 'danger');
    }
}

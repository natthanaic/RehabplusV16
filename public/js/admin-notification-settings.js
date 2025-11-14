// Notification Settings Management
document.addEventListener('DOMContentLoaded', function() {
    loadSMTPSettings();
    loadLINESettings();
    setupFormHandlers();
});

// Get authentication token from cookie
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Show alert message
function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    alertContainer.appendChild(alertDiv);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

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
        const token = getCookie('authToken');
        const response = await fetch('/api/admin/notification/smtp', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const settings = await response.json();
            populateSMTPForm(settings);
        } else if (response.status === 404) {
            // No settings found, use defaults
            console.log('No SMTP settings found, using defaults');
        } else {
            throw new Error('Failed to load SMTP settings');
        }
    } catch (error) {
        console.error('Error loading SMTP settings:', error);
        showAlert('Failed to load SMTP settings', 'danger');
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
        const token = getCookie('authToken');
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

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(settings.fromEmail)) {
                showAlert('Please enter a valid email address', 'warning');
                return;
            }
        }

        const response = await fetch('/api/admin/notification/smtp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(settings)
        });

        if (response.ok) {
            showAlert('SMTP settings saved successfully', 'success');
            updateStatusBadge('smtp', settings.enabled === '1');
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save SMTP settings');
        }
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(testEmail)) {
        showAlert('Please enter a valid email address', 'warning');
        return;
    }

    try {
        const token = getCookie('authToken');
        showAlert('Sending test email...', 'info');

        const response = await fetch('/api/admin/notification/smtp/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ email: testEmail })
        });

        if (response.ok) {
            showAlert('Test email sent successfully! Please check your inbox.', 'success');
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to send test email');
        }
    } catch (error) {
        console.error('Error testing SMTP:', error);
        showAlert(error.message || 'Failed to send test email. Please check your settings.', 'danger');
    }
}

// Load LINE Settings
async function loadLINESettings() {
    try {
        const token = getCookie('authToken');
        const response = await fetch('/api/admin/notification/line', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const settings = await response.json();
            populateLINEForm(settings);
        } else if (response.status === 404) {
            // No settings found, use defaults
            console.log('No LINE settings found, using defaults');
        } else {
            throw new Error('Failed to load LINE settings');
        }
    } catch (error) {
        console.error('Error loading LINE settings:', error);
        showAlert('Failed to load LINE settings', 'danger');
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
        const token = getCookie('authToken');

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

        const response = await fetch('/api/admin/notification/line', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(settings)
        });

        if (response.ok) {
            showAlert('LINE settings saved successfully', 'success');
            updateStatusBadge('line', settings.enabled === '1');
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save LINE settings');
        }
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
        const token = getCookie('authToken');
        showAlert('Sending test notification...', 'info');

        const response = await fetch('/api/admin/notification/line/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ message: testMessage })
        });

        if (response.ok) {
            showAlert('Test notification sent successfully! Please check your LINE app.', 'success');
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to send test notification');
        }
    } catch (error) {
        console.error('Error testing LINE:', error);
        showAlert(error.message || 'Failed to send test notification. Please check your settings.', 'danger');
    }
}

// Logout function
function logout() {
    document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    window.location.href = '/login';
}
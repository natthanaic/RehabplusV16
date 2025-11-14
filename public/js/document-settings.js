// Document Settings - Live Preview and Save
// RehabPlus System

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

const DocumentSettings = {
    settings: {
        bill: {
            companyName: 'Lantavafix Clinic',
            address: '123 Healthcare Street, Bangkok 10110',
            phone: '02-123-4567',
            taxId: '0123456789012',
            headerColor: '#667eea',
            footerText: 'Thank you for your business!',
            showLogo: true,
            showTax: true,
            showQR: true,
            logo: null
        },
        certificate: {
            clinicName: 'Lantavafix Clinic',
            address: '123 Healthcare Street, Bangkok',
            borderColor: '#667eea',
            doctorName: 'Dr. Name',
            license: 'XXXXX',
            logo: null
        }
    },

    async init() {
        await this.loadSettings();
        this.setupEventListeners();
    },

    async loadSettings() {
        try {
            const response = await fetch('/api/document-settings', {
                headers: { 'Authorization': `Bearer ${getCookie('authToken')}` }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.settings) {
                    this.settings = { ...this.settings, ...JSON.parse(data.settings) };
                    this.populateForm();
                }
            }
        } catch (error) {
            console.log('No saved settings, using defaults');
        }
    },

    populateForm() {
        // Bill settings
        document.getElementById('bill-company-name').value = this.settings.bill.companyName || '';
        document.getElementById('bill-address').value = this.settings.bill.address || '';
        document.getElementById('bill-phone').value = this.settings.bill.phone || '';
        document.getElementById('bill-tax-id').value = this.settings.bill.taxId || '';
        document.getElementById('bill-header-color').value = this.settings.bill.headerColor || '#667eea';
        document.getElementById('bill-footer').value = this.settings.bill.footerText || '';
        document.getElementById('bill-show-logo').checked = this.settings.bill.showLogo !== false;
        document.getElementById('bill-show-tax').checked = this.settings.bill.showTax !== false;
        document.getElementById('bill-show-qr').checked = this.settings.bill.showQR !== false;

        // Certificate settings
        document.getElementById('cert-clinic-name').value = this.settings.certificate.clinicName || '';
        document.getElementById('cert-address').value = this.settings.certificate.address || '';
        document.getElementById('cert-border-color').value = this.settings.certificate.borderColor || '#667eea';
        document.getElementById('cert-doctor-name').value = this.settings.certificate.doctorName || '';
        document.getElementById('cert-license').value = this.settings.certificate.license || '';
    },

    setupEventListeners() {
        // Color value display updates
        document.getElementById('bill-header-color')?.addEventListener('input', (e) => {
            document.getElementById('bill-header-color-value').textContent = e.target.value;
        });

        document.getElementById('cert-border-color')?.addEventListener('input', (e) => {
            document.getElementById('cert-border-color-value').textContent = e.target.value;
        });

        // Save button
        document.getElementById('saveSettings')?.addEventListener('click', () => {
            this.saveSettings();
        });
    },

    async saveSettings() {
        // Collect settings from form
        const settings = {
            bill: {
                companyName: document.getElementById('bill-company-name').value,
                address: document.getElementById('bill-address').value,
                phone: document.getElementById('bill-phone').value,
                taxId: document.getElementById('bill-tax-id').value,
                headerColor: document.getElementById('bill-header-color').value,
                footerText: document.getElementById('bill-footer').value,
                showLogo: document.getElementById('bill-show-logo').checked,
                showTax: document.getElementById('bill-show-tax').checked,
                showQR: document.getElementById('bill-show-qr').checked
            },
            certificate: {
                clinicName: document.getElementById('cert-clinic-name').value,
                address: document.getElementById('cert-address').value,
                borderColor: document.getElementById('cert-border-color').value,
                doctorName: document.getElementById('cert-doctor-name').value,
                license: document.getElementById('cert-license').value
            }
        };

        try {
            const response = await fetch('/api/document-settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getCookie('authToken')}`
                },
                body: JSON.stringify({ settings: JSON.stringify(settings) })
            });

            if (response.ok) {
                this.showAlert('Settings saved successfully!', 'success');
                this.settings = settings;

                // Auto-refresh the preview iframes
                setTimeout(() => {
                    const billFrame = document.getElementById('bill-preview-frame');
                    const certFrame = document.getElementById('cert-preview-frame');
                    if (billFrame) billFrame.contentWindow.location.reload();
                    if (certFrame) certFrame.contentWindow.location.reload();
                }, 500);
            } else {
                const error = await response.json();
                this.showAlert('Error: ' + (error.error || 'Failed to save settings'), 'danger');
            }
        } catch (error) {
            console.error('Save error:', error);
            this.showAlert('Network error. Please try again.', 'danger');
        }
    },

    showAlert(message, type = 'info') {
        const container = document.getElementById('alert-container');
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} alert-dismissible fade show`;
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        container.appendChild(alert);

        setTimeout(() => {
            alert.remove();
        }, 5000);
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    DocumentSettings.init();
});
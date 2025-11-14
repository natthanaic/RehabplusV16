// Admin Booking Settings JavaScript

// Load all data on page load
document.addEventListener('DOMContentLoaded', () => {
    loadPackages();
    loadPromos();
    loadTestimonials();
    loadGeneralSettings();
});

// ============= SERVICE PACKAGES =============

async function loadPackages() {
    try {
        const response = await fetch('/api/admin/booking/packages');
        const packages = await response.json();

        const container = document.getElementById('packagesList');

        if (packages.length === 0) {
            container.innerHTML = '<div class="col-12"><div class="alert alert-info">No packages yet. Click "Add Package" to create one.</div></div>';
            return;
        }

        container.innerHTML = packages.map(pkg => `
            <div class="col-md-6 col-lg-4">
                <div class="card package-card ${pkg.is_featured ? 'featured' : ''} ${pkg.is_best_value ? 'best-value' : ''}">
                    ${pkg.is_featured ? '<span class="badge badge-featured">Most Popular</span>' : ''}
                    ${pkg.is_best_value ? '<span class="badge badge-best-value text-white">Best Value</span>' : ''}
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h5 class="card-title">${pkg.package_name}</h5>
                            <span class="badge ${pkg.active ? 'bg-success' : 'bg-secondary'}">${pkg.active ? 'Active' : 'Inactive'}</span>
                        </div>
                        <p class="text-muted small mb-2">Code: ${pkg.package_code}</p>
                        <h4 class="text-primary">${pkg.price.toLocaleString()} THB</h4>
                        <p class="text-muted"><i class="bi bi-clock"></i> ${pkg.duration_minutes} minutes</p>
                        ${pkg.description ? `<p class="card-text small">${pkg.description}</p>` : ''}
                        ${pkg.pain_zones ? `<p class="small"><strong>For:</strong> ${pkg.pain_zones}</p>` : ''}
                        <div class="d-flex gap-2 mt-3">
                            <button class="btn btn-sm btn-outline-primary" onclick="editPackage(${pkg.id})">
                                <i class="bi bi-pencil"></i> Edit
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deletePackage(${pkg.id})">
                                <i class="bi bi-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading packages:', error);
        alert('Failed to load packages');
    }
}

function showPackageModal(pkg = null) {
    const modal = new bootstrap.Modal(document.getElementById('packageModal'));

    if (pkg) {
        // Edit mode
        document.getElementById('package_id').value = pkg.id;
        document.getElementById('package_name').value = pkg.package_name;
        document.getElementById('package_code').value = pkg.package_code;
        document.getElementById('package_price').value = pkg.price;
        document.getElementById('package_duration').value = pkg.duration_minutes;
        document.getElementById('package_description').value = pkg.description || '';
        document.getElementById('package_benefits').value = pkg.benefits ? JSON.parse(pkg.benefits).join('\n') : '';
        document.getElementById('package_display_order').value = pkg.display_order;
        document.getElementById('package_active').value = pkg.active;
        document.getElementById('package_featured').checked = pkg.is_featured;
        document.getElementById('package_best_value').checked = pkg.is_best_value;

        // Set pain zones
        const painZones = pkg.pain_zones ? pkg.pain_zones.split(',') : [];
        document.querySelectorAll('.pain-zone').forEach(cb => {
            cb.checked = painZones.includes(cb.value);
        });
    } else {
        // New package mode
        document.getElementById('packageForm').reset();
        document.getElementById('package_id').value = '';
    }

    modal.show();
}

async function editPackage(id) {
    try {
        const response = await fetch(`/api/admin/booking/packages/${id}`);
        const pkg = await response.json();
        showPackageModal(pkg);
    } catch (error) {
        console.error('Error loading package:', error);
        alert('Failed to load package details');
    }
}

async function savePackage() {
    const id = document.getElementById('package_id').value;
    const benefits = document.getElementById('package_benefits').value
        .split('\n')
        .filter(b => b.trim())
        .map(b => b.trim());

    const painZones = Array.from(document.querySelectorAll('.pain-zone:checked'))
        .map(cb => cb.value);

    const data = {
        package_name: document.getElementById('package_name').value,
        package_code: document.getElementById('package_code').value,
        price: parseFloat(document.getElementById('package_price').value),
        duration_minutes: parseInt(document.getElementById('package_duration').value),
        description: document.getElementById('package_description').value,
        benefits: JSON.stringify(benefits),
        pain_zones: painZones.join(','),
        display_order: parseInt(document.getElementById('package_display_order').value),
        active: parseInt(document.getElementById('package_active').value),
        is_featured: document.getElementById('package_featured').checked ? 1 : 0,
        is_best_value: document.getElementById('package_best_value').checked ? 1 : 0
    };

    try {
        const url = id ? `/api/admin/booking/packages/${id}` : '/api/admin/booking/packages';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('packageModal')).hide();
            loadPackages();
            alert('Package saved successfully!');
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to save package'));
        }
    } catch (error) {
        console.error('Error saving package:', error);
        alert('Failed to save package');
    }
}

async function deletePackage(id) {
    if (!confirm('Are you sure you want to delete this package?')) return;

    try {
        const response = await fetch(`/api/admin/booking/packages/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadPackages();
            alert('Package deleted successfully!');
        } else {
            alert('Failed to delete package');
        }
    } catch (error) {
        console.error('Error deleting package:', error);
        alert('Failed to delete package');
    }
}

// ============= PROMOTIONS =============

async function loadPromos() {
    try {
        const response = await fetch('/api/admin/booking/promotions');
        const promos = await response.json();

        const container = document.getElementById('promosList');

        if (promos.length === 0) {
            container.innerHTML = '<div class="alert alert-info">No promotions yet. Click "Add Promotion" to create one.</div>';
            return;
        }

        container.innerHTML = promos.map(promo => {
            const now = new Date();
            const validFrom = new Date(promo.valid_from);
            const validUntil = new Date(promo.valid_until);
            const isActive = promo.active && now >= validFrom && now <= validUntil;

            return `
                <div class="card promo-card mb-3">
                    <div class="card-body">
                        <div class="row align-items-center">
                            <div class="col-md-3">
                                <h5 class="mb-0">${promo.promo_code}</h5>
                                <span class="badge ${isActive ? 'bg-success' : 'bg-secondary'} mt-1">
                                    ${isActive ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                            <div class="col-md-4">
                                <p class="mb-0 small text-muted">${promo.description || 'No description'}</p>
                                <p class="mb-0"><strong>${promo.discount_type === 'PERCENTAGE' ? promo.discount_value + '%' : promo.discount_value + ' THB'} OFF</strong></p>
                            </div>
                            <div class="col-md-3">
                                <p class="mb-0 small">
                                    <i class="bi bi-calendar"></i> ${new Date(promo.valid_from).toLocaleDateString()} - ${new Date(promo.valid_until).toLocaleDateString()}
                                </p>
                                ${promo.usage_limit ? `<p class="mb-0 small">Used: ${promo.usage_count}/${promo.usage_limit}</p>` : ''}
                            </div>
                            <div class="col-md-2 text-end">
                                <button class="btn btn-sm btn-outline-primary" onclick="editPromo(${promo.id})">
                                    <i class="bi bi-pencil"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="deletePromo(${promo.id})">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading promotions:', error);
        alert('Failed to load promotions');
    }
}

function showPromoModal(promo = null) {
    const modal = new bootstrap.Modal(document.getElementById('promoModal'));

    if (promo) {
        document.getElementById('promo_id').value = promo.id;
        document.getElementById('promo_code').value = promo.promo_code;
        document.getElementById('promo_description').value = promo.description || '';
        document.getElementById('promo_discount_type').value = promo.discount_type;
        document.getElementById('promo_discount_value').value = promo.discount_value;
        document.getElementById('promo_valid_from').value = promo.valid_from;
        document.getElementById('promo_valid_until').value = promo.valid_until;
        document.getElementById('promo_usage_limit').value = promo.usage_limit || '';
        document.getElementById('promo_active').value = promo.active;
    } else {
        document.getElementById('promoForm').reset();
        document.getElementById('promo_id').value = '';
        // Set default dates (today to 30 days from now)
        const today = new Date().toISOString().split('T')[0];
        const future = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
        document.getElementById('promo_valid_from').value = today;
        document.getElementById('promo_valid_until').value = future;
    }

    modal.show();
}

async function editPromo(id) {
    try {
        const response = await fetch(`/api/admin/booking/promotions/${id}`);
        const promo = await response.json();
        showPromoModal(promo);
    } catch (error) {
        console.error('Error loading promotion:', error);
        alert('Failed to load promotion details');
    }
}

async function savePromo() {
    const id = document.getElementById('promo_id').value;
    const data = {
        promo_code: document.getElementById('promo_code').value.toUpperCase(),
        description: document.getElementById('promo_description').value,
        discount_type: document.getElementById('promo_discount_type').value,
        discount_value: parseFloat(document.getElementById('promo_discount_value').value),
        valid_from: document.getElementById('promo_valid_from').value,
        valid_until: document.getElementById('promo_valid_until').value,
        usage_limit: document.getElementById('promo_usage_limit').value ? parseInt(document.getElementById('promo_usage_limit').value) : null,
        active: parseInt(document.getElementById('promo_active').value)
    };

    try {
        const url = id ? `/api/admin/booking/promotions/${id}` : '/api/admin/booking/promotions';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('promoModal')).hide();
            loadPromos();
            alert('Promotion saved successfully!');
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to save promotion'));
        }
    } catch (error) {
        console.error('Error saving promotion:', error);
        alert('Failed to save promotion');
    }
}

async function deletePromo(id) {
    if (!confirm('Are you sure you want to delete this promotion?')) return;

    try {
        const response = await fetch(`/api/admin/booking/promotions/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadPromos();
            alert('Promotion deleted successfully!');
        } else {
            alert('Failed to delete promotion');
        }
    } catch (error) {
        console.error('Error deleting promotion:', error);
        alert('Failed to delete promotion');
    }
}

// ============= TESTIMONIALS =============

async function loadTestimonials() {
    try {
        const response = await fetch('/api/admin/booking/testimonials');
        const testimonials = await response.json();

        const container = document.getElementById('testimonialsList');

        if (testimonials.length === 0) {
            container.innerHTML = '<div class="alert alert-info">No testimonials yet. Click "Add Testimonial" to create one.</div>';
            return;
        }

        container.innerHTML = testimonials.map(t => `
            <div class="card mb-3">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <h5 class="card-title">${t.patient_name}</h5>
                            <div class="mb-2">
                                ${Array(t.rating).fill('<i class="bi bi-star-fill text-warning"></i>').join('')}
                                ${Array(5-t.rating).fill('<i class="bi bi-star text-muted"></i>').join('')}
                            </div>
                            <p class="card-text">${t.testimonial_text}</p>
                            <span class="badge ${t.display_on_public ? 'bg-success' : 'bg-secondary'}">
                                ${t.display_on_public ? 'Showing on public page' : 'Hidden'}
                            </span>
                        </div>
                        <div>
                            <button class="btn btn-sm btn-outline-primary" onclick="editTestimonial(${t.id})">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteTestimonial(${t.id})">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading testimonials:', error);
        alert('Failed to load testimonials');
    }
}

function showTestimonialModal(testimonial = null) {
    const modal = new bootstrap.Modal(document.getElementById('testimonialModal'));

    if (testimonial) {
        document.getElementById('testimonial_id').value = testimonial.id;
        document.getElementById('testimonial_patient_name').value = testimonial.patient_name;
        document.getElementById('testimonial_rating').value = testimonial.rating;
        document.getElementById('testimonial_text').value = testimonial.testimonial_text;
        document.getElementById('testimonial_display_order').value = testimonial.display_order;
        document.getElementById('testimonial_display').checked = testimonial.display_on_public;
    } else {
        document.getElementById('testimonialForm').reset();
        document.getElementById('testimonial_id').value = '';
    }

    modal.show();
}

async function editTestimonial(id) {
    try {
        const response = await fetch(`/api/admin/booking/testimonials/${id}`);
        const testimonial = await response.json();
        showTestimonialModal(testimonial);
    } catch (error) {
        console.error('Error loading testimonial:', error);
        alert('Failed to load testimonial details');
    }
}

async function saveTestimonial() {
    const id = document.getElementById('testimonial_id').value;
    const data = {
        patient_name: document.getElementById('testimonial_patient_name').value,
        rating: parseInt(document.getElementById('testimonial_rating').value),
        testimonial_text: document.getElementById('testimonial_text').value,
        display_order: parseInt(document.getElementById('testimonial_display_order').value),
        display_on_public: document.getElementById('testimonial_display').checked ? 1 : 0
    };

    try {
        const url = id ? `/api/admin/booking/testimonials/${id}` : '/api/admin/booking/testimonials';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('testimonialModal')).hide();
            loadTestimonials();
            alert('Testimonial saved successfully!');
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to save testimonial'));
        }
    } catch (error) {
        console.error('Error saving testimonial:', error);
        alert('Failed to save testimonial');
    }
}

async function deleteTestimonial(id) {
    if (!confirm('Are you sure you want to delete this testimonial?')) return;

    try {
        const response = await fetch(`/api/admin/booking/testimonials/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadTestimonials();
            alert('Testimonial deleted successfully!');
        } else {
            alert('Failed to delete testimonial');
        }
    } catch (error) {
        console.error('Error deleting testimonial:', error);
        alert('Failed to delete testimonial');
    }
}

// ============= GENERAL SETTINGS =============

async function loadGeneralSettings() {
    try {
        const response = await fetch('/api/admin/booking/settings');
        const settings = await response.json();

        // Populate form fields
        settings.forEach(setting => {
            const element = document.getElementById(setting.setting_key);
            if (element) {
                if (setting.setting_type === 'BOOLEAN') {
                    element.checked = setting.setting_value === 'true';
                } else {
                    element.value = setting.setting_value;
                }
            }
        });
    } catch (error) {
        console.error('Error loading settings:', error);
        alert('Failed to load settings');
    }
}

async function saveGeneralSettings() {
    const settings = [
        { key: 'welcome_message', type: 'TEXT' },
        { key: 'booking_instructions', type: 'TEXT' },
        { key: 'line_id', type: 'TEXT' },
        { key: 'whatsapp_number', type: 'TEXT' },
        { key: 'phone_number', type: 'TEXT' },
        { key: 'show_booking_count', type: 'BOOLEAN' },
        { key: 'show_remaining_slots', type: 'BOOLEAN' },
        { key: 'low_slots_threshold', type: 'NUMBER' },
        { key: 'cancellation_policy', type: 'TEXT' }
    ];

    const data = settings.map(s => {
        const element = document.getElementById(s.key);
        let value;

        if (s.type === 'BOOLEAN') {
            value = element.checked ? 'true' : 'false';
        } else {
            value = element.value;
        }

        return {
            setting_key: s.key,
            setting_value: value,
            setting_type: s.type
        };
    });

    try {
        const response = await fetch('/api/admin/booking/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: data })
        });

        if (response.ok) {
            alert('Settings saved successfully!');
        } else {
            alert('Failed to save settings');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Failed to save settings');
    }
}
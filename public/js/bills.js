// Bills Management - RehabPlus V8

// Utility function to get cookie
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Get auth token
const getToken = () => getCookie('authToken');

// Bills Manager
const BillsManager = {
    services: [],
    bills: [],
    currentBill: null,
    selectedPatient: null,
    billItems: [],
    currentPnCaseId: null,  // Store PN case ID for bill-PN linking
    pnBillItems: [],  // NEW: Separate items array for PN bill modal
    currentPNData: null,  // NEW: Store current PN case data

    async init() {
        // Set default date filters to this week
        this.setDefaultDateFilters();

        await this.loadClinics();
        await this.loadServices();
        await this.loadBills();
        this.setupEventListeners();
        this.setupPNBillListeners();  // NEW: Setup PN bill listeners

        // Check URL parameters for auto-opening bill creation from PN
        this.checkURLParameters();
    },

    // Get today's date in YYYY-MM-DD format (local timezone, not UTC)
    getTodayDate() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    // Format date to DD/MM/YYYY (Thai format)
    formatDate(dateString) {
        if (!dateString) return 'N/A';

        try {
            // Extract just the date part if it's an ISO string with time
            // "2025-11-16T17:00:00.000Z" -> "2025-11-16"
            let datePart = dateString;
            if (dateString.includes('T')) {
                datePart = dateString.split('T')[0];
            }

            // Parse as local date (YYYY-MM-DD format)
            const [year, month, day] = datePart.split('-');

            if (!year || !month || !day) return dateString;

            // Return in DD/MM/YYYY format
            return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        } catch (error) {
            console.error('Date formatting error:', error);
            return dateString;
        }
    },

    // Set default date filters to show this week
    setDefaultDateFilters() {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

        // Calculate start of week (Monday)
        const startOfWeek = new Date(today);
        const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);

        // Calculate end of week (Sunday)
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        // Format dates as YYYY-MM-DD
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Set the date inputs
        const dateFromInput = document.getElementById('filter-date-from');
        const dateToInput = document.getElementById('filter-date-to');

        if (dateFromInput) dateFromInput.value = formatDate(startOfWeek);
        if (dateToInput) dateToInput.value = formatDate(endOfWeek);

        console.log('Default date filters set to this week:', formatDate(startOfWeek), 'to', formatDate(endOfWeek));
    },

    // Check URL parameters to auto-open bill creation modal
    async checkURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const pnCaseId = urlParams.get('pn_case_id');
        const patientId = urlParams.get('patient_id');
        const clinicId = urlParams.get('clinic_id');
        const viewBillId = urlParams.get('view');

        // If pn_case_id present, open SIMPLIFIED PN bill creation modal
        if (pnCaseId && patientId && clinicId) {
            // Wait a bit for everything to load, then open modal
            setTimeout(async () => {
                await this.showPNBillModal(parseInt(pnCaseId));  // Use new simplified modal
                // Clean URL after opening modal
                window.history.replaceState({}, document.title, '/bills');
            }, 500);
        }

        // If view parameter present, open bill details
        if (viewBillId) {
            setTimeout(() => {
                this.viewBill(parseInt(viewBillId));
                // Clean URL after opening modal
                window.history.replaceState({}, document.title, '/bills');
            }, 500);
        }
    },

    async loadClinics() {
        try {
            const response = await fetch('/api/clinics', {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            if (!response.ok) throw new Error('Failed to load clinics');

            const clinics = await response.json();

            // Populate clinic dropdowns
            const clinicSelects = [document.getElementById('bill-clinic'), document.getElementById('filter-clinic')];
            clinicSelects.forEach(select => {
                if (!select) return;

                select.innerHTML = '<option value="">All Clinics</option>';
                clinics.forEach(clinic => {
                    const option = document.createElement('option');
                    option.value = clinic.id;
                    option.textContent = clinic.name;
                    select.appendChild(option);
                });

                // If user has a clinic_id, pre-select it for bill-clinic
                if (select.id === 'bill-clinic') {
                    const userClinicId = document.getElementById('user-clinic-id')?.value;
                    const userRole = document.getElementById('user-role')?.value;
                    if (userClinicId && (userRole === 'CLINIC' || userRole === 'PT')) {
                        select.value = userClinicId;
                        if (userRole === 'CLINIC') {
                            select.disabled = true; // Clinic users can only create bills for their own clinic
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Load clinics error:', error);
            this.showAlert('Failed to load clinics', 'danger');
        }
    },

    setupEventListeners() {
        // Create bill button
        document.getElementById('btn-create-bill')?.addEventListener('click', async () => await this.showCreateBillModal());

        // Search/filter - use frontend filtering (no API call needed)
        document.getElementById('btn-search-bills')?.addEventListener('click', () => this.applyFilters());
        document.getElementById('filter-bill-code')?.addEventListener('input', () => this.applyFilters());
        document.getElementById('filter-clinic')?.addEventListener('change', () => this.applyFilters());
        document.getElementById('filter-status')?.addEventListener('change', () => this.applyFilters());

        // Add item button
        document.getElementById('btn-add-bill-item')?.addEventListener('click', () => this.addBillItem());

        // Save bill button - Note: onclick handler set dynamically in showCreateBillModal() or editBill()
        // Don't use addEventListener here as it can't be easily removed/changed

        // Patient selection
        document.getElementById('bill-patient-search')?.addEventListener('input', (e) => this.searchPatients(e.target.value));

        // Recalculate totals when discount or tax changes
        document.getElementById('bill-discount')?.addEventListener('input', () => this.updateBillTotals());
        document.getElementById('bill-tax')?.addEventListener('input', () => this.updateBillTotals());

        // Reload services when clinic is selected (to get clinic-specific services)
        document.getElementById('bill-clinic')?.addEventListener('change', (e) => {
            const clinicId = e.target.value;
            if (clinicId) {
                this.loadServices(clinicId);
            }
        });
    },

    async loadServices(clinicId = null) {
        try {
            const params = new URLSearchParams();
            if (clinicId) {
                params.append('clinic_id', clinicId);
            }

            const response = await fetch(`/api/bills/services?${params}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            if (!response.ok) throw new Error('Failed to load services');

            this.services = await response.json();
            this.renderServiceOptions();
        } catch (error) {
            console.error('Load services error:', error);
            this.showAlert('Failed to load services', 'danger');
        }
    },

    renderServiceOptions() {
        const select = document.getElementById('bill-item-service');
        if (!select) return;

        select.innerHTML = '<option value="">Select Service</option>';
        this.services.forEach(service => {
            const option = document.createElement('option');
            option.value = service.id;
            // Use clinic-specific price if available, otherwise use default price
            const displayPrice = service.price || service.default_price;
            option.textContent = `${service.service_code} - ${service.service_name} (฿${displayPrice})`;
            option.dataset.price = displayPrice;
            option.dataset.name = service.service_name;
            select.appendChild(option);
        });
    },

    async loadBills(forceReload = false) {
        try {
            // Only fetch from API if bills haven't been loaded or forceReload is true
            if (!this.allBills || forceReload) {
                // Only send clinic_id filter to backend (for role-based filtering)
                const userClinicId = document.getElementById('user-clinic-id')?.value;
                const userRole = document.getElementById('user-role')?.value;
                const params = new URLSearchParams();

                // For CLINIC role, only load their clinic's bills
                if (userRole === 'CLINIC' && userClinicId) {
                    params.append('clinic_id', userClinicId);
                }

                // Add cache-busting timestamp to ensure fresh data
                if (forceReload) {
                    params.append('_t', Date.now());
                }

                const response = await fetch(`/api/bills?${params}`, {
                    headers: {
                        'Authorization': `Bearer ${getToken()}`,
                        'Cache-Control': 'no-cache'
                    }
                });

                if (!response.ok) throw new Error('Failed to load bills');

                this.allBills = await response.json();
            }

            // Apply frontend filters
            this.bills = this.filterBills();
            this.renderBillsTable();
        } catch (error) {
            console.error('Load bills error:', error);
            this.showAlert('Failed to load bills', 'danger');
        }
    },

    applyFilters() {
        // Apply filters without making API call
        this.bills = this.filterBills();
        this.renderBillsTable();
    },

    filterBills() {
        const billCode = document.getElementById('filter-bill-code')?.value?.trim().toLowerCase();
        const clinicId = document.getElementById('filter-clinic')?.value;
        const status = document.getElementById('filter-status')?.value;
        const dateFrom = document.getElementById('filter-date-from')?.value;
        const dateTo = document.getElementById('filter-date-to')?.value;

        return this.allBills.filter(bill => {
            // Bill code filter (partial match, case-insensitive)
            if (billCode && !bill.bill_code.toLowerCase().includes(billCode)) {
                return false;
            }

            // Clinic filter
            if (clinicId && bill.clinic_id != clinicId) {
                return false;
            }

            // Status filter
            if (status && bill.payment_status !== status) {
                return false;
            }

            // Date from filter - extract date part for comparison
            if (dateFrom) {
                const billDate = bill.bill_date ? bill.bill_date.split('T')[0] : '';
                if (billDate < dateFrom) {
                    return false;
                }
            }

            // Date to filter - extract date part for comparison
            if (dateTo) {
                const billDate = bill.bill_date ? bill.bill_date.split('T')[0] : '';
                if (billDate > dateTo) {
                    return false;
                }
            }

            return true;
        });
    },

    renderBillsTable() {
        const tbody = document.getElementById('bills-table-body');
        if (!tbody) return;

        const userRole = document.getElementById('user-role')?.value;

        if (this.bills.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">No bills found</td></tr>';
            return;
        }

        // Sort bills by ID in descending order (newest first)
        const sortedBills = [...this.bills].sort((a, b) => b.id - a.id);

        console.log('Rendering bills table. First bill date:', sortedBills[0]?.bill_date);

        tbody.innerHTML = sortedBills.map(bill => {
            // Role-based action buttons
            let actions = '';

            // Payment status dropdown - PT and ADMIN can update
            const statusOptions = [
                { value: 'UNPAID', label: 'Unpaid', class: 'danger' },
                { value: 'PAID', label: 'Paid', class: 'success' },
                { value: 'PARTIAL', label: 'Partial', class: 'warning' },
                { value: 'CANCELLED', label: 'Cancelled', class: 'secondary' }
            ];

            // View Details button - All roles can view
            actions += `
                <button class="btn btn-sm btn-info me-1" onclick="BillsManager.viewBill(${bill.id})" title="View Details">
                    <i class="bi bi-eye"></i>
                </button>
            `;

            // Print button - All roles can print
            actions += `
                <button class="btn btn-sm btn-secondary me-1" onclick="BillsManager.printBill(${bill.id})" title="Print Bill">
                    <i class="bi bi-printer"></i>
                </button>
            `;

            // Payment status dropdown - All roles can update
            actions += `
                <select class="form-select form-select-sm d-inline-block w-auto me-1"
                        onchange="BillsManager.updatePaymentStatus(${bill.id}, this.value)"
                        style="font-size: 0.875rem;">
                    ${statusOptions.map(opt => `
                        <option value="${opt.value}" ${bill.payment_status === opt.value ? 'selected' : ''}>
                            ${opt.label}
                        </option>
                    `).join('')}
                </select>
            `;

            // ADMIN gets Edit and Delete buttons
            if (userRole === 'ADMIN') {
                actions += `
                    <button class="btn btn-sm btn-warning me-1" onclick="BillsManager.editBill(${bill.id})" title="Edit Bill">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="BillsManager.deleteBill(${bill.id}, '${bill.bill_code}')" title="Delete Bill">
                        <i class="bi bi-trash"></i>
                    </button>
                `;
            }

            return `
                <tr>
                    <td>${bill.bill_code}</td>
                    <td>${bill.patient_name || bill.walk_in_name || 'N/A'}</td>
                    <td>${bill.clinic_name}</td>
                    <td>${this.formatDate(bill.bill_date)}</td>
                    <td class="text-right">฿${parseFloat(bill.total_amount).toFixed(2)}</td>
                    <td>
                        <span class="badge badge-${this.getStatusBadgeClass(bill.payment_status)}">
                            ${bill.payment_status}
                        </span>
                    </td>
                    <td>${actions}</td>
                </tr>
            `;
        }).join('');
    },

    getStatusBadgeClass(status) {
        const classes = {
            'PAID': 'success',
            'UNPAID': 'danger',
            'PARTIAL': 'warning',
            'CANCELLED': 'secondary'
        };
        return classes[status] || 'secondary';
    },

    async showCreateBillModal(pnCaseId = null, patientId = null, clinicId = null) {
        this.billItems = [];
        this.selectedPatient = null;
        this.currentPnCaseId = pnCaseId;  // NEW: Store PN case ID if provided

        // Reset form
        document.getElementById('bill-patient-id').value = '';
        document.getElementById('bill-patient-name').value = '';
        document.getElementById('bill-walk-in-name').value = '';
        document.getElementById('bill-walk-in-phone').value = '';
        document.getElementById('bill-date').value = this.getTodayDate();
        document.getElementById('bill-discount').value = '0';
        document.getElementById('bill-tax').value = '0';
        document.getElementById('bill-notes').value = '';
        document.getElementById('bill-items-container').innerHTML = '';
        document.getElementById('patient-courses-info').innerHTML = '';
        document.getElementById('bill-payment-method').value = '';

        // NEW: Load patient data FIRST if creating bill from PN case
        if (pnCaseId && patientId) {
            await this.loadPatientAndPNForBill(pnCaseId, patientId);
        }

        // Set clinic selection based on user role or provided clinicId
        const clinicSelect = document.getElementById('bill-clinic');
        const userClinicId = document.getElementById('user-clinic-id')?.value;
        const userRole = document.getElementById('user-role')?.value;

        if (clinicSelect) {
            // NEW: If clinic provided (from PN), use it
            if (clinicId) {
                clinicSelect.value = clinicId;
                this.loadServices(clinicId);
            } else if (userClinicId && (userRole === 'CLINIC' || userRole === 'PT')) {
                // Pre-select user's clinic for PT/CLINIC users
                clinicSelect.value = userClinicId;
                if (userRole === 'CLINIC') {
                    clinicSelect.disabled = true; // CLINIC users can only bill for their clinic
                }
                // Load services for this clinic
                this.loadServices(userClinicId);
            } else {
                // Reset for ADMIN users
                clinicSelect.value = '';
                clinicSelect.disabled = false;
                // Clear services until clinic is selected
                this.services = [];
                this.renderServiceOptions();
            }
        }

        this.updateBillTotals();

        // Reset save button to create mode (in case it was in edit mode)
        const saveBtn = document.getElementById('btn-save-bill');
        if (saveBtn) {
            saveBtn.textContent = 'Save Bill';
            saveBtn.onclick = () => this.saveBill();
        }

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('createBillModal'));
        modal.show();

        // Add focus management for accessibility
        if (window.A11y && window.A11y.manageFocusForModal) {
            window.A11y.manageFocusForModal(document.getElementById('createBillModal'), document.activeElement);
        }
    },

    // NEW: Load patient AND PN information for bill creation
    async loadPatientAndPNForBill(pnCaseId, patientId) {
        try {
            // Load patient info
            const patientResponse = await fetch(`/api/patients/${patientId}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            if (!patientResponse.ok) throw new Error('Failed to load patient');
            const patient = await patientResponse.json();

            // Load PN info
            const pnResponse = await fetch(`/api/pn/${pnCaseId}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            if (!pnResponse.ok) throw new Error('Failed to load PN case');
            const pnCase = await pnResponse.json();

            // Fill patient info
            this.selectPatient(patient.id, `${patient.first_name} ${patient.last_name}`);

            // Show PN connection info
            const pnInfoHtml = `
                <div class="alert alert-success mb-3" style="border-left: 4px solid #28a745;">
                    <h6><i class="bi bi-link-45deg me-2"></i>Creating Bill for PN Case</h6>
                    <p class="mb-1"><strong>PN Code:</strong> ${pnCase.pn_code || 'N/A'}</p>
                    <p class="mb-1"><strong>Diagnosis:</strong> ${pnCase.diagnosis || 'N/A'}</p>
                    <p class="mb-1"><strong>Purpose:</strong> ${pnCase.purpose || 'N/A'}</p>
                    <p class="mb-0"><strong>Patient:</strong> ${patient.first_name} ${patient.last_name} (HN: ${patient.hn || 'N/A'})</p>
                    <small class="text-muted">This bill will be linked to the PN case above.</small>
                </div>
            `;

            const coursesInfo = document.getElementById('patient-courses-info');
            if (coursesInfo) {
                coursesInfo.innerHTML = pnInfoHtml;
            }

        } catch (error) {
            console.error('Load patient/PN error:', error);
            this.showAlert('Failed to load patient or PN information', 'warning');
        }
    },

    async searchPatients(query) {
        if (query.length < 2) return;

        try {
            const response = await fetch(`/api/patients/search?q=${encodeURIComponent(query)}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            const patients = await response.json();
            this.renderPatientSearchResults(patients);
        } catch (error) {
            console.error('Patient search error:', error);
        }
    },

    renderPatientSearchResults(patients) {
        const container = document.getElementById('patient-search-results');
        if (!container) return;

        if (patients.length === 0) {
            container.innerHTML = '<div class="list-group-item">No patients found</div>';
            return;
        }

        container.innerHTML = patients.map(p => `
            <button type="button" class="list-group-item list-group-item-action"
                    onclick="BillsManager.selectPatient(${p.id}, '${p.first_name} ${p.last_name}')">
                ${p.first_name} ${p.last_name} - ${p.patient_number}
            </button>
        `).join('');
    },

    selectPatient(patientId, patientName) {
        this.selectedPatient = { id: patientId, name: patientName };
        document.getElementById('bill-patient-id').value = patientId;
        document.getElementById('bill-patient-name').value = patientName;
        document.getElementById('patient-search-results').innerHTML = '';
        document.getElementById('bill-patient-search').value = '';

        // Clear courses info (not used - course cutting handled separately)
        const coursesInfo = document.getElementById('patient-courses-info');
        if (coursesInfo) coursesInfo.innerHTML = '';
    },

    addBillItem() {
        const serviceSelect = document.getElementById('bill-item-service');
        const quantityInput = document.getElementById('bill-item-quantity');
        const discountInput = document.getElementById('bill-item-discount');

        const serviceId = serviceSelect.value;
        const serviceName = serviceSelect.options[serviceSelect.selectedIndex]?.dataset.name || '';
        const unitPrice = parseFloat(serviceSelect.options[serviceSelect.selectedIndex]?.dataset.price || 0);
        const quantity = parseInt(quantityInput.value) || 1;
        const discount = parseFloat(discountInput.value) || 0;

        if (!serviceId) {
            this.showAlert('Please select a service', 'warning');
            return;
        }

        const item = {
            service_id: parseInt(serviceId),
            service_name: serviceName,
            quantity,
            unit_price: unitPrice,
            discount,
            total_price: (quantity * unitPrice) - discount,
            notes: null  // Explicitly set notes to null
        };

        this.billItems.push(item);
        this.renderBillItems();
        this.updateBillTotals();

        // Reset inputs
        serviceSelect.value = '';
        quantityInput.value = '1';
        discountInput.value = '0';
    },

    renderBillItems() {
        const container = document.getElementById('bill-items-container');
        if (!container) return;

        if (this.billItems.length === 0) {
            container.innerHTML = '<p class="text-muted">No items added</p>';
            return;
        }

        container.innerHTML = `
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th>Service</th>
                        <th>Qty</th>
                        <th>Price</th>
                        <th>Discount</th>
                        <th>Total</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${this.billItems.map((item, index) => `
                        <tr>
                            <td>${item.service_name}</td>
                            <td>${item.quantity}</td>
                            <td>฿${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                            <td>฿${parseFloat(item.discount || 0).toFixed(2)}</td>
                            <td>฿${parseFloat(item.total_price || 0).toFixed(2)}</td>
                            <td>
                                <button type="button" class="btn btn-sm btn-danger"
                                        onclick="BillsManager.removeBillItem(${index})">
                                    <i class="fas fa-times"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },

    removeBillItem(index) {
        this.billItems.splice(index, 1);
        this.renderBillItems();
        this.updateBillTotals();
    },

    updateBillTotals() {
        const subtotal = this.billItems.reduce((sum, item) => sum + item.total_price, 0);
        const discount = parseFloat(document.getElementById('bill-discount')?.value || 0);
        const tax = parseFloat(document.getElementById('bill-tax')?.value || 0);
        const total = subtotal - discount + tax;

        document.getElementById('bill-subtotal').textContent = `฿${subtotal.toFixed(2)}`;
        document.getElementById('bill-total').textContent = `฿${total.toFixed(2)}`;
    },

    async saveBill() {
        if (this.billItems.length === 0) {
            this.showAlert('Please add at least one item', 'warning');
            return;
        }

        const patientId = document.getElementById('bill-patient-id').value;
        const walkInName = document.getElementById('bill-walk-in-name').value;
        const walkInPhone = document.getElementById('bill-walk-in-phone').value;

        if (!patientId && !walkInName) {
            this.showAlert('Please select a patient or enter walk-in details', 'warning');
            return;
        }

        const clinicIdValue = document.getElementById('bill-clinic')?.value;
        const paymentMethodValue = document.getElementById('bill-payment-method')?.value;
        const billNotesValue = document.getElementById('bill-notes')?.value;
        const billDateValue = document.getElementById('bill-date')?.value;

        if (!clinicIdValue) {
            this.showAlert('Please select a clinic', 'warning');
            return;
        }

        const billData = {
            patient_id: patientId || null,
            walk_in_name: walkInName || null,
            walk_in_phone: walkInPhone || null,
            clinic_id: parseInt(clinicIdValue),
            bill_date: billDateValue || this.getTodayDate(),
            items: this.billItems,
            discount: parseFloat(document.getElementById('bill-discount')?.value) || 0,
            tax: parseFloat(document.getElementById('bill-tax')?.value) || 0,
            bill_notes: billNotesValue || null,
            payment_method: paymentMethodValue || null,
            payment_notes: null,
            appointment_id: null,
            pn_case_id: this.currentPnCaseId || null  // NEW: Include PN case ID if present
            // Note: Course cutting is handled separately through Appointments/PN Cases
            // Bills are for standard service payments only
        };

        try {
            const response = await fetch('/api/bills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getToken()}`
                },
                body: JSON.stringify(billData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create bill');
            }

            const result = await response.json();
            this.showAlert(`Bill ${result.bill_code} created successfully!`, 'success');
            const modalEl = document.getElementById('createBillModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
            this.loadBills(true);  // Force reload from API to get new bill
        } catch (error) {
            console.error('Save bill error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async viewBill(billId) {
        try {
            const response = await fetch(`/api/bills/${billId}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            if (!response.ok) throw new Error('Failed to load bill');

            const bill = await response.json();
            this.currentBill = bill;
            this.showBillDetails(bill);
        } catch (error) {
            console.error('View bill error:', error);
            this.showAlert('Failed to load bill details', 'danger');
        }
    },

    showBillDetails(bill) {
        // Ensure items is an array
        const items = Array.isArray(bill.items) ? bill.items : [];

        const detailsHtml = `
            <div class="bill-details">
                <h5>Bill: ${bill.bill_code || 'N/A'}</h5>
                ${bill.pn_number ? `
                    <div class="alert alert-info mb-3">
                        <i class="bi bi-link-45deg me-2"></i>
                        <strong>Connected to PN:</strong> ${bill.pn_number}
                        <br><small>Purpose: ${bill.pn_purpose || 'N/A'}</small>
                        <br><small>Status: ${bill.pn_status || 'N/A'}</small>
                    </div>
                ` : ''}
                <p><strong>Patient:</strong> ${bill.patient_name || bill.walk_in_name || 'N/A'}</p>
                <p><strong>Clinic:</strong> ${bill.clinic_name || 'N/A'}</p>
                <p><strong>Date:</strong> ${this.formatDate(bill.bill_date)}</p>
                <p><strong>Status:</strong> <span class="badge badge-${this.getStatusBadgeClass(bill.payment_status)}">${bill.payment_status || 'UNPAID'}</span></p>

                <h6>Items:</h6>
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Service</th>
                            <th>Qty</th>
                            <th>Price</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.length > 0 ? items.map(item => `
                            <tr>
                                <td>${item.service_name || 'N/A'}</td>
                                <td>${item.quantity || 0}</td>
                                <td>฿${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                                <td>฿${parseFloat(item.total_price || 0).toFixed(2)}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="4" class="text-center">No items</td></tr>'}
                    </tbody>
                </table>

                <div class="text-end">
                    <p><strong>Subtotal:</strong> ฿${parseFloat(bill.subtotal || 0).toFixed(2)}</p>
                    <p><strong>Discount:</strong> ฿${parseFloat(bill.discount || 0).toFixed(2)}</p>
                    <p><strong>Tax:</strong> ฿${parseFloat(bill.tax || 0).toFixed(2)}</p>
                    <h5><strong>Total:</strong> ฿${parseFloat(bill.total_amount || 0).toFixed(2)}</h5>
                </div>
            </div>
        `;

        document.getElementById('bill-details-content').innerHTML = detailsHtml;
        const modal = new bootstrap.Modal(document.getElementById('viewBillModal'));
        modal.show();

        // Add focus management for accessibility
        if (window.A11y && window.A11y.manageFocusForModal) {
            window.A11y.manageFocusForModal(document.getElementById('viewBillModal'), document.activeElement);
        }
    },

    showAlert(message, type = 'info') {
        const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="close" data-dismiss="alert">
                    <span>&times;</span>
                </button>
            </div>
        `;

        const container = document.getElementById('alerts-container') || document.body;
        const div = document.createElement('div');
        div.innerHTML = alertHtml;
        const alertElement = div.firstElementChild;
        container.insertBefore(alertElement, container.firstChild);

        setTimeout(() => {
            alertElement?.remove();
        }, 3000);  // Auto-dismiss after 3 seconds
    },

    async updatePaymentStatus(billId, newStatus) {
        try {
            const response = await fetch(`/api/bills/${billId}/payment-status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getToken()}`
                },
                body: JSON.stringify({ payment_status: newStatus })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update payment status');
            }

            // Wait for bills to reload before showing success
            await this.loadBills(true);  // Reload bills to show updated status
            this.showAlert(`Payment status updated to ${newStatus}`, 'success');
        } catch (error) {
            console.error('Update payment status error:', error);
            this.showAlert(error.message, 'danger');
            this.loadBills(true);  // Reload to revert dropdown
        }
    },

    async editBill(billId) {
        try {
            // Load bill details
            const response = await fetch(`/api/bills/${billId}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            if (!response.ok) throw new Error('Failed to load bill');

            const bill = await response.json();

            // Populate edit modal (reuse create modal)
            this.currentBill = bill;
            // Convert database string values to numbers
            this.billItems = (bill.items || []).map(item => ({
                ...item,
                quantity: parseInt(item.quantity) || 0,
                unit_price: parseFloat(item.unit_price) || 0,
                discount: parseFloat(item.discount) || 0,
                total_price: parseFloat(item.total_price) || 0
            }));

            // Clear all fields first
            document.getElementById('bill-patient-id').value = '';
            document.getElementById('bill-patient-name').value = '';
            document.getElementById('bill-walk-in-name').value = '';
            document.getElementById('bill-walk-in-phone').value = '';
            document.getElementById('patient-search-results').innerHTML = '';

            // Set form values based on bill type
            if (bill.patient_id) {
                document.getElementById('bill-patient-id').value = bill.patient_id || '';
                document.getElementById('bill-patient-name').value = bill.patient_name || '';
            } else {
                document.getElementById('bill-walk-in-name').value = bill.walk_in_name || '';
                document.getElementById('bill-walk-in-phone').value = bill.walk_in_phone || '';
            }

            // Ensure clinic dropdown is populated before setting value
            if (!document.getElementById('bill-clinic').options.length ||
                document.getElementById('bill-clinic').options.length <= 1) {
                await this.loadClinics();
            }

            document.getElementById('bill-clinic').value = bill.clinic_id || '';
            // Extract date part (YYYY-MM-DD) from ISO timestamp for date input
            const billDate = bill.bill_date ? bill.bill_date.split('T')[0] : '';
            document.getElementById('bill-date').value = billDate;
            document.getElementById('bill-payment-method').value = bill.payment_method || '';
            document.getElementById('bill-notes').value = bill.bill_notes || '';
            document.getElementById('bill-discount').value = bill.discount || 0;
            document.getElementById('bill-tax').value = bill.tax || 0;

            // Load services for this clinic
            await this.loadServices(bill.clinic_id);

            // Render existing bill items
            this.renderBillItems();
            this.updateBillTotals();

            // Change save button to update mode
            const saveBtn = document.getElementById('btn-save-bill');
            saveBtn.textContent = 'Update Bill';
            saveBtn.onclick = () => this.updateBill(billId);

            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('createBillModal'));
            modal.show();

            // Add focus management for accessibility
            if (window.A11y && window.A11y.manageFocusForModal) {
                window.A11y.manageFocusForModal(document.getElementById('createBillModal'), document.activeElement);
            }
        } catch (error) {
            console.error('Edit bill error:', error);
            this.showAlert('Failed to load bill for editing: ' + error.message, 'danger');
        }
    },

    async updateBill(billId) {
        if (this.billItems.length === 0) {
            this.showAlert('Please add at least one item', 'warning');
            return;
        }

        const patientId = document.getElementById('bill-patient-id').value;
        const walkInName = document.getElementById('bill-walk-in-name').value;
        const walkInPhone = document.getElementById('bill-walk-in-phone').value;

        if (!patientId && !walkInName) {
            this.showAlert('Please select a patient or enter walk-in details', 'warning');
            return;
        }

        const clinicIdValue = document.getElementById('bill-clinic')?.value;
        if (!clinicIdValue) {
            this.showAlert('Please select a clinic', 'warning');
            return;
        }

        const billDateValue = document.getElementById('bill-date')?.value || this.getTodayDate();

        const billData = {
            patient_id: patientId || null,
            walk_in_name: walkInName || null,
            walk_in_phone: walkInPhone || null,
            clinic_id: parseInt(clinicIdValue),
            bill_date: billDateValue,
            items: this.billItems,
            discount: parseFloat(document.getElementById('bill-discount')?.value) || 0,
            tax: parseFloat(document.getElementById('bill-tax')?.value) || 0,
            bill_notes: document.getElementById('bill-notes')?.value || null,
            payment_method: document.getElementById('bill-payment-method')?.value || null,
            payment_status: this.currentBill.payment_status || 'UNPAID'
        };

        console.log('Updating bill with date:', billDateValue);
        console.log('Full bill data:', billData);

        try {
            const response = await fetch(`/api/bills/${billId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getToken()}`
                },
                body: JSON.stringify(billData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update bill');
            }

            const result = await response.json();
            console.log('Bill update response:', result);

            this.showAlert('Bill updated successfully!', 'success');
            const modalEl = document.getElementById('createBillModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            // Reset save button
            const saveBtn = document.getElementById('btn-save-bill');
            saveBtn.textContent = 'Save Bill';
            saveBtn.onclick = () => this.saveBill();

            // Force reload bills from server with fresh data
            await this.loadBills(true);
            console.log('Bills reloaded after update. Total bills:', this.bills.length);
        } catch (error) {
            console.error('Update bill error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async deleteBill(billId, billCode) {
        if (!confirm(`Are you sure you want to delete bill ${billCode}? This action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/bills/${billId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete bill');
            }

            this.showAlert(`Bill ${billCode} deleted successfully!`, 'success');
            this.loadBills(true);
        } catch (error) {
            console.error('Delete bill error:', error);
            this.showAlert(error.message, 'danger');
        }
    },

    async printBill(billId) {
        try {
            // Use centralized document rendering system
            // Simply open the document template with bill ID
            window.open(`/documents/render/bill/${billId}`, '_blank');
        } catch (error) {
            console.error('Print bill error:', error);
            this.showAlert('Failed to open bill for printing', 'danger');
        }
    },

    // ========================================
    // NEW: Simplified PN Bill Creation Functions
    // ========================================

    setupPNBillListeners() {
        // Add service button
        document.getElementById('btn-add-pn-bill-item')?.addEventListener('click', () => this.addPNBillItem());

        // Save bill button
        document.getElementById('btn-save-pn-bill')?.addEventListener('click', () => this.savePNBill());
    },

    async showPNBillModal(pnCaseId) {
        try {
            // Reset items
            this.pnBillItems = [];

            // Load PN case data
            const pnResponse = await fetch(`/api/pn/${pnCaseId}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });

            if (!pnResponse.ok) throw new Error('Failed to load PN case');
            const pnCase = await pnResponse.json();

            // Store PN data
            this.currentPNData = pnCase;

            // Fill PN information (read-only display)
            document.getElementById('pn-bill-pn-code').textContent = pnCase.pn_code || 'N/A';
            document.getElementById('pn-bill-patient-name').textContent = `${pnCase.first_name} ${pnCase.last_name}`;
            document.getElementById('pn-bill-patient-hn').textContent = pnCase.hn || 'N/A';
            document.getElementById('pn-bill-diagnosis').textContent = pnCase.diagnosis || 'N/A';
            document.getElementById('pn-bill-purpose').textContent = pnCase.purpose || 'N/A';
            document.getElementById('pn-bill-clinic-name').textContent = pnCase.source_clinic_name || 'N/A';

            // Fill hidden fields
            document.getElementById('pn-bill-pn-id').value = pnCase.id;
            document.getElementById('pn-bill-patient-id').value = pnCase.patient_id;
            document.getElementById('pn-bill-clinic-id').value = pnCase.source_clinic_id;

            // Load services for this clinic
            await this.loadServices(pnCase.source_clinic_id);

            // Populate service dropdown
            const serviceSelect = document.getElementById('pn-bill-service');
            serviceSelect.innerHTML = '<option value="">Select Service</option>';
            this.services.forEach(service => {
                const option = document.createElement('option');
                option.value = service.id;
                const displayPrice = service.price || service.default_price;
                option.textContent = `${service.service_code} - ${service.service_name} (฿${displayPrice})`;
                option.dataset.price = displayPrice;
                option.dataset.name = service.service_name;
                serviceSelect.appendChild(option);
            });

            // Reset form fields
            document.getElementById('pn-bill-quantity').value = '1';
            document.getElementById('pn-bill-item-discount').value = '0';
            document.getElementById('pn-bill-payment-method').value = '';
            document.getElementById('pn-bill-notes').value = '';

            // Reset items display
            this.renderPNBillItems();
            this.updatePNBillTotals();

            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('createPNBillModal'));
            modal.show();

            // Add focus management for accessibility
            if (window.A11y && window.A11y.manageFocusForModal) {
                window.A11y.manageFocusForModal(document.getElementById('createPNBillModal'), document.activeElement);
            }

        } catch (error) {
            console.error('Load PN data error:', error);
            this.showAlert('Failed to load PN case information', 'danger');
        }
    },

    addPNBillItem() {
        const serviceSelect = document.getElementById('pn-bill-service');
        const quantityInput = document.getElementById('pn-bill-quantity');
        const discountInput = document.getElementById('pn-bill-item-discount');

        const serviceId = serviceSelect.value;
        const serviceName = serviceSelect.options[serviceSelect.selectedIndex]?.dataset.name || '';
        const unitPrice = parseFloat(serviceSelect.options[serviceSelect.selectedIndex]?.dataset.price || 0);
        const quantity = parseInt(quantityInput.value) || 1;
        const discount = parseFloat(discountInput.value) || 0;

        if (!serviceId) {
            this.showAlert('Please select a service', 'warning');
            return;
        }

        const item = {
            service_id: parseInt(serviceId),
            service_name: serviceName,
            quantity,
            unit_price: unitPrice,
            discount,
            total_price: (quantity * unitPrice) - discount,
            notes: null
        };

        this.pnBillItems.push(item);
        this.renderPNBillItems();
        this.updatePNBillTotals();

        // Reset inputs
        serviceSelect.value = '';
        quantityInput.value = '1';
        discountInput.value = '0';
    },

    renderPNBillItems() {
        const container = document.getElementById('pn-bill-items-container');
        if (!container) return;

        if (this.pnBillItems.length === 0) {
            container.innerHTML = '<p class="text-muted text-center py-3">No services added yet</p>';
            return;
        }

        container.innerHTML = `
            <table class="table table-sm table-hover">
                <thead class="table-light">
                    <tr>
                        <th>Service</th>
                        <th class="text-center">Qty</th>
                        <th class="text-end">Price</th>
                        <th class="text-end">Discount</th>
                        <th class="text-end">Total</th>
                        <th class="text-center" width="80">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.pnBillItems.map((item, index) => `
                        <tr>
                            <td>${item.service_name}</td>
                            <td class="text-center">${item.quantity}</td>
                            <td class="text-end">฿${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                            <td class="text-end">฿${parseFloat(item.discount || 0).toFixed(2)}</td>
                            <td class="text-end"><strong>฿${parseFloat(item.total_price || 0).toFixed(2)}</strong></td>
                            <td class="text-center">
                                <button type="button" class="btn btn-sm btn-danger" onclick="BillsManager.removePNBillItem(${index})">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },

    removePNBillItem(index) {
        this.pnBillItems.splice(index, 1);
        this.renderPNBillItems();
        this.updatePNBillTotals();
    },

    updatePNBillTotals() {
        const subtotal = this.pnBillItems.reduce((sum, item) => sum + item.total_price, 0);

        document.getElementById('pn-bill-subtotal').textContent = `฿${subtotal.toFixed(2)}`;
        document.getElementById('pn-bill-total').textContent = `฿${subtotal.toFixed(2)}`;
    },

    async savePNBill() {
        if (this.pnBillItems.length === 0) {
            this.showAlert('Please add at least one service', 'warning');
            return;
        }

        const pnId = parseInt(document.getElementById('pn-bill-pn-id').value);
        const patientId = parseInt(document.getElementById('pn-bill-patient-id').value);
        const clinicId = parseInt(document.getElementById('pn-bill-clinic-id').value);
        const paymentMethod = document.getElementById('pn-bill-payment-method').value;
        const notes = document.getElementById('pn-bill-notes').value;

        const billData = {
            patient_id: patientId,
            walk_in_name: null,
            walk_in_phone: null,
            clinic_id: clinicId,
            bill_date: this.getTodayDate(),
            items: this.pnBillItems,
            discount: 0,
            tax: 0,
            bill_notes: notes || null,
            payment_method: paymentMethod || null,
            payment_notes: null,
            appointment_id: null,
            pn_case_id: pnId  // Link to PN case
        };

        try {
            const response = await fetch('/api/bills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getToken()}`
                },
                body: JSON.stringify(billData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create bill');
            }

            const result = await response.json();
            this.showAlert(`Bill ${result.bill_code} created successfully and linked to PN!`, 'success');

            // Close modal
            const modalEl = document.getElementById('createPNBillModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            // Reload bills table
            this.loadBills(true);

        } catch (error) {
            console.error('Save PN bill error:', error);
            this.showAlert(error.message, 'danger');
        }
    }
};

// CSV Import/Export functionality
const CSVHandler = {
    exportTemplate() {
        window.location.href = '/api/bills/export/template';
    },

    showImportModal() {
        const modal = new bootstrap.Modal(document.getElementById('importBillsModal'));
        modal.show();

        // Reset file input
        document.getElementById('import-file').value = '';
        document.getElementById('btn-upload-csv').disabled = true;
        document.getElementById('import-preview').style.display = 'none';
        document.getElementById('import-results').style.display = 'none';
    },

    parseCSV(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV file is empty or invalid');
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const data = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values.length !== headers.length) {
                console.warn(`Row ${i + 1} has ${values.length} columns, expected ${headers.length}`);
                continue;
            }

            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index].trim();
            });

            // Skip empty rows
            if (Object.values(row).every(val => !val)) {
                continue;
            }

            data.push(row);
        }

        return data;
    },

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = this.parseCSV(text);

            console.log('Parsed CSV data:', data);

            // Show preview
            const previewContent = document.getElementById('import-preview-content');
            previewContent.innerHTML = `
                <div class="alert alert-success">
                    <i class="bi bi-check-circle me-2"></i>
                    <strong>${data.length} rows</strong> ready to import
                </div>
                <small>First row: ${JSON.stringify(data[0], null, 2)}</small>
            `;
            document.getElementById('import-preview').style.display = 'block';

            // Enable upload button and store data
            document.getElementById('btn-upload-csv').disabled = false;
            document.getElementById('btn-upload-csv').dataset.csvData = JSON.stringify(data);

        } catch (error) {
            console.error('CSV parse error:', error);
            BillsManager.showAlert('Failed to parse CSV file: ' + error.message, 'danger');
        }
    },

    async uploadCSV() {
        const button = document.getElementById('btn-upload-csv');
        const csvData = JSON.parse(button.dataset.csvData || '[]');

        if (csvData.length === 0) {
            BillsManager.showAlert('No data to import', 'warning');
            return;
        }

        try {
            button.disabled = true;
            button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Importing...';

            const response = await fetch('/api/bills/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getToken()}`
                },
                body: JSON.stringify({ csvData })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Import failed');
            }

            // Show results
            const resultsDiv = document.getElementById('import-results');
            let resultsHTML = `
                <div class="alert alert-${result.success > 0 ? 'success' : 'warning'}">
                    <h6><i class="bi bi-info-circle me-2"></i>Import Results</h6>
                    <ul>
                        <li><strong>${result.success}</strong> bills imported successfully</li>
                        <li><strong>${result.failed}</strong> bills failed</li>
                    </ul>
                </div>
            `;

            if (result.errors && result.errors.length > 0) {
                resultsHTML += '<div class="alert alert-danger"><h6>Errors:</h6><ul>';
                result.errors.forEach(err => {
                    resultsHTML += `<li>Row ${err.row}: ${err.error}</li>`;
                });
                resultsHTML += '</ul></div>';
            }

            resultsDiv.innerHTML = resultsHTML;
            resultsDiv.style.display = 'block';

            // Reload bills table if any succeeded
            if (result.success > 0) {
                setTimeout(() => {
                    bootstrap.Modal.getInstance(document.getElementById('importBillsModal')).hide();
                    BillsManager.loadBills(true);
                }, 3000);
            }

        } catch (error) {
            console.error('Upload CSV error:', error);
            BillsManager.showAlert('Failed to import bills: ' + error.message, 'danger');
        } finally {
            button.disabled = false;
            button.innerHTML = '<i class="bi bi-upload me-2"></i>Upload & Import';
        }
    }
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    BillsManager.init();

    // Attach CSV handlers
    document.getElementById('btn-export-template')?.addEventListener('click', () => {
        CSVHandler.exportTemplate();
    });

    document.getElementById('btn-import-bills')?.addEventListener('click', () => {
        CSVHandler.showImportModal();
    });

    document.getElementById('import-file')?.addEventListener('change', (e) => {
        CSVHandler.handleFileSelect(e);
    });

    document.getElementById('btn-upload-csv')?.addEventListener('click', () => {
        CSVHandler.uploadCSV();
    });
});

// NEW: Global function for creating bills from PN cases
// This is called from PN creation success handlers
window.createBillForPN = function(pnCaseId, patientId, clinicId) {
    if (typeof BillsManager !== 'undefined') {
        // If on bills page, open modal directly
        BillsManager.showCreateBillModal(pnCaseId, patientId, clinicId);
    } else {
        // If on different page, redirect to bills page with parameters
        window.location.href = `/bills?create=true&pn_case_id=${pnCaseId}&patient_id=${patientId}&clinic_id=${clinicId}`;
    }
};
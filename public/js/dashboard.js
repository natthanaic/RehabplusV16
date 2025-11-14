// Dashboard JavaScript - PN-App System

let currentPage = 1;
let currentFilters = {};

// Broadcast channel for instant cross-tab communication
let dashboardChannel = null;

// HTML escaping to prevent XSS attacks
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) {
        return '';
    }
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeDatePickers();
    loadClinics();
    loadCases(); // Load cases without date filter (frontend filtering handles it)
    loadDashboardSummary();  // Load summary statistics
    loadWalkInAppointments(); // Load walk-in appointments table

    // Set up event listeners
    document.getElementById('filter-clinic').addEventListener('change', () => {
        loadCases();
        loadWalkInAppointments(); // Reload walk-in table with same filters
    });
    document.getElementById('filter-status').addEventListener('change', loadCases);
    document.getElementById('filter-from').addEventListener('change', () => {
        loadCases();
        loadWalkInAppointments(); // Reload walk-in table with same filters
    });
    document.getElementById('filter-to').addEventListener('change', () => {
        loadCases();
        loadWalkInAppointments(); // Reload walk-in table with same filters
    });
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadCases();
    });

    // Initialize BroadcastChannel for instant cross-tab sync
    if ('BroadcastChannel' in window) {
        dashboardChannel = new BroadcastChannel('pn-app-sync');
        dashboardChannel.onmessage = (event) => {
            console.log('Dashboard received sync message:', event.data);
            if (event.data.type === 'pn-status-changed' || event.data.type === 'appointment-updated') {
                // Instantly reload dashboard data
                loadCases();
                loadDashboardSummary();
                loadWalkInAppointments();
            }
        };
        console.log('Dashboard: BroadcastChannel initialized for instant sync');
    } else {
        // Fallback: Use localStorage for older browsers
        window.addEventListener('storage', (e) => {
            if (e.key === 'pn-sync-trigger') {
                console.log('Dashboard received localStorage sync trigger');
                loadCases();
                loadDashboardSummary();
                loadWalkInAppointments();
            }
        });
        console.log('Dashboard: localStorage fallback initialized for instant sync');
    }

    // Keep 10-second auto-refresh as backup (in case user doesn't have dashboard open when change happens)
    setInterval(() => {
        loadCases();
        loadDashboardSummary();
        loadWalkInAppointments();
    }, 10000); // 10 seconds
});

// Initialize date pickers
function initializeDatePickers() {
    flatpickr('#filter-from', {
        dateFormat: 'Y-m-d',
        onChange: () => loadCases()
    });

    flatpickr('#filter-to', {
        dateFormat: 'Y-m-d',
        onChange: () => loadCases()
    });
}

// NEW: Load dashboard summary statistics
async function loadDashboardSummary() {
    try {
        const token = getCookie('authToken');
        const response = await fetch('/api/dashboard/summary', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();

            // Validate response structure
            if (!data || typeof data !== 'object') {
                console.error('Invalid dashboard data structure:', data);
                return;
            }

            // Update Bills Paid card
            if (data.bills_paid) {
                const paidAmount = data.bills_paid.amount || 0;
                const paidCount = data.bills_paid.count || 0;
                const paidAmountEl = document.getElementById('stat-bills-paid-amount');
                const paidCountEl = document.getElementById('stat-bills-paid-count');
                if (paidAmountEl) paidAmountEl.textContent = `฿${paidAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                if (paidCountEl) paidCountEl.textContent = paidCount;
            }

            // Update Bills Today card
            if (data.bills_today) {
                const todayAmount = data.bills_today.amount || 0;
                const todayCount = data.bills_today.count || 0;
                const todayAmountEl = document.getElementById('stat-bills-today-amount');
                const todayCountEl = document.getElementById('stat-bills-today-count');
                if (todayAmountEl) todayAmountEl.textContent = `฿${todayAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                if (todayCountEl) todayCountEl.textContent = todayCount;
            }

            // Update New Patients This Month card (CL001)
            if (data.patients_this_month) {
                const patientsMonthCount = data.patients_this_month.count || 0;
                const change = data.patients_this_month.change || 0;
                const monthName = data.patients_this_month.month || '';
                const year = data.patients_this_month.year || '';

                const monthEl = document.getElementById('stat-patients-month');
                const monthLabelEl = document.getElementById('stat-patients-month-label');
                if (monthEl) monthEl.textContent = patientsMonthCount;
                if (monthLabelEl) monthLabelEl.textContent = `${monthName} ${year}`;

                // Display change indicator with color
                const changeEl = document.getElementById('stat-patients-change');
                if (changeEl) {
                    if (change !== 0) {
                        const changeText = change > 0 ? `+${change}` : change;
                        const changeColor = change > 0 ? 'text-success' : 'text-danger';
                        changeEl.innerHTML = `<span class="${changeColor}">(${changeText} from last month)</span>`;
                    } else {
                        changeEl.innerHTML = '<span class="text-muted">(no change)</span>';
                    }
                }
            }

            // Update Total Patients in Clinic card (CL001)
            if (data.total_patients) {
                const totalPatientsCount = data.total_patients.count || 0;
                const totalPatientsEl = document.getElementById('stat-total-patients');
                if (totalPatientsEl) totalPatientsEl.textContent = totalPatientsCount;
            }
        } else {
            console.error('Failed to load dashboard summary - HTTP', response.status);
        }
    } catch (error) {
        console.error('Error loading dashboard summary:', error);
    }
}

// Load clinics for filter
async function loadClinics() {
    try {
        const token = getCookie('authToken');
        const response = await fetch('/api/clinics', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const clinics = await response.json();
            const select = document.getElementById('filter-clinic');
            select.innerHTML = '<option value="">All Clinics</option>';
            
            clinics.forEach(clinic => {
                const option = document.createElement('option');
                option.value = clinic.id;
                option.textContent = clinic.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading clinics:', error);
    }
}

// Load PN cases
async function loadCases(page = 1) {
    try {
        currentPage = page;
        
        // Build query parameters
        const params = new URLSearchParams({
            page: page,
            limit: 20
        });
        
        // Add filters
        const clinicId = document.getElementById('filter-clinic').value;
        if (clinicId) params.append('clinic_id', clinicId);
        
        const status = document.getElementById('filter-status').value;
        if (status) params.append('status', status);
        
        const fromDate = document.getElementById('filter-from').value;
        if (fromDate) params.append('from_date', fromDate);
        
        const toDate = document.getElementById('filter-to').value;
        if (toDate) params.append('to_date', toDate);
        
        const search = document.getElementById('search-input').value;
        if (search) params.append('search', search);
        
        const token = getCookie('authToken');
        const response = await fetch(`/api/pn?${params}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            displayCases(data.cases);
            displayPagination(data.pagination);
            updateStatistics(data.statistics);
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Error loading cases:', error);
        showAlert('Error loading cases', 'danger');
    }
}

function displayCases(cases) {
    const tbody = document.getElementById('cases-tbody');

    // Filter out walk-in appointments (they should be viewed in appointments page, not dashboard)
    let pnCases = cases.filter(pnCase => pnCase.record_type !== 'WALK_IN');

    // Check if manual date filters are active
    const hasManualDateFilter = document.getElementById('filter-from').value || document.getElementById('filter-to').value;

    // Apply status-based date filtering ONLY if no manual date filters
    if (!hasManualDateFilter) {
        const today = moment().format('YYYY-MM-DD');
        const weekStart = moment().startOf('week');
        const weekEnd = moment().endOf('week');

        pnCases = pnCases.filter(pnCase => {
            const status = pnCase.status;

            // PENDING: only this week
            if (status === 'PENDING') {
                const caseDate = pnCase.appointment_date
                    ? moment(pnCase.appointment_date)
                    : moment(pnCase.created_at);
                return caseDate.isBetween(weekStart, weekEnd, null, '[]');
            }

            // ACCEPTED: show all time
            if (status === 'ACCEPTED') {
                return true;
            }

            // COMPLETED: only today (based on completion date, not appointment date)
            if (status === 'COMPLETED') {
                // Use completion date (when it was marked completed)
                const completedDate = pnCase.completed_at || pnCase.updated_at;
                if (!completedDate) return false;

                // Check if completed today (compare dates only, not time)
                const completedDay = moment(completedDate).format('YYYY-MM-DD');
                return completedDay === today;
            }

            // Other statuses: show all
            return true;
        });
    }

    // Sort by nearest time first (status-aware sorting)
    pnCases.sort((a, b) => {
        let timeA, timeB;

        // Get time for case A (status-aware)
        if (a.status === 'COMPLETED') {
            // For COMPLETED: use completion date
            timeA = moment(a.completed_at || a.updated_at);
        } else if (a.appointment_date && a.appointment_start_time) {
            // For PENDING/ACCEPTED with appointment: use appointment date/time
            timeA = moment(`${a.appointment_date} ${a.appointment_start_time}`, 'YYYY-MM-DD HH:mm:ss');
        } else {
            // For cases without appointment: use creation time
            timeA = moment(a.created_at);
        }

        // Get time for case B (status-aware)
        if (b.status === 'COMPLETED') {
            // For COMPLETED: use completion date
            timeB = moment(b.completed_at || b.updated_at);
        } else if (b.appointment_date && b.appointment_start_time) {
            // For PENDING/ACCEPTED with appointment: use appointment date/time
            timeB = moment(`${b.appointment_date} ${b.appointment_start_time}`, 'YYYY-MM-DD HH:mm:ss');
        } else {
            // For cases without appointment: use creation time
            timeB = moment(b.created_at);
        }

        // Sort ascending (nearest first)
        return timeA.valueOf() - timeB.valueOf();
    });

    if (pnCases.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No cases found</td></tr>';
        return;
    }

    // Display filtered and sorted cases
    tbody.innerHTML = pnCases.map(pnCase => {
        // Check if this is a standalone walk-in (no PN case)
        const isWalkIn = pnCase.record_type === 'WALK_IN';

        // Format appointment date/time if available
        let appointmentInfo = '<span class="text-muted">-</span>';
        if (pnCase.appointment_date) {
            const aptDate = moment(pnCase.appointment_date).format('DD/MM/YYYY');
            const aptTime = pnCase.appointment_start_time && pnCase.appointment_end_time
                ? `${pnCase.appointment_start_time}-${pnCase.appointment_end_time}`
                : '';

            // Add walk-in indicator to appointment info
            const walkInLabel = pnCase.booking_type === 'WALK_IN' ? '<span class="badge bg-info ms-1">Walk-in</span>' : '';

            appointmentInfo = `
                <div class="small">
                    <i class="bi bi-calendar-event text-primary"></i> ${escapeHtml(aptDate)}${walkInLabel}<br>
                    ${aptTime ? `<i class="bi bi-clock text-primary"></i> ${escapeHtml(aptTime)}` : ''}
                </div>
            `;
        }

        return `
            <tr ${isWalkIn ? 'style="background-color: #e7f3ff;"' : ''}>
                <td>${pnCase.hn ? escapeHtml(pnCase.hn) : '<span class="text-muted">-</span>'}</td>
                <td>${escapeHtml(pnCase.first_name)} ${escapeHtml(pnCase.last_name)}</td>
                <td>${pnCase.pn_code ? `<span class="badge bg-secondary">${escapeHtml(pnCase.pn_code)}</span>` : '<span class="text-muted">-</span>'}</td>
                <td>${pnCase.diagnosis ? escapeHtml(truncateText(pnCase.diagnosis, 50)) : '<span class="text-muted">-</span>'}</td>
                <td>${pnCase.purpose ? escapeHtml(truncateText(pnCase.purpose, 50)) : '<span class="text-muted">-</span>'}</td>
                <td>${isWalkIn ? '<span class="badge bg-info">Walk-in Appointment</span>' : renderStatus(pnCase)}</td>
                <td>${escapeHtml(moment(pnCase.created_at).format('DD/MM/YYYY HH:mm'))}</td>
                <td>${appointmentInfo}</td>
                <td>
                    ${pnCase.patient_id && !isWalkIn ?
                        `<button class="btn btn-sm btn-info" onclick="openPatientDetail(${parseInt(pnCase.patient_id)})" title="View Patient">
                            <i class="bi bi-eye"></i>
                        </button>` : ''}
                    ${pnCase.id && !isWalkIn ?
                        `<button class="btn btn-sm btn-primary" onclick="viewCase(${parseInt(pnCase.id)})" title="View Case">
                            <i class="bi bi-folder-open"></i>
                        </button>` : ''}
                    ${pnCase.bill_id && !isWalkIn ?
                        `<button class="btn btn-sm btn-warning" onclick="viewBillDetails(${parseInt(pnCase.bill_id)})" title="View Bill">
                            <i class="bi bi-receipt"></i>
                        </button>` : ''}
                    ${pnCase.last_report_at && !isWalkIn ?
                        `<button class="btn btn-sm btn-success" onclick="downloadLastReport(${parseInt(pnCase.id)})" title="Download Report">
                            <i class="bi bi-file-pdf"></i>
                        </button>` : ''}
                    ${pnCase.status === 'COMPLETED' && !isWalkIn ?
                        `<button class="btn btn-sm btn-success" onclick="openCertificateModal(${parseInt(pnCase.id)})" title="Create/View PT Certificate">
                            <i class="bi bi-file-earmark-medical"></i>
                        </button>` : ''}
                    ${isWalkIn ?
                        `<a href="/appointments" class="btn btn-sm btn-info" title="View in Appointments">
                            <i class="bi bi-calendar-event"></i>
                        </a>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// Load walk-in appointments (uses same filters as dashboard table)
async function loadWalkInAppointments() {
    try {
        const token = getCookie('authToken');

        // Build query parameters using the same filters as dashboard table
        const params = new URLSearchParams({
            booking_type: 'WALK_IN',
            status: 'SCHEDULED' // Only show scheduled appointments
        });

        // Apply same filters from dashboard
        const clinicId = document.getElementById('filter-clinic').value;
        if (clinicId) params.append('clinic_id', clinicId);

        const fromDate = document.getElementById('filter-from').value;
        if (fromDate) {
            params.append('start_date', fromDate);
        } else {
            // Default: show from today onwards if no filter set
            params.append('start_date', moment().format('YYYY-MM-DD'));
        }

        const toDate = document.getElementById('filter-to').value;
        if (toDate) {
            params.append('end_date', toDate);
        } else {
            // Default: show next 30 days if no filter set
            params.append('end_date', moment().add(30, 'days').format('YYYY-MM-DD'));
        }

        const response = await fetch(`/api/appointments?${params}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const appointments = await response.json();

            // Filter: Only show true walk-in visitors (no patient_id)
            // Exclude existing patients who booked as walk-in
            const trueWalkIns = appointments.filter(apt => !apt.patient_id);

            // Sort by appointment date/time - nearest first
            trueWalkIns.sort((a, b) => {
                const dateTimeA = moment(`${a.appointment_date} ${a.start_time}`, 'YYYY-MM-DD HH:mm:ss');
                const dateTimeB = moment(`${b.appointment_date} ${b.start_time}`, 'YYYY-MM-DD HH:mm:ss');
                return dateTimeA.valueOf() - dateTimeB.valueOf();
            });
            displayWalkInAppointments(trueWalkIns);
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Error loading walk-in appointments:', error);
        const tbody = document.getElementById('walkin-tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error loading walk-in visitors</td></tr>';
        }
    }
}

// Display walk-in appointments in table
function displayWalkInAppointments(appointments) {
    const tbody = document.getElementById('walkin-tbody');

    if (!tbody) return;

    if (appointments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No walk-in visitors found (showing only new visitors, not existing patients)</td></tr>';
        return;
    }

    tbody.innerHTML = appointments.map(apt => {
        const appointmentDate = moment(apt.appointment_date).format('DD/MM/YYYY');
        const dayOfWeek = moment(apt.appointment_date).format('ddd');
        const startTime = apt.start_time ? moment(apt.start_time, 'HH:mm:ss').format('HH:mm') : '-';
        const endTime = apt.end_time ? moment(apt.end_time, 'HH:mm:ss').format('HH:mm') : '-';
        const timeRange = `${startTime} - ${endTime}`;

        const walkInName = escapeHtml(apt.walk_in_name || 'Walk-in visitor');
        const walkInPhone = escapeHtml(apt.walk_in_phone || '-');
        const ptName = escapeHtml(apt.pt_name || 'Unassigned');
        const clinicName = escapeHtml(apt.clinic_name || '-');

        return `
            <tr>
                <td>
                    <div>${appointmentDate}</div>
                    <small class="text-muted">${dayOfWeek}</small>
                </td>
                <td>${timeRange}</td>
                <td>${walkInName}</td>
                <td>${walkInPhone}</td>
                <td>${ptName}</td>
                <td>${clinicName}</td>
                <td>
                    <a href="/appointments" class="btn btn-sm btn-primary" title="View in Appointments">
                        <i class="bi bi-calendar-event"></i>
                    </a>
                </td>
            </tr>
        `;
    }).join('');
}

// Render status with appropriate badge and dropdown for status changes
function renderStatus(pnCase) {
    const user = JSON.parse(localStorage.getItem('user'));
    const canChangeStatus = user.role === 'ADMIN' || user.role === 'PT'; // ADMIN and PT can change status

    // Show dropdown for PENDING cases (to ACCEPTED, CANCELLED)
    if (pnCase.status === 'PENDING' && canChangeStatus) {
        return `
            <div class="d-flex align-items-center">
                <select class="form-select form-select-sm" id="status-${pnCase.id}" data-source-clinic="${pnCase.source_clinic_code || ''}" data-target-clinic="${pnCase.target_clinic_code || ''}" style="width: auto;">
                    <option value="PENDING" selected>Pending</option>
                    <option value="ACCEPTED">Accept</option>
                    <option value="CANCELLED">Cancel</option>
                </select>
                <button class="btn btn-sm btn-success ms-1" onclick="saveStatus(${pnCase.id}, 'PENDING')">
                    <i class="bi bi-check"></i>
                </button>
            </div>
        `;
    }

    // Show dropdown for ACCEPTED cases (to COMPLETED, CANCELLED, or reverse to PENDING if ADMIN)
    if (pnCase.status === 'ACCEPTED' && canChangeStatus) {
        // ADMIN can reverse to PENDING, PT can only move forward to COMPLETED or CANCELLED
        const options = user.role === 'ADMIN'
            ? `
                <option value="PENDING">Pending</option>
                <option value="ACCEPTED" selected>Accepted</option>
                <option value="COMPLETED">Complete</option>
                <option value="CANCELLED">Cancel</option>
            `
            : `
                <option value="ACCEPTED" selected>Accepted</option>
                <option value="COMPLETED">Complete</option>
                <option value="CANCELLED">Cancel</option>
            `;

        return `
            <div class="d-flex align-items-center">
                <select class="form-select form-select-sm" id="status-${pnCase.id}" data-source-clinic="${pnCase.source_clinic_code || ''}" data-target-clinic="${pnCase.target_clinic_code || ''}" style="width: auto;">
                    ${options}
                </select>
                <button class="btn btn-sm btn-success ms-1" onclick="saveStatus(${pnCase.id}, 'ACCEPTED')">
                    <i class="bi bi-check"></i>
                </button>
            </div>
        `;
    }

    // Show COMPLETED status with reverse button for ADMIN
    if (pnCase.status === 'COMPLETED' && user.role === 'ADMIN') {
        return `
            <div class="d-flex align-items-center">
                <span class="badge badge-status bg-success">COMPLETED</span>
                <button class="btn btn-sm btn-warning ms-1" onclick="reverseStatus(${pnCase.id})" title="Reverse to ACCEPTED">
                    <i class="bi bi-arrow-counterclockwise"></i>
                </button>
            </div>
        `;
    }

    const statusColors = {
        'PENDING': 'warning',
        'ACCEPTED': 'info',
        'IN_PROGRESS': 'primary',
        'COMPLETED': 'success',
        'CANCELLED': 'danger'
    };

    return `<span class="badge badge-status bg-${statusColors[pnCase.status] || 'secondary'}">${pnCase.status}</span>`;
}

// Save status change
async function saveStatus(caseId, currentStatus) {
    try {
        const selectEl = document.getElementById(`status-${caseId}`);
        const newStatus = selectEl.value;
        const token = getCookie('authToken');

        // PENDING → ACCEPTED: Check if PT info needed (non-CL001)
        if (currentStatus === 'PENDING' && newStatus === 'ACCEPTED') {
            const sourceClinic = selectEl.dataset.sourceClinic;
            const targetClinic = selectEl.dataset.targetClinic;

            // Skip PT assessment if:
            // 1. Either clinic is CL001 (no assessment needed for CL001)
            // 2. Both are empty/falsy (existing patient, not a referral)
            const isCL001 = sourceClinic === 'CL001' || targetClinic === 'CL001';
            const isExistingPatient = !sourceClinic && !targetClinic;

            if (!isCL001 && !isExistingPatient) {
                // Only show PT assessment for non-CL001 referral cases
                showPTAssessmentModal(caseId);
                return;
            }
        }

        // ACCEPTED → COMPLETED: Always show SOAP modal
        if (currentStatus === 'ACCEPTED' && newStatus === 'COMPLETED') {
            showSOAPModal(caseId);
            return;
        }

        // ACCEPTED → PENDING: Confirm reversal (ADMIN only)
        if (currentStatus === 'ACCEPTED' && newStatus === 'PENDING') {
            const confirmReverse = confirm(
                'คุณต้องการย้อนสถานะจาก ACCEPTED กลับไปเป็น PENDING หรือไม่?\n\n' +
                'การดำเนินการนี้จะ:\n' +
                '- คืน course session กลับไป (ถ้ามี)\n' +
                '- ลบข้อมูล PT Assessment ที่บันทึกไว้\n\n' +
                'Are you sure you want to reverse status from ACCEPTED to PENDING?\n\n' +
                'This will:\n' +
                '- Return course session (if any)\n' +
                '- Clear PT Assessment data'
            );
            if (!confirmReverse) return;
        }

        // ACCEPTED → CANCELLED: Confirm cancellation and course return
        if (currentStatus === 'ACCEPTED' && newStatus === 'CANCELLED') {
            const confirmCancel = confirm(
                'คุณต้องการยกเลิกเคสนี้หรือไม่?\n\n' +
                'การดำเนินการนี้จะ:\n' +
                '- คืน course session กลับไป (ถ้ามี)\n' +
                '- ยกเลิก appointment ที่เชื่อมโยง (ถ้ามี)\n\n' +
                'Are you sure you want to CANCEL this case?\n\n' +
                'This will:\n' +
                '- Return course session (if any)\n' +
                '- Cancel linked appointment (if any)'
            );
            if (!confirmCancel) return;
        }

        // CANCELLED: Ask for reason
        let body = { status: newStatus };
        if (newStatus === 'CANCELLED') {
            const reason = prompt('Please provide cancellation reason:');
            if (!reason) return;
            body.cancellation_reason = reason;
        }

        // For simple status changes (e.g., CL001 PENDING to ACCEPTED)
        const response = await fetch(`/api/pn/${caseId}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            showAlert('Status updated successfully', 'success');
            loadCases(currentPage);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to update status', 'danger');
        }
    } catch (error) {
        console.error('Error updating status:', error);
        showAlert('Error updating status', 'danger');
    }
}

// Show PT Assessment Modal for non-CL001 clinics
function showPTAssessmentModal(caseId) {
    const modalHtml = `
        <div class="modal fade" id="ptAssessmentModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">PT Assessment Information</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="ptAssessmentForm">
                            <div class="mb-3">
                                <label class="form-label">Physiotherapy Diagnosis <span class="text-danger">*</span></label>
                                <textarea class="form-control" id="pt_diagnosis" rows="3" required></textarea>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Chief Complaint <span class="text-danger">*</span></label>
                                <textarea class="form-control" id="pt_chief_complaint" rows="3" required></textarea>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Present History <span class="text-danger">*</span></label>
                                <textarea class="form-control" id="pt_present_history" rows="3" required></textarea>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Pain Score (0-10) <span class="text-danger">*</span></label>
                                <input type="range" class="form-range" id="pt_pain_score" min="0" max="10" value="5">
                                <div class="text-center"><span id="pain_score_value">5</span>/10</div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="submitPTAssessment(${caseId})">Accept Case</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existing = document.getElementById('ptAssessmentModal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Add event listener for pain score slider
    document.getElementById('pt_pain_score').addEventListener('input', (e) => {
        document.getElementById('pain_score_value').textContent = e.target.value;
    });

    const modal = new bootstrap.Modal(document.getElementById('ptAssessmentModal'));
    modal.show();
}

// Submit PT Assessment
async function submitPTAssessment(caseId) {
    try {
        const token = getCookie('authToken');

        const body = {
            status: 'ACCEPTED',
            pt_diagnosis: document.getElementById('pt_diagnosis').value,
            pt_chief_complaint: document.getElementById('pt_chief_complaint').value,
            pt_present_history: document.getElementById('pt_present_history').value,
            pt_pain_score: parseInt(document.getElementById('pt_pain_score').value)
        };

        if (!body.pt_diagnosis || !body.pt_chief_complaint || !body.pt_present_history) {
            showAlert('Please fill in all required fields', 'warning');
            return;
        }

        const response = await fetch(`/api/pn/${caseId}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('ptAssessmentModal')).hide();
            showAlert('Case accepted with PT assessment', 'success');
            loadCases(currentPage);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to accept case', 'danger');
        }
    } catch (error) {
        console.error('Error submitting PT assessment:', error);
        showAlert('Error submitting PT assessment', 'danger');
    }
}

// Show SOAP Modal for completing cases
async function showSOAPModal(caseId) {
    try {
        const token = getCookie('authToken');

        // Fetch case details with patient information
        const response = await fetch(`/api/pn/${caseId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            showAlert('Failed to load case details', 'danger');
            return;
        }

        const caseData = await response.json();

        // Debug: Log the data received from API
        console.log('🔍 SOAP Modal - Case Data:', caseData);
        console.log('📋 HN:', caseData.hn);
        console.log('👤 Name:', caseData.first_name, caseData.last_name);
        console.log('🏥 Diagnosis:', caseData.diagnosis);
        console.log('💊 PT Assessment:', {
            pt_diagnosis: caseData.pt_diagnosis,
            pt_chief_complaint: caseData.pt_chief_complaint,
            pt_present_history: caseData.pt_present_history,
            pt_pain_score: caseData.pt_pain_score
        });

        const modalHtml = `
            <div class="modal fade" id="soapModal" tabindex="-1">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                            <h5 class="modal-title"><i class="bi bi-file-medical"></i> Complete Case - SOAP Notes Documentation</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" style="background-color: #f5f5f5; padding: 2rem;">

                            <!-- TOP SECTION: Key Patient Information (PROMINENT) -->
                            <div class="card mb-4 shadow-lg" style="border: 3px solid #ff9800; border-radius: 12px;">
                                <div class="card-header text-white text-center" style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); padding: 1.5rem; border-radius: 10px 10px 0 0;">
                                    <h4 class="mb-0"><i class="bi bi-person-circle"></i> PATIENT IDENTIFICATION</h4>
                                </div>
                                <div class="card-body" style="background-color: white; padding: 2rem;">
                                    <div class="row text-center mb-3">
                                        <div class="col-md-4">
                                            <div class="p-3 rounded" style="background-color: #fff3e0; border-left: 5px solid #ff9800;">
                                                <h6 class="text-muted mb-2">HN</h6>
                                                <h3 class="mb-0" style="color: #e65100; font-weight: bold;">${caseData.hn || 'N/A'}</h3>
                                            </div>
                                        </div>
                                        <div class="col-md-8">
                                            <div class="p-3 rounded" style="background-color: #fff3e0; border-left: 5px solid #ff9800;">
                                                <h6 class="text-muted mb-2">Full Name</h6>
                                                <h3 class="mb-0" style="color: #e65100; font-weight: bold;">${caseData.first_name || ''} ${caseData.last_name || ''}</h3>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="row text-center">
                                        <div class="col-md-4">
                                            <p class="mb-1"><strong>PT Number:</strong></p>
                                            <p class="text-primary fs-5 mb-0">${caseData.pt_number || 'N/A'}</p>
                                        </div>
                                        <div class="col-md-4">
                                            <p class="mb-1"><strong>Gender:</strong></p>
                                            <p class="fs-5 mb-0">${caseData.gender || 'N/A'}</p>
                                        </div>
                                        <div class="col-md-4">
                                            <p class="mb-1"><strong>DOB:</strong></p>
                                            <p class="fs-5 mb-0">${caseData.dob ? moment(caseData.dob).format('DD/MM/YYYY') : 'N/A'}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Medical Information -->
                            <div class="card mb-4 shadow" style="border-left: 5px solid #4caf50; border-radius: 10px;">
                                <div class="card-header text-white" style="background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%); padding: 1rem;">
                                    <h5 class="mb-0"><i class="bi bi-heart-pulse"></i> GENERAL DIAGNOSIS & MEDICAL INFORMATION</h5>
                                </div>
                                <div class="card-body" style="background-color: #f1f8e9; padding: 1.5rem;">
                                    <div class="row">
                                        <div class="col-md-12 mb-3">
                                            <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #66bb6a;">
                                                <strong style="color: #2e7d32;">General Diagnosis:</strong>
                                                <p class="mb-0 mt-2 fs-5">${caseData.diagnosis || caseData.patient_diagnosis || 'N/A'}</p>
                                            </div>
                                        </div>
                                        <div class="col-md-12 mb-3">
                                            <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #66bb6a;">
                                                <strong style="color: #2e7d32;">Rehab Goals:</strong>
                                                <p class="mb-0 mt-2">${caseData.rehab_goal || 'N/A'}</p>
                                            </div>
                                        </div>
                                        ${caseData.precaution ? `
                                            <div class="col-md-12 mb-2">
                                                <div class="alert alert-warning mb-0" style="border-left: 4px solid #ff9800;">
                                                    <strong><i class="bi bi-exclamation-triangle"></i> Precautions:</strong>
                                                    <p class="mb-0 mt-1">${caseData.precaution}</p>
                                                </div>
                                            </div>
                                        ` : ''}
                                        ${caseData.pn_precautions ? `
                                            <div class="col-md-12 mb-2">
                                                <div class="alert alert-warning mb-0" style="border-left: 4px solid #ff9800;">
                                                    <strong><i class="bi bi-exclamation-triangle"></i> PN Precautions:</strong>
                                                    <p class="mb-0 mt-1">${caseData.pn_precautions}</p>
                                                </div>
                                            </div>
                                        ` : ''}
                                        ${caseData.pn_contraindications ? `
                                            <div class="col-md-12 mb-2">
                                                <div class="alert alert-danger mb-0" style="border-left: 4px solid #f44336;">
                                                    <strong><i class="bi bi-x-octagon"></i> Contraindications:</strong>
                                                    <p class="mb-0 mt-1">${caseData.pn_contraindications}</p>
                                                </div>
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>

                            <!-- PT Assessment (if available) -->
                            ${(caseData.pt_diagnosis || caseData.pt_chief_complaint || caseData.pt_present_history || caseData.pt_pain_score !== null) ? `
                                <div class="card mb-4 shadow" style="border-left: 5px solid #2196F3; border-radius: 10px;">
                                    <div class="card-header text-white" style="background: linear-gradient(135deg, #2196F3 0%, #1976d2 100%); padding: 1rem;">
                                        <h5 class="mb-0"><i class="bi bi-clipboard-pulse"></i> PT ASSESSMENT PROFILE</h5>
                                    </div>
                                    <div class="card-body" style="background-color: #e3f2fd; padding: 1.5rem;">
                                        <div class="row">
                                            ${caseData.pt_diagnosis ? `
                                                <div class="col-md-12 mb-3">
                                                    <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #42a5f5;">
                                                        <strong style="color: #1565c0;">PT Diagnosis:</strong>
                                                        <p class="mb-0 mt-2">${caseData.pt_diagnosis}</p>
                                                    </div>
                                                </div>
                                            ` : ''}
                                            ${caseData.pt_chief_complaint ? `
                                                <div class="col-md-12 mb-3">
                                                    <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #42a5f5;">
                                                        <strong style="color: #1565c0;">Chief Complaint:</strong>
                                                        <p class="mb-0 mt-2">${caseData.pt_chief_complaint}</p>
                                                    </div>
                                                </div>
                                            ` : ''}
                                            ${caseData.pt_present_history ? `
                                                <div class="col-md-12 mb-3">
                                                    <div class="p-3 rounded" style="background-color: white; border-left: 4px solid #42a5f5;">
                                                        <strong style="color: #1565c0;">Present History:</strong>
                                                        <p class="mb-0 mt-2">${caseData.pt_present_history}</p>
                                                    </div>
                                                </div>
                                            ` : ''}
                                            ${caseData.pt_pain_score !== null && caseData.pt_pain_score !== undefined ? `
                                                <div class="col-md-12">
                                                    <div class="p-3 rounded text-center" style="background-color: white; border-left: 4px solid #42a5f5;">
                                                        <strong style="color: #1565c0;">Pain Score:</strong>
                                                        <h2 class="mb-0 mt-2">
                                                            <span class="badge" style="background-color: ${caseData.pt_pain_score >= 7 ? '#f44336' : caseData.pt_pain_score >= 4 ? '#ff9800' : '#4caf50'}; font-size: 2rem; padding: 0.5rem 1.5rem;">
                                                                ${caseData.pt_pain_score}/10
                                                            </span>
                                                        </h2>
                                                    </div>
                                                </div>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                            ` : ''}

                            <!-- SOAP Notes Form -->
                            <div class="card" style="border-left: 4px solid #9c27b0;">
                                <div class="card-header" style="background-color: #9c27b0; color: white;">
                                    <h6 class="mb-0"><i class="bi bi-journal-medical"></i> SOAP Notes - Complete Assessment</h6>
                                </div>
                                <div class="card-body">
                                    <form id="soapForm">
                                        <div class="table-responsive">
                                            <table class="table table-bordered">
                                                <thead class="table-light">
                                                    <tr>
                                                        <th width="25%" class="text-center">Subjective</th>
                                                        <th width="25%" class="text-center">Objective</th>
                                                        <th width="25%" class="text-center">Assessment</th>
                                                        <th width="25%" class="text-center">Plan</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        <td>
                                                            <textarea class="form-control" id="soap_subjective" rows="10" required
                                                                placeholder="Patient's complaints, symptoms, history..."></textarea>
                                                        </td>
                                                        <td>
                                                            <textarea class="form-control" id="soap_objective" rows="10" required
                                                                placeholder="Observations, measurements, test results..."></textarea>
                                                        </td>
                                                        <td>
                                                            <textarea class="form-control" id="soap_assessment" rows="10" required
                                                                placeholder="Clinical impression, diagnosis, progress..."></textarea>
                                                        </td>
                                                        <td>
                                                            <textarea class="form-control" id="soap_plan" rows="10" required
                                                                placeholder="Treatment plan, goals, follow-up..."></textarea>
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label"><strong>Additional Notes</strong></label>
                                            <textarea class="form-control" id="soap_notes" rows="3"
                                                placeholder="Any additional observations or comments..."></textarea>
                                        </div>
                                        <div class="alert alert-info">
                                            <i class="bi bi-info-circle"></i> Timestamp will be automatically recorded when you complete the case.
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                                <i class="bi bi-x-circle"></i> Cancel
                            </button>
                            <button type="button" class="btn btn-success btn-lg" onclick="submitSOAP(${caseId})">
                                <i class="bi bi-check-circle"></i> Complete Case
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existing = document.getElementById('soapModal');
        if (existing) existing.remove();

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = new bootstrap.Modal(document.getElementById('soapModal'));
        modal.show();

    } catch (error) {
        console.error('Error loading SOAP modal:', error);
        showAlert('Error loading case details', 'danger');
    }
}

// Submit SOAP notes
async function submitSOAP(caseId) {
    try {
        const token = getCookie('authToken');

        const body = {
            status: 'COMPLETED',
            soap_notes: {
                subjective: document.getElementById('soap_subjective').value,
                objective: document.getElementById('soap_objective').value,
                assessment: document.getElementById('soap_assessment').value,
                plan: document.getElementById('soap_plan').value,
                notes: document.getElementById('soap_notes').value
            }
        };

        if (!body.soap_notes.subjective || !body.soap_notes.objective ||
            !body.soap_notes.assessment || !body.soap_notes.plan) {
            showAlert('Please fill in all SOAP fields', 'warning');
            return;
        }

        const response = await fetch(`/api/pn/${caseId}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('soapModal')).hide();
            showAlert('Case completed with SOAP notes', 'success');
            loadCases(currentPage);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to complete case', 'danger');
        }
    } catch (error) {
        console.error('Error submitting SOAP:', error);
        showAlert('Error submitting SOAP notes', 'danger');
    }
}

// Reverse status (ADMIN only)
async function reverseStatus(caseId) {
    try {
        const reason = prompt('Please provide reason for reversing status (e.g., "This case re-edit SOAP"):');
        if (!reason) return;

        const token = getCookie('authToken');
        const response = await fetch(`/api/pn/${caseId}/reverse-status`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason })
        });

        if (response.ok) {
            showAlert('Status reversed to ACCEPTED. SOAP notes must be re-entered.', 'success');
            loadCases(currentPage);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to reverse status', 'danger');
        }
    } catch (error) {
        console.error('Error reversing status:', error);
        showAlert('Error reversing status', 'danger');
    }
}

// Display pagination
function displayPagination(pagination) {
    const paginationEl = document.getElementById('pagination');
    const { page, pages, total } = pagination;
    
    if (pages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Previous button
    html += `
        <li class="page-item ${page === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadCases(${page - 1}); return false;">Previous</a>
        </li>
    `;
    
    // Page numbers
    for (let i = 1; i <= Math.min(pages, 5); i++) {
        if (i === page) {
            html += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
        } else {
            html += `<li class="page-item"><a class="page-link" href="#" onclick="loadCases(${i}); return false;">${i}</a></li>`;
        }
    }
    
    if (pages > 5) {
        html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        html += `<li class="page-item"><a class="page-link" href="#" onclick="loadCases(${pages}); return false;">${pages}</a></li>`;
    }
    
    // Next button
    html += `
        <li class="page-item ${page === pages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadCases(${page + 1}); return false;">Next</a>
        </li>
    `;
    
    // Total info
    html += `
        <li class="page-item disabled">
            <span class="page-link">Total: ${total} | Page ${page}/${pages}</span>
        </li>
    `;
    
    paginationEl.innerHTML = html;
}

// Update statistics
function updateStatistics(stats) {
    if (!stats) return;

    const totalEl = document.getElementById('stat-total');
    const waitingEl = document.getElementById('stat-waiting');
    const acceptedEl = document.getElementById('stat-accepted');
    const completedEl = document.getElementById('stat-completed');

    // ✅ FIX: Use stats.total directly from Backend (excludes CANCELLED cases)
    // Backend already calculates: COUNT(CASE WHEN status != 'CANCELLED' THEN 1 END) as total
    const total = parseInt(stats.total || 0);
    const waitingCount = parseInt(stats.waiting || 0);
    const acceptedCount = parseInt(stats.accepted || 0);
    const completedCount = parseInt(stats.completed || 0);

    // Update UI with correct values from Backend
    if (totalEl) totalEl.textContent = total;
    if (waitingEl) waitingEl.textContent = waitingCount;
    if (acceptedEl) acceptedEl.textContent = acceptedCount;
    if (completedEl) completedEl.textContent = completedCount;
}

// Quick filters
function setQuickFilter(type) {
    const fromEl = document.getElementById('filter-from');
    const toEl = document.getElementById('filter-to');
    const today = moment();

    switch(type) {
        case 'today':
            fromEl._flatpickr.setDate(today.format('YYYY-MM-DD'));
            toEl._flatpickr.setDate(today.format('YYYY-MM-DD'));
            break;
        case 'week':
            // Start of week (Monday) to end of week (Sunday)
            fromEl._flatpickr.setDate(today.clone().startOf('week').format('YYYY-MM-DD'));
            toEl._flatpickr.setDate(today.clone().endOf('week').format('YYYY-MM-DD'));
            break;
        case 'month':
            fromEl._flatpickr.setDate(today.clone().startOf('month').format('YYYY-MM-DD'));
            toEl._flatpickr.setDate(today.clone().endOf('month').format('YYYY-MM-DD'));
            break;
        case 'year':
            fromEl._flatpickr.setDate(today.clone().startOf('year').format('YYYY-MM-DD'));
            toEl._flatpickr.setDate(today.clone().endOf('year').format('YYYY-MM-DD'));
            break;
    }

    loadCases();
    loadWalkInAppointments(); // Reload walk-in table with same filters
}

// Clear filters
function clearFilters() {
    document.getElementById('filter-clinic').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-from')._flatpickr.clear();
    document.getElementById('filter-to')._flatpickr.clear();
    document.getElementById('search-input').value = '';
    loadCases();
    loadWalkInAppointments(); // Reload walk-in table with cleared filters
}

// Open patient detail in new tab
function openPatientDetail(patientId) {
    window.open(`/patient/${patientId}`, '_blank');
}

// View case details
function viewCase(caseId) {
    window.location.href = `/pn/${caseId}`;
}

// Download last report
async function downloadLastReport(caseId) {
    // Implementation for downloading last report
    window.open(`/api/pn/${caseId}/last-report`, '_blank');
}

// NEW: View bill details - Opens bill in new tab
function viewBillDetails(billId) {
    // Open bills page with the bill view modal
    window.open(`/bills?view=${billId}`, '_blank');
}

// Export data
function exportData() {
    const params = new URLSearchParams(window.location.search);
    params.append('export', 'csv');
    window.open(`/api/pn/export?${params}`, '_blank');
}

// Logout function
async function logout() {
    try {
        const token = getCookie('authToken');
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        // Clear storage
        document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        localStorage.clear();
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login';
    }
}

// Utility functions
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function showAlert(message, type = 'info') {
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show position-fixed top-0 end-0 m-3" style="z-index: 9999;">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', alertHtml);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        const alert = document.querySelector('.alert');
        if (alert) alert.remove();
    }, 5000);
}

// ========================================
// PT CERTIFICATE FUNCTIONS
// ========================================

let currentCertificatePnId = null;
let currentEditCertId = null;
const loggedInUser = JSON.parse(localStorage.getItem('user'));

async function openCertificateModal(pnId) {
    currentCertificatePnId = pnId;
    currentEditCertId = null;

    // Reset form
    document.getElementById('newCertificateForm').reset();
    document.getElementById('cert_pn_id').value = pnId;
    document.getElementById('cert_edit_id').value = '';

    // Show loading
    document.getElementById('certificateLoading').style.display = 'block';
    document.getElementById('existingCertificates').style.display = 'none';
    document.getElementById('certificateForm').style.display = 'none';

    // Open modal
    const modal = new bootstrap.Modal(document.getElementById('certificateModal'));
    modal.show();

    // Load existing certificates
    try {
        const token = getCookie('authToken');
        const response = await fetch(`/api/pn/${pnId}/certificates`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const certificates = await response.json();

            document.getElementById('certificateLoading').style.display = 'none';

            if (certificates.length > 0) {
                displayCertificatesList(certificates);
                document.getElementById('existingCertificates').style.display = 'block';
            }

            document.getElementById('certificateForm').style.display = 'block';
            document.getElementById('createCertBtn').style.display = 'inline-block';
            document.getElementById('saveCertBtn').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading certificates:', error);
        document.getElementById('certificateLoading').innerHTML = '<p class="text-danger">Error loading certificates</p>';
    }
}

function displayCertificatesList(certificates) {
    const listDiv = document.getElementById('certificatesList');
    const isAdmin = loggedInUser && loggedInUser.role === 'ADMIN';

    listDiv.innerHTML = certificates.map(cert => {
        const certData = JSON.parse(cert.certificate_data || '{}');
        const createdDate = new Date(cert.created_at).toLocaleDateString('en-GB');

        return `
            <div class="card mb-2">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-1">
                                <i class="bi bi-file-earmark-medical text-success me-2"></i>
                                Certificate #${cert.id} - ${cert.certificate_type.toUpperCase()}
                            </h6>
                            <small class="text-muted">
                                Created: ${createdDate} by ${escapeHtml(cert.created_by_name)}
                            </small>
                        </div>
                        <div>
                            <button class="btn btn-sm btn-primary" onclick="window.open('/documents/render/pt_cert/${cert.id}', '_blank')" title="View/Print">
                                <i class="bi bi-printer"></i> Print
                            </button>
                            ${isAdmin ? `
                                <button class="btn btn-sm btn-warning" onclick="editCertificate(${cert.id}, ${escapeHtml(JSON.stringify(certData))})" title="Edit (Admin Only)">
                                    <i class="bi bi-pencil"></i> Edit
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    ${certData.pt_diagnosis ? `
                        <div class="mt-2">
                            <strong>PT Diagnosis:</strong> ${escapeHtml(certData.pt_diagnosis.substring(0, 100))}${certData.pt_diagnosis.length > 100 ? '...' : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function editCertificate(certId, certData) {
    currentEditCertId = certId;

    // Populate form with existing data
    document.getElementById('cert_edit_id').value = certId;
    document.getElementById('cert_pt_diagnosis').value = certData.pt_diagnosis || '';
    document.getElementById('cert_notes').value = certData.additional_notes || '';

    // Show save button, hide create button
    document.getElementById('createCertBtn').style.display = 'none';
    document.getElementById('saveCertBtn').style.display = 'inline-block';
    document.getElementById('certificateModalTitle').textContent = 'Edit Physiotherapy Certificate';
}

async function createCertificate() {
    const form = document.getElementById('newCertificateForm');

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const pnId = document.getElementById('cert_pn_id').value;
    const certType = document.getElementById('cert_type').value;
    const ptDiagnosis = document.getElementById('cert_pt_diagnosis').value.trim();
    const additionalNotes = document.getElementById('cert_notes').value.trim();

    if (!ptDiagnosis) {
        showAlert('Please enter PT diagnosis', 'warning');
        return;
    }

    try {
        const token = getCookie('authToken');
        const response = await fetch(`/api/pn/${pnId}/certificate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                certificate_type: certType,
                certificate_data: {
                    pt_diagnosis: ptDiagnosis,
                    additional_notes: additionalNotes
                }
            })
        });

        if (response.ok) {
            const result = await response.json();
            showAlert('Certificate created successfully!', 'success');

            // Close modal and open print view
            bootstrap.Modal.getInstance(document.getElementById('certificateModal')).hide();
            window.open(`/documents/render/pt_cert/${result.certificate_id}`, '_blank');

            // Reload cases to update UI
            loadCases();
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to create certificate', 'danger');
        }
    } catch (error) {
        console.error('Error creating certificate:', error);
        showAlert('Error creating certificate', 'danger');
    }
}

async function saveCertificate() {
    const form = document.getElementById('newCertificateForm');

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const certId = document.getElementById('cert_edit_id').value;
    const ptDiagnosis = document.getElementById('cert_pt_diagnosis').value.trim();
    const additionalNotes = document.getElementById('cert_notes').value.trim();

    if (!ptDiagnosis) {
        showAlert('Please enter PT diagnosis', 'warning');
        return;
    }

    try {
        const token = getCookie('authToken');
        const response = await fetch(`/api/certificates/${certId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                certificate_data: {
                    pt_diagnosis: ptDiagnosis,
                    additional_notes: additionalNotes
                }
            })
        });

        if (response.ok) {
            showAlert('Certificate updated successfully!', 'success');

            // Close modal and reload
            bootstrap.Modal.getInstance(document.getElementById('certificateModal')).hide();

            // Reload certificates
            openCertificateModal(currentCertificatePnId);
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to update certificate', 'danger');
        }
    } catch (error) {
        console.error('Error updating certificate:', error);
        showAlert('Error updating certificate', 'danger');
    }
}
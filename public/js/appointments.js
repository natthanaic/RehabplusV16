// Appointments Calendar JavaScript

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

// Broadcast sync function for instant cross-tab communication
function broadcastSync(type) {
    try {
        if ('BroadcastChannel' in window) {
            const channel = new BroadcastChannel('pn-app-sync');
            channel.postMessage({ type: type, timestamp: Date.now() });
            channel.close();
            console.log('Appointments: Broadcasted sync message:', type);
        } else {
            // Fallback: Use localStorage for older browsers
            localStorage.setItem('pn-sync-trigger', Date.now().toString());
            setTimeout(() => localStorage.removeItem('pn-sync-trigger'), 1000);
            console.log('Appointments: Triggered localStorage sync');
        }
    } catch (error) {
        console.error('Broadcast sync error:', error);
    }
}

let calendar;
let currentAppointmentId = null;
let allAppointments = [];
let currentBookingType = 'OLD_PATIENT';
const canManageAppointments = window.userInfo && (window.userInfo.role === 'ADMIN' || window.userInfo.role === 'PT');

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Load lists first
    loadPTList();
    loadClinicList();
    
    // Then initialize the calendar, which will trigger the first event load
    initializeCalendar();

    // Set minimum date to today
    const dateInput = document.getElementById('appointmentDate');
    if (dateInput) {
        dateInput.min = new Date().toISOString().split('T')[0];
    }

    // Add event listeners for filters to refetch events
    const filterPT = document.getElementById('filterPT');
    const filterClinic = document.getElementById('filterClinic');
    const filterStatus = document.getElementById('filterStatus');

    if (filterPT) filterPT.addEventListener('change', () => calendar.refetchEvents());
    if (filterClinic) filterClinic.addEventListener('change', () => calendar.refetchEvents());
    if (filterStatus) filterStatus.addEventListener('change', () => calendar.refetchEvents());

    // Listen for Enter key in patient search
    const searchInput = document.getElementById('patientSearch');
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchPatients();
            }
        });
    }

    const bookingTypeOld = document.getElementById('bookingTypeOld');
    const bookingTypeWalkIn = document.getElementById('bookingTypeWalkIn');

    if (bookingTypeOld) bookingTypeOld.addEventListener('change', () => setBookingType('OLD_PATIENT'));
    if (bookingTypeWalkIn) bookingTypeWalkIn.addEventListener('change', () => setBookingType('WALK_IN'));

    setBookingType('OLD_PATIENT');
});

// Get auth token from cookie
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Show alert message
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3`;
    alertDiv.style.zIndex = '9999';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

function clearPatientSelection() {
    const idInput = document.getElementById('selectedPatientId');
    if (idInput) idInput.value = '';

    const display = document.getElementById('selectedPatientDisplay');
    if (display) display.textContent = '';

    const info = document.getElementById('selectedPatientInfo');
    if (info) info.style.display = 'none';

    // Hide course section
    const courseSection = document.getElementById('courseSection');
    if (courseSection) courseSection.style.display = 'none';
}

function resetWalkInFields() {
    const walkInName = document.getElementById('walkInName');
    const walkInPhone = document.getElementById('walkInPhone');
    if (walkInName) walkInName.value = '';
    if (walkInPhone) walkInPhone.value = '';
}

function updateAutoCreatePNVisibility() {
    const section = document.getElementById('autoCreatePNSection');
    const idInput = document.getElementById('selectedPatientId');

    if (!section || !idInput) {
        return;
    }

    const hasPatient = Boolean(idInput.value);
    const shouldShow = currentBookingType === 'OLD_PATIENT' && !currentAppointmentId && hasPatient;
    section.style.display = shouldShow ? 'block' : 'none';
}

function setBookingType(type, options = {}) {
    const { keepPatientSelection = false, keepWalkInFields = false } = options;

    currentBookingType = type === 'WALK_IN' ? 'WALK_IN' : 'OLD_PATIENT';

    const oldInput = document.getElementById('bookingTypeOld');
    const walkInInput = document.getElementById('bookingTypeWalkIn');
    if (oldInput) oldInput.checked = currentBookingType === 'OLD_PATIENT';
    if (walkInInput) walkInInput.checked = currentBookingType === 'WALK_IN';

    const existingSection = document.getElementById('existingPatientSection');
    const walkInSection = document.getElementById('walkInSection');
    if (existingSection) existingSection.style.display = currentBookingType === 'OLD_PATIENT' ? 'block' : 'none';
    if (walkInSection) walkInSection.style.display = currentBookingType === 'WALK_IN' ? 'block' : 'none';

    if (currentBookingType === 'OLD_PATIENT') {
        if (!keepWalkInFields) {
            resetWalkInFields();
        }
    } else {
        if (!keepPatientSelection) {
            clearPatientSelection();
        }

        const searchResults = document.getElementById('patientSearchResults');
        if (searchResults) searchResults.style.display = 'none';

        const searchInput = document.getElementById('patientSearch');
        if (searchInput) searchInput.value = '';
    }

    updateAutoCreatePNVisibility();
}

async function refreshCalendar() {
    if (calendar && typeof calendar.refetchEvents === 'function') {
        await calendar.refetchEvents();
    }
}

function removeEventFromCalendar(appointmentId) {
    if (!calendar || appointmentId === null || appointmentId === undefined) {
        return;
    }

    const idStr = String(appointmentId);
    const event = calendar.getEventById(idStr);

    if (event) {
        event.remove();
    }
}

function normalizeDate(value) {
    if (!value) return '';
    return moment(value).format('YYYY-MM-DD');
}

function parseTime(value) {
    if (!value) return null;
    const parsed = moment(value, ['HH:mm:ss', 'HH:mm', moment.ISO_8601], true);
    return parsed.isValid() ? parsed : moment(value);
}

function normalizeTime(value) {
    const parsed = parseTime(value);
    return parsed ? parsed.format('HH:mm:ss') : '';
}

function formatTimeForInput(value) {
    const parsed = parseTime(value);
    return parsed ? parsed.format('HH:mm') : '';
}

function buildDateTime(date, time) {
    if (!date || !time) return '';
    const dt = moment(`${date} ${time}`, ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', moment.ISO_8601], true);
    return (dt.isValid() ? dt : moment(`${date}T${time}`)).format('YYYY-MM-DDTHH:mm:ss');
}

function formatStatusLabel(status) {
    if (!status) return '';
    return status
        .toString()
        .split('_')
        .map(word => word.charAt(0) + word.slice(1).toLowerCase())
        .join(' ');
}

// Initialize FullCalendar
function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: window.innerWidth < 768 ? 'timeGridDay' : 'timeGridWeek',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: window.innerWidth < 768 ? 'timeGridDay,listWeek' : 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
        },
        slotMinTime: '08:00:00',
        slotMaxTime: '20:00:00',
        slotDuration: '00:30:00',
        height: 'auto',
        expandRows: true,
        nowIndicator: true,
        editable: false,
        selectable: !!canManageAppointments,
        selectMirror: !!canManageAppointments,
        dayMaxEvents: true,
        // Mobile responsive settings
        windowResize: function(view) {
            if (window.innerWidth < 768) {
                calendar.changeView('timeGridDay');
            } else {
                calendar.changeView('timeGridWeek');
            }
        },

        // Click on empty slot to create appointment
        select: function(info) {
            if (!canManageAppointments) {
                return;
            }
            showBookingModal();
            document.getElementById('appointmentDate').value = moment(info.start).format('YYYY-MM-DD');
            document.getElementById('appointmentStartTime').value = moment(info.start).format('HH:mm');
            document.getElementById('appointmentEndTime').value = moment(info.end).format('HH:mm');
        },

        // Click on event to view details
        eventClick: function(info) {
            viewAppointmentDetails(info.event.id);
        },

        // Use the 'events' property as a function (JSON feed)
        // This tells FullCalendar to call this function whenever it needs events
        // (on load, on view change, or when calendar.refetchEvents() is called)
        events: loadAppointments
    });

    calendar.render();
}

// Load PT list
async function loadPTList() {
    try {
        const token = getCookie('authToken');
        const response = await fetch('/api/users?role=PT', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Failed to load PTs');

        const pts = await response.json();

        // Populate PT dropdowns
        const ptSelects = [document.getElementById('appointmentPT'), document.getElementById('filterPT')];
        ptSelects.forEach(select => {
            if (!select) return;
            const isFilter = select.id === 'filterPT';

            pts.forEach(pt => {
                const option = document.createElement('option');
                option.value = pt.id;
                option.textContent = `${pt.first_name} ${pt.last_name}`;
                select.appendChild(option);
            });
        });
    } catch (error) {
        console.error('Load PTs error:', error);
        showAlert('Failed to load PT list', 'danger');
    }
}

// Load Clinic list
async function loadClinicList() {
    try {
        const token = getCookie('authToken');
        const response = await fetch('/api/clinics', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Failed to load clinics');

        const clinics = await response.json();

        // Populate clinic dropdowns
        const clinicSelects = [document.getElementById('appointmentClinic'), document.getElementById('filterClinic')];
        clinicSelects.forEach(select => {
            if (!select) return;

            clinics.forEach(clinic => {
                const option = document.createElement('option');
                option.value = clinic.id;
                option.textContent = clinic.name;
                select.appendChild(option);
            });
        });
    } catch (error) {
        console.error('Load clinics error:', error);
        showAlert('Failed to load clinic list', 'danger');
    }
}

// Load appointments (FullCalendar JSON Feed)
async function loadAppointments(fetchInfo, successCallback, failureCallback) {
    try {
        const token = getCookie('authToken');
        // console.log('Loading appointments for range:', fetchInfo.start, fetchInfo.end); // DEBUG

        // Build query parameters
        const params = new URLSearchParams();

        // Get filters
        const ptFilter = document.getElementById('filterPT').value;
        const clinicFilter = document.getElementById('filterClinic').value;
        const statusFilter = document.getElementById('filterStatus').value;

        if (ptFilter) params.append('pt_id', ptFilter);
        if (clinicFilter) params.append('clinic_id', clinicFilter);
        if (statusFilter) params.append('status', statusFilter);

        // Get date range from FullCalendar's fetchInfo
        if (fetchInfo) {
            params.append('start_date', moment(fetchInfo.start).format('YYYY-MM-DD'));
            
            // FIX: FullCalendar's `end` date is exclusive. 
            // We subtract 1 day to get the *inclusive* end date for the API query.
            const endDate = moment(fetchInfo.end).subtract(1, 'day').format('YYYY-MM-DD');
            params.append('end_date', endDate);
            // console.log('Fetching with params:', params.toString()); // DEBUG
        }

        const response = await fetch(`/api/appointments?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
             // console.error('Failed to load appointments, status:', response.status); // DEBUG
             throw new Error('Failed to load appointments');
        }

        const rawAppointments = await response.json();
        allAppointments = rawAppointments.map(apt => {
            const appointmentDate = normalizeDate(apt.appointment_date);
            const startTime = normalizeTime(apt.start_time);
            const endTime = normalizeTime(apt.end_time);
            const startDateTime = buildDateTime(appointmentDate, startTime);
            const endDateTime = buildDateTime(appointmentDate, endTime);
            const normalizedWalkInName = apt.walk_in_name ? apt.walk_in_name.trim() : '';
            const fallbackName = apt.booking_type === 'WALK_IN'
                ? (normalizedWalkInName || 'Walk-in visitor')
                : [apt.first_name, apt.last_name].filter(Boolean).join(' ').trim();
            const patientName = (apt.patient_name || fallbackName || 'Unknown patient').trim();
            const ptName = (apt.pt_name || 'Unassigned PT').trim();

            return {
                ...apt,
                booking_type: apt.booking_type || 'OLD_PATIENT',
                walk_in_name: normalizedWalkInName,
                walk_in_phone: apt.walk_in_phone || '',
                walk_in_id: apt.walk_in_id || (apt.booking_type === 'WALK_IN' && apt.id ? `W${String(apt.id).padStart(6, '0')}` : ''),
                appointment_date: appointmentDate,
                start_time: startTime,
                end_time: endTime,
                start_datetime: startDateTime,
                end_datetime: endDateTime,
                patient_name: patientName,
                pt_name: ptName,
                clinic_name: apt.clinic_name || 'Unknown clinic',
                created_by_name: apt.created_by_name || '',
                cancelled_by_name: apt.cancelled_by_name || ''
            };
        });
        // console.log('Appointments loaded:', allAppointments); // DEBUG

        // Calculate quick stats
        calculateQuickStats(allAppointments);
        renderUpcomingAppointments(allAppointments);

        // Convert to FullCalendar events
        const events = allAppointments.map(apt => ({
            id: apt.id,
            title: `${apt.patient_name} • ${apt.pt_name}`,
            start: apt.start_datetime,
            end: apt.end_datetime,
            backgroundColor: getStatusColor(apt.status),
            borderColor: getStatusColor(apt.status),
            classNames: [`appointment-status-${apt.status}`],
            extendedProps: {
                appointment: apt
            }
        }));

        // Pass the formatted events to FullCalendar
        successCallback(events);

    } catch (error) {
        console.error('Load appointments error:', error);
        showAlert('Failed to load appointments', 'danger');
        // Tell FullCalendar about the failure
        if (failureCallback) failureCallback(error);
    }
}

// Get color for appointment status
function getStatusColor(status) {
    const colors = {
        'SCHEDULED': '#0d6efd',
        'COMPLETED': '#198754',
        'CANCELLED': '#6c757d',
        'NO_SHOW': '#dc3545'
    };
    return colors[status] || '#6c757d';
}

// Show booking modal
function showBookingModal() {
    if (!canManageAppointments) {
        showAlert('You do not have permission to create appointments.', 'warning');
        return;
    }
    const modalEl = document.getElementById('bookingModal');
    const form = document.getElementById('appointmentForm');

    if (!modalEl || !form) {
        console.error('Booking modal elements are missing from the page.');
        return;
    }
    currentAppointmentId = null;
    form.reset();
    clearPatientSelection();
    resetWalkInFields();

    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.textContent = 'New Appointment';

    const searchResults = document.getElementById('patientSearchResults');
    if (searchResults) searchResults.style.display = 'none';

    const conflictWarning = document.getElementById('conflictWarning');
    if (conflictWarning) conflictWarning.style.display = 'none';

    updateAutoCreatePNVisibility();

    // Hide linked PN info when creating new appointment
    const linkedPNInfo = document.getElementById('linkedPNInfo');
    if (linkedPNInfo) linkedPNInfo.style.display = 'none';

    const modal = new bootstrap.Modal(modalEl);

    // Add focus management for accessibility
    if (window.A11y && window.A11y.manageFocusForModal) {
        window.A11y.manageFocusForModal(modalEl, document.activeElement);
    }
    modal.show();
}

// Search patients
async function searchPatients() {
    if (currentBookingType !== 'OLD_PATIENT') {
        showAlert('Switch to "Existing patient" mode to search registered records.', 'info');
        return;
    }

    const searchTerm = document.getElementById('patientSearch').value.trim();

    if (searchTerm.length < 2) {
        showAlert('Please enter at least 2 characters to search', 'warning');
        return;
    }

    try {
        const token = getCookie('authToken');
        const response = await fetch(`/api/patients/search?q=${encodeURIComponent(searchTerm)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Search failed');

        const patients = await response.json();

        const resultsDiv = document.getElementById('patientSearchResults');
        resultsDiv.innerHTML = '';

        if (patients.length === 0) {
            resultsDiv.innerHTML = '<div class="p-3 text-muted">No patients found</div>';
        } else {
            patients.forEach(patient => {
                const div = document.createElement('div');
                div.className = 'patient-search-result';
                div.innerHTML = `
                    <strong>${patient.first_name} ${patient.last_name}</strong><br>
                    <small>HN: ${patient.hn} | PT: ${patient.pt_number || 'N/A'} | DOB: ${moment(patient.dob).format('DD/MM/YYYY')}</small>
                `;
                div.onclick = () => selectPatient(patient);
                resultsDiv.appendChild(div);
            });
        }

        resultsDiv.style.display = 'block';

    } catch (error) {
        console.error('Search patients error:', error);
        showAlert('Failed to search patients', 'danger');
    }
}

// Select patient from search results
function selectPatient(patient) {
    setBookingType('OLD_PATIENT', { keepWalkInFields: false, keepPatientSelection: true });

    document.getElementById('selectedPatientId').value = patient.id;
    document.getElementById('selectedPatientDisplay').textContent =
        `${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)} (HN: ${escapeHtml(patient.hn)})`;
    document.getElementById('selectedPatientInfo').style.display = 'block';
    document.getElementById('patientSearchResults').style.display = 'none';
    document.getElementById('patientSearch').value = '';

    // Load patient's active courses
    loadPatientCourses(patient.id);

    updateAutoCreatePNVisibility();
}

// Load patient's active courses
async function loadPatientCourses(patientId) {
    const courseSection = document.getElementById('courseSection');
    const courseSelect = document.getElementById('appointmentCourse');

    if (!courseSection || !courseSelect) {
        return;
    }

    try {
        const token = getCookie('authToken');
        const response = await fetch(`/api/courses/patient/${patientId}/active`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error('Failed to load courses');
        }

        const data = await response.json();

        // Clear existing options
        courseSelect.innerHTML = '<option value="">No course (Pay per session)</option>';

        if (data.has_active_courses && data.courses.length > 0) {
            data.courses.forEach(course => {
                const option = document.createElement('option');
                option.value = course.id;
                option.textContent = `${course.course_code} - ${course.course_name} (${course.remaining_sessions} sessions left)`;
                courseSelect.appendChild(option);
            });
            courseSection.style.display = 'block';
        } else {
            courseSection.style.display = 'none';
        }
    } catch (error) {
        console.error('Load courses error:', error);
        // Hide course section if error
        if (courseSection) courseSection.style.display = 'none';
    }
}

// Set duration (quick select buttons)
function setDuration(minutes) {
    const startTime = document.getElementById('appointmentStartTime').value;

    if (!startTime) {
        showAlert('Please select start time first', 'warning');
        return;
    }

    const [hours, mins] = startTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(hours, mins, 0);

    const endDate = new Date(startDate.getTime() + minutes * 60000);
    const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;

    document.getElementById('appointmentEndTime').value = endTime;
    checkConflicts();
}

// Check for time conflicts
async function checkConflicts() {
    const ptId = document.getElementById('appointmentPT').value;
    const date = document.getElementById('appointmentDate').value;
    const startTime = document.getElementById('appointmentStartTime').value;
    const endTime = document.getElementById('appointmentEndTime').value;

    if (!ptId || !date || !startTime || !endTime) {
        return; // Not enough info to check
    }

    try {
        const token = getCookie('authToken');
        const response = await fetch('/api/appointments/check-conflict', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pt_id: ptId,
                appointment_date: date,
                start_time: startTime,
                end_time: endTime,
                exclude_appointment_id: currentAppointmentId
            })
        });

        if (!response.ok) throw new Error('Conflict check failed');

        const result = await response.json();

        const warningDiv = document.getElementById('conflictWarning');
        if (result.hasConflict) {
            const conflictList = result.conflicts.map(c =>
                `${c.patient_name} (${c.start_time} - ${c.end_time})`
            ).join(', ');

            document.getElementById('conflictMessage').textContent =
                `This time slot conflicts with: ${conflictList}`;
            warningDiv.style.display = 'block';
        } else {
            warningDiv.style.display = 'none';
        }

    } catch (error) {
        console.error('Check conflict error:', error);
    }
}

// Save appointment
async function saveAppointment() {
    if (!canManageAppointments) {
        showAlert('You do not have permission to modify appointments.', 'warning');
        return;
    }
    const patientIdInput = document.getElementById('selectedPatientId');
    const patientId = patientIdInput ? patientIdInput.value : '';
    const ptId = document.getElementById('appointmentPT').value;
    const clinicId = document.getElementById('appointmentClinic').value;
    const date = document.getElementById('appointmentDate').value;
    const startTime = document.getElementById('appointmentStartTime').value;
    const endTime = document.getElementById('appointmentEndTime').value;
    const bookingType = currentBookingType;
    const walkInNameInput = document.getElementById('walkInName');
    const walkInPhoneInput = document.getElementById('walkInPhone');
    const walkInName = walkInNameInput ? walkInNameInput.value.trim() : '';
    const walkInPhone = walkInPhoneInput ? walkInPhoneInput.value.trim() : '';

    // Validation
    if (bookingType === 'OLD_PATIENT') {
        if (!patientId) {
            showAlert('Please select a patient', 'warning');
            return;
        }
    } else if (!walkInName) {
        showAlert('Please enter the walk-in visitor name', 'warning');
        return;
    }
    if (!ptId || !clinicId || !date || !startTime || !endTime) {
        showAlert('Please fill in all required fields', 'warning');
        return;
    }

    // Check if there's a conflict warning
    if (document.getElementById('conflictWarning').style.display !== 'none') {
        if (!confirm('There is a time conflict. Do you want to proceed anyway?')) {
            return;
        }
    }

    const appointmentData = {
        pt_id: ptId,
        clinic_id: clinicId,
        appointment_date: date,
        start_time: startTime,
        end_time: endTime,
        appointment_type: document.getElementById('appointmentType').value,
        reason: document.getElementById('appointmentReason').value,
        notes: document.getElementById('appointmentNotes').value
    };

    if (bookingType === 'OLD_PATIENT') {
        appointmentData.booking_type = 'OLD_PATIENT';
        appointmentData.patient_id = patientId;
        appointmentData.walk_in_name = null;
        appointmentData.walk_in_phone = null;

        // Add course_id if selected
        const courseSelect = document.getElementById('appointmentCourse');
        if (courseSelect && courseSelect.value) {
            appointmentData.course_id = parseInt(courseSelect.value);
        }
    } else {
        appointmentData.booking_type = 'WALK_IN';
        appointmentData.patient_id = null;
        appointmentData.walk_in_name = walkInName;
        appointmentData.walk_in_phone = walkInPhone || null;
    }

    // Add auto_create_pn flag if checkbox is checked (only for new appointments)
    if (!currentAppointmentId && bookingType === 'OLD_PATIENT') {
        const autoCreatePN = document.getElementById('autoCreatePN');
        if (autoCreatePN && autoCreatePN.checked) {
            appointmentData.auto_create_pn = true;
        }
    }

    try {
        const token = getCookie('authToken');
        const url = currentAppointmentId
            ? `/api/appointments/${currentAppointmentId}`
            : '/api/appointments';
        const method = currentAppointmentId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(appointmentData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save appointment');
        }

        const result = await response.json();

        // Show success message with PN case info if created
        let successMessage = `Appointment ${currentAppointmentId ? 'updated' : 'created'} successfully!`;
        if (result.pn_case_id && result.auto_created_pn) {
            successMessage += ` PN case ${result.pn_code} created automatically.`;
        }

        showAlert(successMessage, 'success');

        // Close modal and refresh events
        const modalEl = document.getElementById('bookingModal');
        const modalInstance = modalEl ? bootstrap.Modal.getInstance(modalEl) : null;
        if (modalInstance) {
            modalInstance.hide();
        }

        if (currentAppointmentId) {
            removeEventFromCalendar(currentAppointmentId);
        }

        await refreshCalendar();
        currentAppointmentId = null;

    } catch (error) {
        console.error('Save appointment error:', error);
        showAlert(error.message, 'danger');
    }
}

// View appointment details
async function viewAppointmentDetails(appointmentId) {
    const appointment = allAppointments.find(a => a.id === parseInt(appointmentId));

    // FIX: Add check and alert if appointment is not found
    if (!appointment) {
        showAlert('Appointment not found or data is still loading.', 'danger');
        console.error('Could not find appointment with ID:', appointmentId, 'in', allAppointments);
        return;
    }

    currentAppointmentId = parseInt(appointmentId);

    const statusLabel = formatStatusLabel(appointment.status);
    const startMoment = moment(appointment.start_datetime || `${appointment.appointment_date}T${appointment.start_time}`);
    const endMoment = moment(appointment.end_datetime || `${appointment.appointment_date}T${appointment.end_time}`);
    const createdMoment = appointment.created_at ? moment(appointment.created_at) : null;
    const updatedMoment = appointment.updated_at ? moment(appointment.updated_at) : null;
    const cancelledMoment = appointment.cancelled_at ? moment(appointment.cancelled_at) : null;

    const isWalkIn = appointment.booking_type === 'WALK_IN';
    const bookingLabel = isWalkIn ? 'Walk-in' : 'Existing patient';
    const walkInDisplayName = appointment.walk_in_name || appointment.patient_name;
    const patientInfoHtml = isWalkIn
        ? `
            <p><strong>Walk-in name:</strong> ${escapeHtml(walkInDisplayName)}</p>
            ${appointment.walk_in_id ? `<p><strong>Walk-in ID:</strong> ${escapeHtml(appointment.walk_in_id)}</p>` : ''}
            ${appointment.walk_in_phone ? `<p><strong>Contact:</strong> ${escapeHtml(appointment.walk_in_phone)}</p>` : ''}
        `
        : `
            <p><strong>Patient:</strong> ${escapeHtml(appointment.patient_name)}</p>
            ${appointment.hn ? `<p><strong>HN:</strong> ${escapeHtml(appointment.hn)}</p>` : ''}
            ${appointment.pt_number ? `<p><strong>PT Number:</strong> ${escapeHtml(appointment.pt_number)}</p>` : ''}
        `;

    const pnCaseHtml = appointment.pn_case_id && appointment.pn_code ? `
        <div class="alert alert-info mt-3">
            <strong><i class="bi bi-file-earmark-medical me-2"></i>Linked PN Case:</strong> ${escapeHtml(appointment.pn_code)}
            ${appointment.pn_status ? `<span class="badge bg-primary ms-2">${escapeHtml(appointment.pn_status)}</span>` : ''}
            ${appointment.auto_created_pn ? '<small class="d-block mt-1 text-muted">Auto-created with this appointment</small>' : ''}
        </div>
    ` : '';

    // Course information display
    const courseHtml = appointment.course_id && appointment.course_code ? `
        <div class="alert alert-success mt-3">
            <strong><i class="bi bi-journal-check me-2"></i>Course Package:</strong> ${escapeHtml(appointment.course_name || appointment.course_code)}
            <span class="badge bg-success ms-2">${escapeHtml(appointment.course_code)}</span>
            ${appointment.course_remaining_sessions !== undefined ?
                `<div class="mt-2">
                    <small class="text-muted">Sessions remaining: <strong>${appointment.course_remaining_sessions}</strong></small>
                    ${appointment.status === 'SCHEDULED' ?
                        '<div class="mt-1"><small class="text-warning"><i class="bi bi-info-circle"></i> Completing this appointment will use 1 session from this course</small></div>' :
                        appointment.status === 'COMPLETED' ?
                        '<div class="mt-1"><small class="text-success"><i class="bi bi-check-circle"></i> 1 session was used from this course</small></div>' :
                        appointment.status === 'CANCELLED' ?
                        '<div class="mt-1"><small class="text-info"><i class="bi bi-arrow-counterclockwise"></i> Session returned to course</small></div>' :
                        ''}
                </div>` :
                ''}
        </div>
    ` : '';

    const detailsHtml = `
        <div class="row">
            <div class="col-md-6">
                ${patientInfoHtml}
            </div>
            <div class="col-md-6">
                <p><strong>PT:</strong> ${escapeHtml(appointment.pt_name)}</p>
                <p><strong>Clinic:</strong> ${escapeHtml(appointment.clinic_name)}</p>
                <p><strong>Booking type:</strong> ${bookingLabel}</p>
                <p><strong>Status:</strong> <span class="badge bg-${getStatusBadge(appointment.status)}">${statusLabel}</span></p>
            </div>
        </div>
        ${pnCaseHtml}
        ${courseHtml}
        <hr>
        <div class="row">
            <div class="col-md-12">
                <p><strong>Date:</strong> ${moment(appointment.appointment_date).format('dddd, MMMM DD, YYYY')}</p>
                <p><strong>Time:</strong> ${startMoment.format('HH:mm')} - ${endMoment.format('HH:mm')}</p>
                ${appointment.appointment_type ? `<p><strong>Type:</strong> ${escapeHtml(appointment.appointment_type)}</p>` : ''}
                ${appointment.reason ? `<p><strong>Reason:</strong> ${escapeHtml(appointment.reason)}</p>` : ''}
                ${appointment.notes ? `<p><strong>Notes:</strong> ${escapeHtml(appointment.notes)}</p>` : ''}
                ${appointment.created_by_name ? `<p><strong>Created by:</strong> ${appointment.created_by_name}</p>` : ''}
                ${createdMoment ? `<p><strong>Created at:</strong> ${createdMoment.format('DD MMM YYYY HH:mm')}</p>` : ''}
                ${updatedMoment ? `<p><strong>Last updated:</strong> ${updatedMoment.format('DD MMM YYYY HH:mm')}</p>` : ''}
            </div>
        </div>
        ${appointment.cancellation_reason ? `
            <hr>
            <div class="alert alert-warning">
                <strong>Cancellation Reason:</strong> ${escapeHtml(appointment.cancellation_reason)}<br>
                ${appointment.cancelled_by_name ? `<span>Cancelled by: ${appointment.cancelled_by_name}</span><br>` : ''}
                ${cancelledMoment ? `<span>Cancelled at: ${cancelledMoment.format('DD MMM YYYY HH:mm')}</span>` : ''}
            </div>
        ` : ''}
    `;

    document.getElementById('appointmentDetails').innerHTML = detailsHtml;

    const modal = new bootstrap.Modal(document.getElementById('viewAppointmentModal'));

    // Add focus management for accessibility
    if (window.A11y && window.A11y.manageFocusForModal) {
        window.A11y.manageFocusForModal(document.getElementById("viewAppointmentModal"), document.activeElement);
    }
    modal.show();
}

// Get badge class for status
function getStatusBadge(status) {
    const badges = {
        'SCHEDULED': 'primary',
        'COMPLETED': 'success',
        'CANCELLED': 'secondary',
        'NO_SHOW': 'danger'
    };
    return badges[status] || 'secondary';
}

// Reschedule appointment
function rescheduleAppointment() {
    if (!canManageAppointments) {
        showAlert('You do not have permission to reschedule appointments.', 'warning');
        return;
    }
    const appointment = allAppointments.find(a => Number(a.id) === Number(currentAppointmentId));

    if (!appointment) return;

    // Close view modal
    bootstrap.Modal.getInstance(document.getElementById('viewAppointmentModal')).hide();

    // Open booking modal with data
    showBookingModal();
    currentAppointmentId = Number(appointment.id);

    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.textContent = 'Reschedule Appointment';

    setBookingType(appointment.booking_type === 'WALK_IN' ? 'WALK_IN' : 'OLD_PATIENT', {
        keepPatientSelection: appointment.booking_type !== 'WALK_IN',
        keepWalkInFields: appointment.booking_type === 'WALK_IN'
    });

    if (appointment.booking_type === 'WALK_IN') {
        clearPatientSelection();
        const walkInNameInput = document.getElementById('walkInName');
        if (walkInNameInput) walkInNameInput.value = appointment.walk_in_name || '';
        const walkInPhoneInput = document.getElementById('walkInPhone');
        if (walkInPhoneInput) walkInPhoneInput.value = appointment.walk_in_phone || '';
    } else {
        const selectedIdInput = document.getElementById('selectedPatientId');
        if (selectedIdInput) selectedIdInput.value = appointment.patient_id || '';
        const selectedDisplay = document.getElementById('selectedPatientDisplay');
        if (selectedDisplay) {
            const hnDisplay = appointment.hn ? ` (HN: ${appointment.hn})` : '';
            selectedDisplay.textContent = `${appointment.patient_name}${hnDisplay}`;
        }
        const selectedInfo = document.getElementById('selectedPatientInfo');
        if (selectedInfo) selectedInfo.style.display = appointment.patient_id ? 'block' : 'none';

        // Show linked PN case info if exists
        const linkedPNInfo = document.getElementById('linkedPNInfo');
        const linkedPNCodeDisplay = document.getElementById('linkedPNCodeDisplay');
        if (linkedPNInfo && linkedPNCodeDisplay && appointment.pn_case_id && appointment.pn_code) {
            linkedPNCodeDisplay.textContent = `${appointment.pn_code} (Status: ${appointment.pn_status || 'N/A'})`;
            linkedPNInfo.style.display = 'block';
        } else if (linkedPNInfo) {
            linkedPNInfo.style.display = 'none';
        }
    }

    updateAutoCreatePNVisibility();

    document.getElementById('appointmentPT').value = appointment.pt_id;
    document.getElementById('appointmentClinic').value = appointment.clinic_id;
    document.getElementById('appointmentDate').value = appointment.appointment_date;
    document.getElementById('appointmentStartTime').value = formatTimeForInput(appointment.start_time);
    document.getElementById('appointmentEndTime').value = formatTimeForInput(appointment.end_time);
    document.getElementById('appointmentType').value = appointment.appointment_type || '';
    document.getElementById('appointmentReason').value = appointment.reason || '';
    document.getElementById('appointmentNotes').value = appointment.notes || '';
}

// Mark appointment as completed (with PN case sync and PT Assessment for non-CL001)
async function markAsCompleted() {
    if (!canManageAppointments) {
        showAlert('You do not have permission to update appointments.', 'warning');
        return;
    }

    // Get appointment data to check clinic and PN case
    const appointment = allAppointments.find(a => Number(a.id) === Number(currentAppointmentId));
    if (!appointment) {
        showAlert('Appointment data not found', 'danger');
        return;
    }

    // Check if this appointment uses a course
    const hasCourse = appointment.course_id && appointment.course_code;
    const courseWarning = hasCourse
        ? `\n\nNote: This will use 1 session from course "${appointment.course_name || appointment.course_code}" (${appointment.course_remaining_sessions || 0} sessions remaining).`
        : '';

    // Check if this appointment has a linked PN case
    if (!appointment.pn_case_id) {
        // No PN case linked - just mark as completed
        if (!confirm(`Mark this appointment as completed?${courseWarning}`)) return;
        await completeAppointmentSimple();
        return;
    }

    // Has linked PN case - check clinic from appointment data (no API call needed)
    const isCL001 = appointment.clinic_code === 'CL001';

    console.log('=== APPOINTMENT COMPLETION CHECK ===');
    console.log('Appointment ID:', currentAppointmentId);
    console.log('Clinic Code:', appointment.clinic_code);
    console.log('Clinic Name:', appointment.clinic_name);
    console.log('Is CL001:', isCL001);
    console.log('Has PN case:', appointment.pn_case_id);

    if (isCL001) {
        // CL001 clinic - no PT assessment needed
        if (!confirm(`Mark this appointment as completed?\n\nThis will accept the linked PN case.${courseWarning}`)) return;
        await completeAppointmentSimple();
    } else {
        // Non-CL001 clinic - show PT Assessment modal
        showPTAssessmentModal(currentAppointmentId, courseWarning);
    }
}

// Complete appointment without PT assessment (for CL001 or no PN case)
async function completeAppointmentSimple() {
    try {
        // Get appointment data to check for course
        const appointment = allAppointments.find(a => Number(a.id) === Number(currentAppointmentId));
        const hasCourse = appointment && appointment.course_id && appointment.course_code;

        const token = getCookie('authToken');
        const response = await fetch(`/api/appointments/${currentAppointmentId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'COMPLETED' })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update status');
        }

        const successMessage = hasCourse
            ? 'Appointment marked as completed. Course session used.'
            : 'Appointment marked as completed';
        showAlert(successMessage, 'success');
        bootstrap.Modal.getInstance(document.getElementById('viewAppointmentModal')).hide();
        allAppointments = allAppointments.map(apt => {
            if (Number(apt.id) === Number(currentAppointmentId)) {
                return { ...apt, status: 'COMPLETED' };
            }
            return apt;
        });
        calculateQuickStats(allAppointments);
        renderUpcomingAppointments(allAppointments);
        removeEventFromCalendar(currentAppointmentId);
        await refreshCalendar();
        currentAppointmentId = null;

        // Broadcast instant sync to dashboard
        broadcastSync('appointment-updated');

    } catch (error) {
        console.error('Mark completed error:', error);
        showAlert(error.message || 'Failed to update appointment status', 'danger');
    }
}

// Show PT Assessment Modal for non-CL001 appointments
function showPTAssessmentModal(appointmentId, courseWarning = '') {
    const courseNotice = courseWarning ? `<div class="alert alert-warning">${escapeHtml(courseWarning)}</div>` : '';
    const modalHtml = `
        <div class="modal fade" id="ptAssessmentModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">PT Assessment Information</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${courseNotice}
                        <p class="text-muted">Please complete the PT assessment to accept this case:</p>
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
                        <button type="button" class="btn btn-primary" onclick="submitPTAssessmentForAppointment(${appointmentId})">Complete Appointment</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existing = document.getElementById('ptAssessmentModal');
    if (existing) existing.remove();

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Initialize pain score slider
    const painScoreInput = document.getElementById('pt_pain_score');
    const painScoreValue = document.getElementById('pain_score_value');
    painScoreInput.addEventListener('input', function() {
        painScoreValue.textContent = this.value;
    });

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('ptAssessmentModal'));

    // Add focus management for accessibility
    if (window.A11y && window.A11y.manageFocusForModal) {
        window.A11y.manageFocusForModal(document.getElementById("ptAssessmentModal"), document.activeElement);
    }
    modal.show();
}

// Submit PT Assessment and complete appointment
async function submitPTAssessmentForAppointment(appointmentId) {
    const diagnosis = document.getElementById('pt_diagnosis').value.trim();
    const chiefComplaint = document.getElementById('pt_chief_complaint').value.trim();
    const presentHistory = document.getElementById('pt_present_history').value.trim();
    const painScore = parseInt(document.getElementById('pt_pain_score').value);

    // Validation
    if (!diagnosis || !chiefComplaint || !presentHistory) {
        showAlert('Please fill in all required fields', 'warning');
        return;
    }

    try {
        // Get appointment data to check for course
        const appointment = allAppointments.find(a => Number(a.id) === Number(appointmentId));
        const hasCourse = appointment && appointment.course_id && appointment.course_code;

        const token = getCookie('authToken');
        const response = await fetch(`/api/appointments/${appointmentId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: 'COMPLETED',
                pt_diagnosis: diagnosis,
                pt_chief_complaint: chiefComplaint,
                pt_present_history: presentHistory,
                pt_pain_score: painScore
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to complete appointment');
        }

        const successMessage = hasCourse
            ? 'Appointment completed with PT assessment. Course session used.'
            : 'Appointment completed with PT assessment';
        showAlert(successMessage, 'success');

        // Hide both modals
        bootstrap.Modal.getInstance(document.getElementById('ptAssessmentModal')).hide();
        bootstrap.Modal.getInstance(document.getElementById('viewAppointmentModal')).hide();

        // Update local data
        allAppointments = allAppointments.map(apt => {
            if (Number(apt.id) === Number(appointmentId)) {
                return { ...apt, status: 'COMPLETED' };
            }
            return apt;
        });

        calculateQuickStats(allAppointments);
        renderUpcomingAppointments(allAppointments);
        removeEventFromCalendar(appointmentId);
        await refreshCalendar();
        currentAppointmentId = null;

        // Broadcast instant sync to dashboard
        broadcastSync('appointment-updated');

    } catch (error) {
        console.error('PT Assessment error:', error);
        showAlert(error.message || 'Failed to submit PT assessment', 'danger');
    }
}

// Cancel appointment
async function cancelAppointment() {
    if (!canManageAppointments) {
        showAlert('You do not have permission to cancel appointments.', 'warning');
        return;
    }

    // Get appointment data to check for course
    const appointment = allAppointments.find(a => Number(a.id) === Number(currentAppointmentId));
    const hasCourse = appointment && appointment.course_id && appointment.course_code;
    const courseReturnInfo = hasCourse
        ? `\n\nNote: 1 session will be returned to course "${appointment.course_name || appointment.course_code}".`
        : '';

    const reason = prompt(`Please enter cancellation reason:${courseReturnInfo}`);

    if (reason === null) return; // User cancelled

    try {
        const token = getCookie('authToken');
        const response = await fetch(`/api/appointments/${currentAppointmentId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cancellation_reason: reason })
        });

        if (!response.ok) throw new Error('Failed to cancel appointment');

        const successMessage = hasCourse
            ? 'Appointment cancelled successfully. Course session returned.'
            : 'Appointment cancelled successfully';
        showAlert(successMessage, 'success');
        bootstrap.Modal.getInstance(document.getElementById('viewAppointmentModal')).hide();
        allAppointments = allAppointments.filter(apt => Number(apt.id) !== Number(currentAppointmentId));
        calculateQuickStats(allAppointments);
        renderUpcomingAppointments(allAppointments);
        removeEventFromCalendar(currentAppointmentId);
        await refreshCalendar();
        currentAppointmentId = null;

    } catch (error) {
        console.error('Cancel appointment error:', error);
        showAlert('Failed to cancel appointment', 'danger');
    }
}

// Calculate quick stats (today, week, month)
function calculateQuickStats(appointments) {
    const now = moment();
    const todayStart = moment().startOf('day');
    const todayEnd = moment().endOf('day');
    const weekStart = moment().startOf('week');
    const weekEnd = moment().endOf('week');
    const monthStart = moment().startOf('month');
    const monthEnd = moment().endOf('month');

    let todayCount = 0;
    let weekCount = 0;
    let monthCount = 0;

    // Filter out CANCELLED appointments from stats
    const activeAppointments = appointments.filter(apt => apt.status !== 'CANCELLED');

    activeAppointments.forEach(apt => {
        const aptDate = moment(apt.appointment_date);

        if (aptDate.isBetween(todayStart, todayEnd, null, '[]')) {
            todayCount++;
        }
        if (aptDate.isBetween(weekStart, weekEnd, null, '[]')) {
            weekCount++;
        }
        if (aptDate.isBetween(monthStart, monthEnd, null, '[]')) {
            monthCount++;
        }
    });

    // Update UI
    document.getElementById('todayCount').textContent = todayCount;
    document.getElementById('weekCount').textContent = weekCount;
    document.getElementById('monthCount').textContent = monthCount;
}

function renderUpcomingAppointments(appointments) {
    const list = document.getElementById('upcomingAppointments');
    const emptyState = document.getElementById('upcomingEmptyState');
    const countBadge = document.getElementById('upcomingCount');

    if (!list || !emptyState || !countBadge) {
        return;
    }

    list.innerHTML = '';

    const now = moment();
    const horizon = moment().add(14, 'days').endOf('day');

    const upcoming = appointments
        .filter(apt => apt.status !== 'CANCELLED')
        .map(apt => {
            const startMoment = moment(apt.start_datetime || `${apt.appointment_date}T${apt.start_time}`);
            const endMoment = moment(apt.end_datetime || `${apt.appointment_date}T${apt.end_time}`);
            return { ...apt, startMoment, endMoment };
        })
        .filter(apt => apt.startMoment.isValid() && apt.startMoment.isSameOrAfter(now, 'minute'))
        .filter(apt => apt.startMoment.isSameOrBefore(horizon, 'minute'))
        .sort((a, b) => a.startMoment.valueOf() - b.startMoment.valueOf());

    countBadge.textContent = upcoming.length;

    if (upcoming.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    upcoming.slice(0, 5).forEach(apt => {
        const isWalkIn = apt.booking_type === 'WALK_IN';
        const displayName = isWalkIn
            ? (apt.walk_in_name || apt.patient_name || 'Walk-in visitor')
            : (apt.patient_name || 'Unknown patient');
        const bookingBadge = isWalkIn
            ? '<span class="badge rounded-pill text-bg-warning ms-2">Walk-in</span>'
            : '';
        const walkInDetails = isWalkIn && (apt.walk_in_id || apt.walk_in_phone)
            ? `<div class="text-muted small">${apt.walk_in_id ? `ID: ${escapeHtml(apt.walk_in_id)}` : ''}${apt.walk_in_id && apt.walk_in_phone ? ' · ' : ''}${apt.walk_in_phone ? `Tel: ${escapeHtml(apt.walk_in_phone)}` : ''}</div>`
            : '';

        const item = document.createElement('li');
        item.className = 'list-group-item p-3';
        item.innerHTML = `
            <div class="d-flex justify-content-between align-items-start gap-3">
                <div>
                    <div class="fw-semibold">${escapeHtml(displayName)}${bookingBadge}</div>
                    ${walkInDetails}
                    <div class="text-muted small">${apt.startMoment.format('ddd, DD MMM YYYY')} · ${apt.startMoment.format('HH:mm')} - ${apt.endMoment.format('HH:mm')}</div>
                    <div class="text-muted small">
                        <i class="bi bi-person-badge me-1"></i>${escapeHtml(apt.pt_name)}
                        <span class="mx-1">•</span>
                        <i class="bi bi-building me-1"></i>${escapeHtml(apt.clinic_name)}
                    </div>
                </div>
                <span class="badge rounded-pill bg-${getStatusBadge(apt.status)}">${formatStatusLabel(apt.status)}</span>
            </div>
        `;
        item.addEventListener('click', () => viewAppointmentDetails(apt.id));
        list.appendChild(item);
    });
}
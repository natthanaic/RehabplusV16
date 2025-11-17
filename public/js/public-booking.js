// Public Booking System - LANTAVAFIX Clinic (CL001)
// Fixed clinic ID - No need to select clinic
const CLINIC_ID = 1; // CL001 - LANTAVAFIX
const CLINIC_CODE = 'CL001';

// Booking state
let currentStep = 1;
let selectedDate = null;
let selectedTimeSlot = null;
let selectedPainZone = null;
let selectedPackage = null;
let bookingCalendarData = {}; // Stores booking counts per date

// Package recommendations based on pain zones
const packageRecommendations = {
    neck: [
        { id: 'neck-basic', name: 'Neck Pain Relief - Basic', description: 'Manual therapy and exercise for neck pain', duration: '45 min', icon: '🦴' },
        { id: 'neck-advanced', name: 'Neck Pain Relief - Advanced', description: 'Comprehensive treatment with manual therapy, ultrasound, and exercise', duration: '60 min', icon: '🦴' },
        { id: 'physical-exam', name: 'Physical Examination First', description: 'Let our therapist assess your condition first', duration: '30 min', icon: '🔍' }
    ],
    shoulder: [
        { id: 'shoulder-basic', name: 'Shoulder Rehabilitation - Basic', description: 'Manual therapy and strengthening exercises', duration: '45 min', icon: '💪' },
        { id: 'shoulder-sports', name: 'Shoulder Sports Injury', description: 'Specialized treatment for sports-related shoulder injuries', duration: '60 min', icon: '💪' },
        { id: 'physical-exam', name: 'Physical Examination First', description: 'Let our therapist assess your condition first', duration: '30 min', icon: '🔍' }
    ],
    back: [
        { id: 'back-basic', name: 'Back Pain Relief - Basic', description: 'Manual therapy and core strengthening', duration: '45 min', icon: '🔄' },
        { id: 'back-advanced', name: 'Back Pain Relief - Advanced', description: 'Comprehensive treatment with electrotherapy and exercise', duration: '60 min', icon: '🔄' },
        { id: 'physical-exam', name: 'Physical Examination First', description: 'Let our therapist assess your condition first', duration: '30 min', icon: '🔍' }
    ],
    knee: [
        { id: 'knee-basic', name: 'Knee Rehabilitation - Basic', description: 'Manual therapy and strengthening exercises', duration: '45 min', icon: '🦵' },
        { id: 'knee-sports', name: 'Knee Sports Injury', description: 'Specialized treatment for sports-related knee injuries', duration: '60 min', icon: '🦵' },
        { id: 'physical-exam', name: 'Physical Examination First', description: 'Let our therapist assess your condition first', duration: '30 min', icon: '🔍' }
    ],
    hip: [
        { id: 'hip-basic', name: 'Hip Pain Relief', description: 'Manual therapy and mobility exercises', duration: '45 min', icon: '🦿' },
        { id: 'hip-advanced', name: 'Hip Rehabilitation - Advanced', description: 'Comprehensive hip treatment and strengthening', duration: '60 min', icon: '🦿' },
        { id: 'physical-exam', name: 'Physical Examination First', description: 'Let our therapist assess your condition first', duration: '30 min', icon: '🔍' }
    ],
    ankle: [
        { id: 'ankle-basic', name: 'Ankle/Foot Rehabilitation', description: 'Manual therapy and stability exercises', duration: '45 min', icon: '🦶' },
        { id: 'ankle-sports', name: 'Ankle Sports Injury', description: 'Specialized treatment for ankle sprains and injuries', duration: '60 min', icon: '🦶' },
        { id: 'physical-exam', name: 'Physical Examination First', description: 'Let our therapist assess your condition first', duration: '30 min', icon: '🔍' }
    ],
    elbow: [
        { id: 'elbow-basic', name: 'Elbow Pain Relief', description: 'Manual therapy for tennis/golfer\'s elbow', duration: '45 min', icon: '💪' },
        { id: 'elbow-advanced', name: 'Elbow Rehabilitation - Advanced', description: 'Comprehensive treatment with ultrasound and exercise', duration: '60 min', icon: '💪' },
        { id: 'physical-exam', name: 'Physical Examination First', description: 'Let our therapist assess your condition first', duration: '30 min', icon: '🔍' }
    ],
    other: [
        { id: 'general-physio', name: 'General Physiotherapy', description: 'General assessment and treatment', duration: '45 min', icon: '➕' },
        { id: 'physical-exam', name: 'Physical Examination First', description: 'Let our therapist assess your condition first', duration: '30 min', icon: '🔍' }
    ]
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadBookingCalendar(); // Load booking data first
    initializeDatePicker();
    loadMyBookings();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // Step navigation buttons
    document.getElementById('btn-next-step1').addEventListener('click', () => goToStep(2));
    document.getElementById('btn-back-step2').addEventListener('click', () => goToStep(1));
    document.getElementById('btn-next-step2').addEventListener('click', () => goToStep(3));
    document.getElementById('btn-back-step3').addEventListener('click', () => goToStep(2));

    // Pain zone cards
    document.querySelectorAll('.pain-zone-card').forEach(card => {
        card.addEventListener('click', () => selectPainZone(card));
        card.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectPainZone(card);
            }
        });
    });

    // Form submission
    document.getElementById('booking-form').addEventListener('submit', handleBookingSubmit);
}

// Load booking calendar data
async function loadBookingCalendar() {
    try {
        const today = moment().format('YYYY-MM-DD');
        const endDate = moment().add(30, 'days').format('YYYY-MM-DD');

        console.log('Loading booking calendar from', today, 'to', endDate, 'for clinic', CLINIC_ID);

        const response = await fetch(`/api/public/booking-calendar?clinic_id=${CLINIC_ID}&start_date=${today}&end_date=${endDate}`);

        if (response.ok) {
            bookingCalendarData = await response.json();
            console.log('Booking calendar data loaded:', bookingCalendarData);
            console.log('Number of dates with bookings:', Object.keys(bookingCalendarData).length);
        } else {
            console.error('Failed to load booking calendar:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Error loading booking calendar:', error);
    }
}

// Initialize date picker
function initializeDatePicker() {
    flatpickr('#date-picker', {
        dateFormat: 'Y-m-d',
        minDate: 'today',
        maxDate: new Date().fp_incr(30),
        inline: true, // Show calendar inline
        disable: [
            function(date) {
                // Disable Sundays (0)
                return (date.getDay() === 0);
            }
        ],
        onChange: onDateChange,
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            // Get the date for this day element
            const dateStr = moment(dayElem.dateObj).format('YYYY-MM-DD');

            // Check if there are bookings on this date
            if (bookingCalendarData[dateStr]) {
                const bookingInfo = bookingCalendarData[dateStr];

                console.log(`📅 ${dateStr}: ${bookingInfo.total} bookings (Walk-in: ${bookingInfo.walkIn}, Patient: ${bookingInfo.patient})`);

                // Add booking indicator
                const indicator = document.createElement('div');
                indicator.className = 'booking-indicator';

                // Different colors based on booking count
                let colorClass = 'low';
                if (bookingInfo.total >= 6) {
                    colorClass = 'high';
                } else if (bookingInfo.total >= 3) {
                    colorClass = 'medium';
                }

                indicator.classList.add(colorClass);
                indicator.title = `${bookingInfo.total} booking(s) - Walk-in: ${bookingInfo.walkIn}, Patient: ${bookingInfo.patient}`;

                dayElem.appendChild(indicator);
                dayElem.classList.add('has-bookings');
            }
        }
    });
}

// Handle date change
function onDateChange(selectedDates) {
    if (selectedDates.length > 0) {
        selectedDate = moment(selectedDates[0]).format('YYYY-MM-DD');
        loadTimeSlots();
    }
}

// Load available time slots for selected date
async function loadTimeSlots() {
    if (!selectedDate) return;

    const container = document.getElementById('time-slots-container');
    const grid = document.getElementById('time-slots-grid');

    try {
        container.style.display = 'block';
        grid.innerHTML = '<div class="col-12 text-center"><div class="spinner-border"></div><p>Loading available slots...</p></div>';

        const response = await fetch(`/api/public/time-slots?clinic_id=${CLINIC_ID}&date=${selectedDate}`);

        if (response.ok) {
            const slots = await response.json();

            if (slots.length === 0) {
                grid.innerHTML = '<div class="col-12"><div class="alert alert-info text-center">No available time slots for this date. Please select another date.</div></div>';
                document.getElementById('btn-next-step1').disabled = true;
                return;
            }

            grid.innerHTML = slots.map(slot => `
                <div class="col-md-3 col-sm-4 col-6">
                    <div class="time-slot ${slot.available ? '' : 'disabled'}"
                         role="${slot.available ? 'button' : ''}"
                         tabindex="${slot.available ? '0' : '-1'}"
                         aria-label="Time slot ${slot.start_time} to ${slot.end_time}${slot.available ? ', available' : ', booked'}"
                         data-slot='${JSON.stringify(slot)}'
                         onclick="selectTimeSlot(this, ${slot.available})"
                         onkeypress="if(event.key==='Enter' || event.key===' ') { event.preventDefault(); selectTimeSlot(this, ${slot.available}); }">
                        <div><strong>${slot.start_time}</strong></div>
                        <div><small>${slot.end_time}</small></div>
                        ${slot.available ? '<small class="text-success">Available</small>' : '<small class="text-danger">Booked</small>'}
                    </div>
                </div>
            `).join('');
        } else {
            grid.innerHTML = '<div class="col-12"><div class="alert alert-danger text-center">Failed to load time slots</div></div>';
        }
    } catch (error) {
        console.error('Error loading time slots:', error);
        grid.innerHTML = '<div class="col-12"><div class="alert alert-danger text-center">Error loading time slots</div></div>';
    }
}

// Select time slot
function selectTimeSlot(element, available) {
    if (!available) return;

    // Remove previous selection
    document.querySelectorAll('.time-slot').forEach(slot => {
        slot.classList.remove('selected');
    });

    // Select this slot
    element.classList.add('selected');
    selectedTimeSlot = JSON.parse(element.dataset.slot);

    // Enable next button
    document.getElementById('btn-next-step1').disabled = false;
}

// Select pain zone
function selectPainZone(card) {
    const zone = card.dataset.zone;

    // Remove previous selection
    document.querySelectorAll('.pain-zone-card').forEach(c => {
        c.classList.remove('selected');
    });

    // Select this zone
    card.classList.add('selected');
    selectedPainZone = zone;

    // Load recommended packages
    loadRecommendedPackages(zone);
}

// Load recommended packages based on pain zone
function loadRecommendedPackages(zone) {
    const container = document.getElementById('packages-container');
    const list = document.getElementById('packages-list');

    const packages = packageRecommendations[zone] || packageRecommendations['other'];

    list.innerHTML = packages.map(pkg => `
        <div class="col-12">
            <div class="package-card"
                 data-package='${JSON.stringify(pkg)}'
                 role="button"
                 tabindex="0"
                 aria-label="Select ${pkg.name}"
                 onclick="selectPackage(this)"
                 onkeypress="if(event.key==='Enter' || event.key===' ') { event.preventDefault(); selectPackage(this); }">
                <div class="row align-items-center">
                    <div class="col-auto">
                        <div class="package-icon" aria-hidden="true">${pkg.icon}</div>
                    </div>
                    <div class="col">
                        <h5 class="mb-1">${pkg.name}</h5>
                        <p class="mb-1 text-muted">${pkg.description}</p>
                        <small class="text-muted"><i class="bi bi-clock" aria-hidden="true"></i> ${pkg.duration}</small>
                    </div>
                    <div class="col-auto">
                        <i class="bi bi-check-circle" aria-hidden="true" style="font-size: 1.5rem; display: none;"></i>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    container.style.display = 'block';

    // Scroll to packages
    setTimeout(() => {
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// Select package
function selectPackage(card) {
    // Remove previous selection
    document.querySelectorAll('.package-card').forEach(c => {
        c.classList.remove('selected');
        c.querySelector('.bi-check-circle').style.display = 'none';
    });

    // Select this package
    card.classList.add('selected');
    card.querySelector('.bi-check-circle').style.display = 'block';
    selectedPackage = JSON.parse(card.dataset.package);

    // Enable next button
    document.getElementById('btn-next-step2').disabled = false;
}

// Navigate to specific step
function goToStep(step) {
    // Validation
    if (step === 2 && !selectedTimeSlot) {
        showAlert('Please select a date and time slot first', 'warning');
        return;
    }

    if (step === 3 && !selectedPackage) {
        showAlert('Please select a service package', 'warning');
        return;
    }

    // Hide all steps
    document.querySelectorAll('.step-content').forEach(content => {
        content.classList.remove('active');
    });

    // Show target step
    document.getElementById(`step-${step}`).classList.add('active');

    // Update progress
    updateProgress(step);

    // Update summary if going to step 3
    if (step === 3) {
        updateBookingSummary();
    }

    currentStep = step;

    // Scroll to top
    document.querySelector('.booking-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Update progress indicators
function updateProgress(step) {
    document.querySelectorAll('.progress-step').forEach(progressStep => {
        const stepNum = parseInt(progressStep.dataset.step);
        progressStep.classList.remove('active', 'completed');

        if (stepNum < step) {
            progressStep.classList.add('completed');
        } else if (stepNum === step) {
            progressStep.classList.add('active');
        }
    });
}

// Update booking summary
function updateBookingSummary() {
    document.getElementById('summary-date').textContent = moment(selectedDate).format('DD/MM/YYYY');
    document.getElementById('summary-time').textContent = `${selectedTimeSlot.start_time} - ${selectedTimeSlot.end_time}`;
    document.getElementById('summary-service').textContent = selectedPackage.name;
}

// Handle booking submission
async function handleBookingSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('walk-in-name').value.trim();
    const phone = document.getElementById('walk-in-phone').value.trim();
    const reason = document.getElementById('reason').value.trim();

    // Validation
    if (!name || !phone) {
        showAlert('Please enter your name and phone number', 'warning');
        return;
    }

    if (!selectedTimeSlot) {
        showAlert('Please select a time slot', 'warning');
        return;
    }

    if (!selectedPackage) {
        showAlert('Please select a service', 'warning');
        return;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Booking...';

    try {
        const bookingData = {
            walk_in_name: name,
            walk_in_phone: phone,
            clinic_id: CLINIC_ID,
            appointment_date: selectedDate,
            start_time: selectedTimeSlot.start_time,
            end_time: selectedTimeSlot.end_time,
            reason: reason || `${selectedPainZone} - ${selectedPackage.name}`,
            appointment_type: selectedPackage.id,
            booking_type: 'WALK_IN'
        };

        const response = await fetch('/api/public/book-appointment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bookingData)
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('Appointment booked successfully!', 'success');

            // Reset form and state
            document.getElementById('booking-form').reset();
            selectedTimeSlot = null;
            selectedDate = null;
            selectedPainZone = null;
            selectedPackage = null;

            // Go back to step 1
            setTimeout(() => {
                goToStep(1);
                loadMyBookings();
            }, 2000);
        } else {
            console.error('Booking failed:', result);
            let errorMsg = result.error || 'Failed to book appointment';
            if (result.sqlMessage) {
                errorMsg += '\nSQL Error: ' + result.sqlMessage;
                console.error('SQL Error:', result.sqlMessage, 'Code:', result.code, 'State:', result.sqlState);
            }
            showAlert(errorMsg, 'danger');
        }
    } catch (error) {
        console.error('Booking error:', error);
        showAlert('Error booking appointment. Please try again.', 'danger');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-check-circle"></i> Confirm Booking';
    }
}

// Load user's existing bookings (by IP)
async function loadMyBookings() {
    try {
        const response = await fetch('/api/public/my-bookings');
        if (response.ok) {
            const bookings = await response.json();
            displayMyBookings(bookings);
        }
    } catch (error) {
        console.error('Error loading bookings:', error);
    }
}

// Display user's bookings
function displayMyBookings(bookings) {
    const card = document.getElementById('my-bookings-card');
    const list = document.getElementById('my-bookings-list');

    if (bookings.length === 0) {
        card.style.display = 'none';
        return;
    }

    card.style.display = 'block';
    list.innerHTML = bookings.map(booking => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="row align-items-center">
                    <div class="col-md-8">
                        <h6 class="mb-1"><i class="bi bi-person"></i> ${escapeHtml(booking.walk_in_name)}</h6>
                        <p class="mb-1 text-muted">
                            <i class="bi bi-calendar"></i> ${moment(booking.appointment_date).format('DD/MM/YYYY')}
                            <i class="bi bi-clock"></i> ${booking.start_time.substring(0, 5)} - ${booking.end_time.substring(0, 5)}<br>
                            <i class="bi bi-telephone"></i> ${escapeHtml(booking.walk_in_phone)}
                        </p>
                        <span class="badge bg-${getStatusColor(booking.status)}">${booking.status}</span>
                    </div>
                    <div class="col-md-4 text-end">
                        ${booking.status === 'SCHEDULED' || booking.status === 'CONFIRMED' ? `
                            <button class="btn btn-sm btn-danger" onclick="cancelBooking(${booking.id})">
                                <i class="bi bi-x-circle"></i> Cancel
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

// Get status badge color
function getStatusColor(status) {
    const colors = {
        'SCHEDULED': 'primary',
        'CONFIRMED': 'success',
        'IN_PROGRESS': 'info',
        'COMPLETED': 'secondary',
        'CANCELLED': 'danger',
        'NO_SHOW': 'warning'
    };
    return colors[status] || 'secondary';
}

// Cancel booking
async function cancelBooking(bookingId) {
    if (!confirm('Are you sure you want to cancel this appointment?')) {
        return;
    }

    try {
        const response = await fetch(`/api/public/cancel-appointment/${bookingId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('Appointment cancelled successfully', 'success');
            loadMyBookings();
        } else {
            showAlert(result.error || 'Failed to cancel appointment', 'danger');
        }
    } catch (error) {
        console.error('Cancel error:', error);
        showAlert('Error cancelling appointment', 'danger');
    }
}

// Show alert
function showAlert(message, type = 'info') {
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3" style="z-index: 9999; max-width: 500px;">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', alertHtml);

    setTimeout(() => {
        const alert = document.querySelector('.alert');
        if (alert) alert.remove();
    }, 5000);
}

// HTML escape function
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
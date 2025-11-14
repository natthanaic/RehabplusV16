/**
 * Patient Registration Duplicate Check
 * Handles PTHN (Patient Hospital Number) duplicate validation
 */

// Debounce function to avoid excessive API calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Check for duplicate HN
const checkDuplicateHN = debounce(async function() {
    const hnInput = document.getElementById('hn');
    const hn = hnInput.value.trim();
    const duplicateAlert = document.getElementById('duplicateAlert');
    const submitBtn = document.querySelector('button[type="submit"]');

    // Clear previous alerts if input is empty
    if (!hn) {
        if (duplicateAlert) {
            duplicateAlert.style.display = 'none';
        }
        hnInput.classList.remove('is-invalid', 'is-valid');
        if (submitBtn) {
            submitBtn.disabled = false;
        }
        return;
    }

    try {
        const token = getCookie('authToken');
        const response = await fetch(`/api/patients/check-duplicate/${encodeURIComponent(hn)}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.isDuplicate) {
            // Show error alert
            if (duplicateAlert) {
                duplicateAlert.innerHTML = `
                    <div class="alert alert-danger alert-dismissible fade show" role="alert">
                        <i class="bi bi-exclamation-circle me-2"></i>
                        <strong>Duplicate HN Found!</strong><br>
                        The HN "<strong>${data.existingPatient.hn}</strong>" is already in use by:
                        <ul class="mb-0 mt-2">
                            <li><strong>Patient Name:</strong> ${data.existingPatient.name}</li>
                            <li><strong>PT Number:</strong> ${data.existingPatient.pt_number}</li>
                            <li><strong>Patient ID:</strong> ${data.existingPatient.id}</li>
                        </ul>
                        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                    </div>
                `;
                duplicateAlert.style.display = 'block';
            }
            hnInput.classList.add('is-invalid');
            hnInput.classList.remove('is-valid');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.title = 'Cannot register duplicate HN. Please use a different HN.';
            }
        } else {
            // HN is available
            if (duplicateAlert) {
                duplicateAlert.innerHTML = `
                    <div class="alert alert-success alert-dismissible fade show" role="alert">
                        <i class="bi bi-check-circle me-2"></i>
                        <strong>HN Available!</strong> The HN "<strong>${hn}</strong>" is available for registration.
                        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                    </div>
                `;
                duplicateAlert.style.display = 'block';
            }
            hnInput.classList.add('is-valid');
            hnInput.classList.remove('is-invalid');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.title = '';
            }
        }
    } catch (error) {
        console.error('Error checking duplicate HN:', error);
        if (duplicateAlert) {
            duplicateAlert.innerHTML = `
                <div class="alert alert-warning alert-dismissible fade show" role="alert">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    <strong>Warning:</strong> Could not verify HN availability. Please try again.
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            `;
            duplicateAlert.style.display = 'block';
        }
    }
}, 500);

// Initialize duplicate check on page load
document.addEventListener('DOMContentLoaded', function() {
    const hnInput = document.getElementById('hn');

    if (hnInput) {
        // Add event listener for input changes
        hnInput.addEventListener('blur', checkDuplicateHN);
        hnInput.addEventListener('change', checkDuplicateHN);

        // Optional: Check on input with debounce (real-time validation)
        hnInput.addEventListener('input', checkDuplicateHN);
    }
});

// Helper function to get cookie
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

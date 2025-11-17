// app.js - Main Application Logic for PN-App Physiotherapy System
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const csv = require('csv-parser');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();


// add near the top, after `const app = express();`
const cookieParser = require('cookie-parser');

app.use(cookieParser());

// Configure multer for CSV file uploads
const uploadCSV = multer({ dest: 'uploads/' });
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));


// ========================================
// UTILITY FUNCTIONS
// ========================================

// Generate unique codes
const generatePTNumber = () => {
    const timestamp = moment().format('YYYYMMDDHHmmss');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `PT${timestamp}${random}`;
};

const generatePNCode = () => {
    const timestamp = moment().format('YYYYMMDDHHmmss');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `PN-${timestamp}-${random}`;
};

// Safe integer parsing with validation
const safeParseInt = (value, defaultValue = 0, min = null, max = null) => {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        return defaultValue;
    }
    if (min !== null && parsed < min) {
        return min;
    }
    if (max !== null && parsed > max) {
        return max;
    }
    return parsed;
};

// Validate pagination parameters
const validatePagination = (page, limit, maxLimit = 100) => {
    const validPage = safeParseInt(page, 1, 1);
    const validLimit = safeParseInt(limit, 20, 1, maxLimit);
    const offset = (validPage - 1) * validLimit;

    return {
        page: validPage,
        limit: validLimit,
        offset: offset
    };
};

// Validate date range
const validateDateRange = (fromDate, toDate) => {
    const errors = [];

    if (fromDate && !moment(fromDate, 'YYYY-MM-DD', true).isValid()) {
        errors.push('Invalid from_date format. Use YYYY-MM-DD');
    }

    if (toDate && !moment(toDate, 'YYYY-MM-DD', true).isValid()) {
        errors.push('Invalid to_date format. Use YYYY-MM-DD');
    }

    if (fromDate && toDate && moment(fromDate).isAfter(moment(toDate))) {
        errors.push('from_date must be before or equal to to_date');
    }

    return {
        valid: errors.length === 0,
        errors: errors
    };
};

// Hash password
const hashPassword = async (password) => {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
};

// Verify password
const verifyPassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

// Generate JWT token
const generateToken = (user) => {
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        clinic_id: user.clinic_id
    };
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

// ========================================
// NOTIFICATION SYSTEM
// ========================================

/**
 * Send LINE notification
 * @param {Object} db - Database connection
 * @param {string} eventType - Event type: 'newAppointment', 'appointmentCancelled', 'newPatient', 'paymentReceived'
 * @param {string} message - Message to send
 * @returns {Promise<boolean>} - Success status
 */
const sendLINENotification = async (db, eventType, message) => {
    try {
        // Get LINE settings from database
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'line' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('LINE notification: No settings configured');
            return false;
        }

        const lineConfig = JSON.parse(settings[0].setting_value);

        // Check if LINE is enabled
        if (!lineConfig.enabled || lineConfig.enabled === '0') {
            console.log('LINE notification: Service is disabled');
            return false;
        }

        // Check if event type is enabled
        let eventNotifications;
        if (typeof lineConfig.eventNotifications === 'string') {
            try {
                eventNotifications = JSON.parse(lineConfig.eventNotifications);
            } catch (e) {
                eventNotifications = {};
            }
        } else {
            eventNotifications = lineConfig.eventNotifications || {};
        }

        if (!eventNotifications[eventType]) {
            console.log(`LINE notification: Event type '${eventType}' is disabled`);
            return false;
        }

        // Validate required settings
        if (!lineConfig.accessToken) {
            console.error('LINE notification: Channel Access Token not configured');
            return false;
        }

        if (!lineConfig.targetId) {
            console.error('LINE notification: Target ID not configured');
            return false;
        }

        // Send LINE message via Messaging API
        const axios = require('axios');

        const response = await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
                to: lineConfig.targetId,
                messages: [
                    {
                        type: 'text',
                        text: message
                    }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${lineConfig.accessToken}`
                }
            }
        );

        if (response.status === 200) {
            console.log(`✅ LINE notification sent successfully for event: ${eventType}`);
            return true;
        } else {
            console.error(`LINE notification failed: Status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error('LINE notification error:', error.message);
        if (error.response) {
            console.error('LINE API error:', error.response.data);
        }
        return false;
    }
};

/**
 * Create Google Calendar event for appointment
 * @param {Object} db - Database connection
 * @param {Object} appointmentData - Appointment details
 * @returns {Promise<string|null>} - Google Calendar Event ID or null
 */
const createGoogleCalendarEvent = async (db, appointmentData) => {
    try {
        // Get Google Calendar settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('Google Calendar: No settings configured');
            return null;
        }

        const calendarConfig = JSON.parse(settings[0].setting_value);

        // Check if Google Calendar is enabled
        if (!calendarConfig.enabled || calendarConfig.enabled === '0') {
            console.log('Google Calendar: Service is disabled');
            return null;
        }

        // Validate required settings
        if (!calendarConfig.serviceAccountEmail || !calendarConfig.privateKey || !calendarConfig.calendarId) {
            console.error('Google Calendar: Missing required configuration');
            return null;
        }

        // Validate private key format
        const privateKey = calendarConfig.privateKey.trim();
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
            console.error('Google Calendar: Invalid private key format');
            return null;
        }

        // Import Google Calendar API
        const { google } = require('googleapis');

        // Process the private key - replace literal \n with actual newlines and trim
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
        }
        processedKey = processedKey.trim();

        // Create JWT client
        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar']
        );

        // Authorize
        await jwtClient.authorize();

        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        // Prepare event data
        const eventStartTime = new Date(`${appointmentData.appointment_date}T${appointmentData.start_time}`);
        const eventEndTime = new Date(`${appointmentData.appointment_date}T${appointmentData.end_time}`);

        const patientName = appointmentData.patient_name || appointmentData.walk_in_name || 'Walk-in Patient';
        const ptName = appointmentData.pt_name || 'PT';
        const clinicName = appointmentData.clinic_name || '';

        const event = {
            summary: `Appointment: ${patientName}`,
            description: `Patient: ${patientName}\nPhysiotherapist: ${ptName}\nClinic: ${clinicName}\n${appointmentData.reason ? `Reason: ${appointmentData.reason}` : ''}`,
            location: clinicName,
            start: {
                dateTime: eventStartTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            end: {
                dateTime: eventEndTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            attendees: [],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 30 },
                    { method: 'email', minutes: 1440 }, // 24 hours before
                ],
            },
        };

        // Add patient email if available and if sending invites is enabled
        console.log('📧 Email invite check:', {
            sendInvites: calendarConfig.sendInvites,
            sendInvitesType: typeof calendarConfig.sendInvites,
            patientEmail: appointmentData.patient_email,
            willSendInvite: calendarConfig.sendInvites === '1' && appointmentData.patient_email
        });

        if (calendarConfig.sendInvites === '1' && appointmentData.patient_email) {
            event.attendees.push({ email: appointmentData.patient_email });
            console.log('✅ Added patient email to calendar event attendees:', appointmentData.patient_email);
        } else {
            if (calendarConfig.sendInvites !== '1') {
                console.log('⚠️ Google Calendar invites are DISABLED in settings (sendInvites is not "1")');
            }
            if (!appointmentData.patient_email) {
                console.log('⚠️ No patient email provided for calendar invite');
            }
        }

        // Create event
        const sendUpdatesValue = calendarConfig.sendInvites === '1' ? 'all' : 'none';
        console.log('📅 Creating calendar event with sendUpdates:', sendUpdatesValue);

        const response = await calendar.events.insert({
            calendarId: calendarConfig.calendarId,
            resource: event,
            sendUpdates: sendUpdatesValue,
        });

        console.log(`✅ Google Calendar event created: ${response.data.id}`);
        if (event.attendees && event.attendees.length > 0) {
            console.log(`📨 Calendar invites sent to: ${event.attendees.map(a => a.email).join(', ')}`);
        } else {
            console.log('📭 No calendar invites sent (no attendees)');
        }
        return response.data.id;

    } catch (error) {
        console.error('Google Calendar create error:', error.message);
        if (error.response) {
            console.error('Google Calendar API error:', error.response.data);
        }
        return null;
    }
};

/**
 * Update Google Calendar event
 * @param {Object} db - Database connection
 * @param {string} eventId - Google Calendar Event ID
 * @param {Object} appointmentData - Updated appointment details
 * @returns {Promise<boolean>} - Success status
 */
const updateGoogleCalendarEvent = async (db, eventId, appointmentData) => {
    try {
        if (!eventId) return false;

        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) return false;

        const calendarConfig = JSON.parse(settings[0].setting_value);
        if (!calendarConfig.enabled || calendarConfig.enabled === '0') return false;

        if (!calendarConfig.privateKey) return false;

        // Process the private key
        const privateKey = calendarConfig.privateKey.trim();
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
        }
        processedKey = processedKey.trim();

        const { google } = require('googleapis');
        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar']
        );

        await jwtClient.authorize();
        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        const eventStartTime = new Date(`${appointmentData.appointment_date}T${appointmentData.start_time}`);
        const eventEndTime = new Date(`${appointmentData.appointment_date}T${appointmentData.end_time}`);

        const patientName = appointmentData.patient_name || appointmentData.walk_in_name || 'Walk-in Patient';
        const ptName = appointmentData.pt_name || 'PT';
        const clinicName = appointmentData.clinic_name || '';

        const event = {
            summary: `Appointment: ${patientName}`,
            description: `Patient: ${patientName}\nPhysiotherapist: ${ptName}\nClinic: ${clinicName}\n${appointmentData.reason ? `Reason: ${appointmentData.reason}` : ''}`,
            location: clinicName,
            start: {
                dateTime: eventStartTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            end: {
                dateTime: eventEndTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
        };

        await calendar.events.update({
            calendarId: calendarConfig.calendarId,
            eventId: eventId,
            resource: event,
            sendUpdates: calendarConfig.sendInvites === '1' ? 'all' : 'none',
        });

        console.log(`✅ Google Calendar event updated: ${eventId}`);
        return true;

    } catch (error) {
        console.error('Google Calendar update error:', error.message);
        return false;
    }
};

/**
 * Delete Google Calendar event
 * @param {Object} db - Database connection
 * @param {string} eventId - Google Calendar Event ID
 * @returns {Promise<boolean>} - Success status
 */
const deleteGoogleCalendarEvent = async (db, eventId) => {
    try {
        if (!eventId) return false;

        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) return false;

        const calendarConfig = JSON.parse(settings[0].setting_value);
        if (!calendarConfig.enabled || calendarConfig.enabled === '0') return false;

        if (!calendarConfig.privateKey) return false;

        // Process the private key
        const privateKey = calendarConfig.privateKey.trim();
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
        }
        processedKey = processedKey.trim();

        const { google } = require('googleapis');
        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar']
        );

        await jwtClient.authorize();
        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        await calendar.events.delete({
            calendarId: calendarConfig.calendarId,
            eventId: eventId,
            sendUpdates: calendarConfig.sendInvites === '1' ? 'all' : 'none',
        });

        console.log(`✅ Google Calendar event deleted: ${eventId}`);
        return true;

    } catch (error) {
        console.error('Google Calendar delete error:', error.message);
        return false;
    }
};

/**
 * Generate .ics calendar file content
 * @param {Object} appointmentData - Appointment details
 * @returns {string} ICS file content
 */
const generateICSFile = (appointmentData) => {
    try {
        // Format dates for ICS format (YYYYMMDDTHHMMSS)
        const formatICSDate = (dateStr, timeStr) => {
            const date = new Date(`${dateStr}T${timeStr}`);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${year}${month}${day}T${hours}${minutes}${seconds}`;
        };

        const startDateTime = formatICSDate(appointmentData.appointment_date, appointmentData.start_time);
        const endDateTime = formatICSDate(appointmentData.appointment_date, appointmentData.end_time);
        const now = formatICSDate(new Date().toISOString().split('T')[0], new Date().toTimeString().split(' ')[0]);

        // Create unique UID
        const uid = `appointment-${appointmentData.id}@rehabplus.com`;

        // Build description
        const description = [
            `Appointment at ${appointmentData.clinic_name}`,
            `Therapist: ${appointmentData.pt_name || 'To be assigned'}`,
            appointmentData.reason ? `Reason: ${appointmentData.reason}` : ''
        ].filter(Boolean).join('\\n');

        // Location
        const location = [
            appointmentData.clinic_name,
            appointmentData.clinic_address
        ].filter(Boolean).join(', ');

        // Generate ICS content
        const icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//RehabPlus//Appointment System//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:REQUEST',
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${now}`,
            `DTSTART:${startDateTime}`,
            `DTEND:${endDateTime}`,
            `SUMMARY:Appointment at ${appointmentData.clinic_name}`,
            `DESCRIPTION:${description}`,
            `LOCATION:${location}`,
            `STATUS:CONFIRMED`,
            `SEQUENCE:0`,
            `PRIORITY:5`,
            'BEGIN:VALARM',
            'TRIGGER:-PT30M',
            'DESCRIPTION:Appointment reminder',
            'ACTION:DISPLAY',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');

        return icsContent;
    } catch (error) {
        console.error('Error generating ICS file:', error);
        return null;
    }
};

/**
 * Send appointment confirmation email
 * @param {Object} db - Database connection
 * @param {number} appointmentId - Appointment ID
 * @param {string} recipientEmail - Email address to send to
 * @returns {Promise<boolean>} Success status
 */
const sendAppointmentConfirmationEmail = async (db, appointmentId, recipientEmail) => {
    try {
        if (!recipientEmail || !recipientEmail.includes('@')) {
            console.log('Email: No valid recipient email provided');
            return false;
        }

        // Get SMTP settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings
            WHERE setting_type = 'smtp' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('Email: No SMTP settings configured');
            return false;
        }

        const smtpConfig = JSON.parse(settings[0].setting_value);

        if (!smtpConfig.enabled || smtpConfig.enabled === '0') {
            console.log('Email: SMTP is disabled');
            return false;
        }

        // Get appointment details
        const [appointments] = await db.execute(`
            SELECT a.*,
                   COALESCE(a.walk_in_name, CONCAT(p.first_name, ' ', p.last_name)) as patient_name,
                   CONCAT(u.first_name, ' ', u.last_name) as pt_name,
                   c.name as clinic_name,
                   c.address as clinic_address,
                   c.phone as clinic_phone
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            LEFT JOIN users u ON a.pt_id = u.id
            LEFT JOIN clinics c ON a.clinic_id = c.id
            WHERE a.id = ?
        `, [appointmentId]);

        if (appointments.length === 0) {
            console.log('Email: Appointment not found');
            return false;
        }

        const apt = appointments[0];

        // Import nodemailer
        const nodemailer = require('nodemailer');

        // Create transporter
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: parseInt(smtpConfig.port),
            secure: smtpConfig.secure === 'ssl',
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.password
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        // Format date and time
        const aptDate = new Date(apt.appointment_date);
        const dateStr = aptDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Email HTML template
        const emailHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                              color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                    .content { background: white; padding: 30px; border: 1px solid #e0e0e0; }
                    .appointment-details { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; }
                    .detail-row { padding: 10px 0; border-bottom: 1px solid #e0e0e0; }
                    .detail-label { font-weight: bold; color: #667eea; }
                    .footer { background: #f0f0f0; padding: 20px; text-align: center;
                              font-size: 12px; color: #666; border-radius: 0 0 10px 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🏥 Appointment Confirmation</h1>
                        <p>Your appointment has been successfully booked!</p>
                    </div>
                    <div class="content">
                        <p>Dear ${apt.patient_name},</p>
                        <p>This email confirms your appointment at <strong>${apt.clinic_name}</strong>.</p>

                        <div class="appointment-details">
                            <div class="detail-row">
                                <span class="detail-label">Date:</span> ${dateStr}
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Time:</span> ${apt.start_time} - ${apt.end_time}
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Therapist:</span> ${apt.pt_name || 'To be assigned'}
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Clinic:</span> ${apt.clinic_name}
                            </div>
                            ${apt.clinic_address ? `
                            <div class="detail-row">
                                <span class="detail-label">Address:</span> ${apt.clinic_address}
                            </div>
                            ` : ''}
                            ${apt.clinic_phone ? `
                            <div class="detail-row">
                                <span class="detail-label">Contact:</span> ${apt.clinic_phone}
                            </div>
                            ` : ''}
                            ${apt.reason ? `
                            <div class="detail-row">
                                <span class="detail-label">Reason:</span> ${apt.reason}
                            </div>
                            ` : ''}
                        </div>

                        <p><strong>⏰ Please arrive 10 minutes early for check-in.</strong></p>

                        <p>If you need to cancel or reschedule, please contact us as soon as possible.</p>

                        <p>Thank you for choosing our services!</p>
                    </div>
                    <div class="footer">
                        <p>&copy; 2025 RehabPlus. All rights reserved.</p>
                        <p>This is an automated message. Please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        // Generate .ics calendar file for attachment
        const icsContent = generateICSFile(apt);

        // Prepare email options
        const mailOptions = {
            from: `"${smtpConfig.fromName || 'RehabPlus'}" <${smtpConfig.fromEmail}>`,
            to: recipientEmail,
            subject: `Appointment Confirmation - ${dateStr}`,
            html: emailHTML
        };

        // Add .ics attachment if generated successfully
        if (icsContent) {
            mailOptions.attachments = [{
                filename: 'appointment.ics',
                content: icsContent,
                contentType: 'text/calendar; charset=utf-8; method=REQUEST'
            }];
            console.log('📎 Calendar file (.ics) attached to email');
        } else {
            console.log('⚠️ Could not generate calendar file, sending email without attachment');
        }

        // Send email
        const info = await transporter.sendMail(mailOptions);

        console.log('✅ Email sent successfully:', info.messageId);
        return true;

    } catch (error) {
        console.error('❌ Failed to send email:', error);
        return false;
    }
};

// ========================================
// MIDDLEWARE
// ========================================

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        // Check for token in cookies for web pages
        const cookieToken = req.cookies?.authToken;
        if (!cookieToken) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Access token required' });
            }
            return res.redirect('/login');
        }
        req.token = cookieToken;
    } else {
        req.token = token;
    }
    
    jwt.verify(req.token || token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Invalid or expired token' });
            }
            return res.redirect('/login');
        }
        req.user = user;
        next();
    });
};

// Role-based access control
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
};

// Clinic access control
const checkClinicAccess = async (req, res, next) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const clinicId = req.params.clinicId || req.body.clinic_id || req.query.clinic_id;
        
        if (!clinicId) {
            return next();
        }
        
        // Admin has access to all clinics
        if (req.user.role === 'ADMIN') {
            return next();
        }
        
        // Check if user's primary clinic matches
        if (req.user.clinic_id === clinicId) {
            return next();
        }
        
        // Check user_clinic_grants
        const [grants] = await db.execute(
            'SELECT * FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ?',
            [userId, clinicId]
        );
        
        if (grants.length > 0) {
            return next();
        }
        
        return res.status(403).json({ error: 'No access to this clinic' });
    } catch (error) {
        console.error('Clinic access check error:', error);
        return res.status(500).json({ error: 'Access verification failed' });
    }
};

// Helper to resolve clinic access lists for non-admin users
const getAccessibleClinicIds = async (db, user) => {
    if (!user || user.role === 'ADMIN') {
        return [];
    }

    const clinicIds = new Set();

    if (user.clinic_id) {
        clinicIds.add(user.clinic_id);
    }

    const [grants] = await db.execute(
        'SELECT clinic_id FROM user_clinic_grants WHERE user_id = ?',
        [user.id]
    );

    grants
        .map(grant => grant.clinic_id)
        .filter(id => id)
        .forEach(id => clinicIds.add(id));

    return Array.from(clinicIds);
};

// File upload configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, process.env.UPLOAD_DIR || './uploads');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, GIF, PDF, DOC, DOCX are allowed.'));
        }
    }
});

// Audit logging
const auditLog = async (db, userId, action, entityType, entityId, oldValues = null, newValues = null, req = null) => {
    try {
        const ipAddress = req ? (req.headers['x-forwarded-for'] || req.connection.remoteAddress) : null;
        const userAgent = req ? req.headers['user-agent'] : null;
        
        await db.execute(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                action,
                entityType,
                entityId,
                oldValues ? JSON.stringify(oldValues) : null,
                newValues ? JSON.stringify(newValues) : null,
                ipAddress,
                userAgent
            ]
        );
    } catch (error) {
        console.error('Audit logging error:', error);
    }
};

// ========================================
// AUTHENTICATION ROUTES
// ========================================

// Login
app.post('/api/auth/login', [
    body('email').isEmail(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;
        const db = req.app.locals.db;

        console.log('Login attempt for email:', email);

        // Get user - case insensitive email search
        const [users] = await db.execute(
            `SELECT u.*, c.name as clinic_name
             FROM users u
             LEFT JOIN clinics c ON u.clinic_id = c.id
             WHERE LOWER(u.email) = LOWER(?) AND u.active = 1`,
            [email]
        );

        if (users.length === 0) {
            console.log('User not found or inactive for email:', email);
            // Log failed login attempt
            await db.execute(
                `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, created_at)
                 VALUES (NULL, 'LOGIN_FAILED', 'user', NULL, ?, ?, NOW())`,
                [
                    req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                    req.headers['user-agent']
                ]
            ).catch(err => console.error('Failed to log failed login:', err));

            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        console.log('User found:', user.id, user.email, user.role);

        // Verify password
        const validPassword = await verifyPassword(password, user.password_hash);
        console.log('Password validation result:', validPassword);

        if (!validPassword) {
            console.log('Invalid password for user:', user.id);
            // Log failed login attempt
            await auditLog(db, user.id, 'LOGIN_FAILED', 'user', user.id, null, { email }, req);

            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Update last login
        await db.execute(
            'UPDATE users SET last_login = NOW() WHERE id = ?',
            [user.id]
        );
        
        // Generate token
        const token = generateToken(user);
        
        // Get user's clinic grants
        const [grants] = await db.execute(
            `SELECT g.clinic_id, c.name as clinic_name 
             FROM user_clinic_grants g 
             JOIN clinics c ON g.clinic_id = c.id 
             WHERE g.user_id = ?`,
            [user.id]
        );
        
        // Audit log
        await auditLog(db, user.id, 'LOGIN', 'user', user.id, null, null, req);

        console.log('Login successful for user:', user.id, user.email, user.role);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                name: `${user.first_name} ${user.last_name}`,
                clinic_id: user.clinic_id,
                clinic_name: user.clinic_name,
                clinic_grants: grants
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        await auditLog(db, req.user.id, 'LOGOUT', 'user', req.user.id, null, null, req);
        
        res.clearCookie('authToken');
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        
        const [users] = await db.execute(
            `SELECT u.id, u.email, u.role, u.first_name, u.last_name, u.clinic_id,
                    c.name as clinic_name, u.phone, u.license_number
             FROM users u
             LEFT JOIN clinics c ON u.clinic_id = c.id
             WHERE u.id = ?`,
            [req.user.id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get clinic grants
        const [grants] = await db.execute(
            `SELECT g.clinic_id, c.name as clinic_name
             FROM user_clinic_grants g
             JOIN clinics c ON g.clinic_id = c.id
             WHERE g.user_id = ?`,
            [req.user.id]
        );
        
        res.json({
            ...users[0],
            clinic_grants: grants
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user information' });
    }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, [
    body('current_password').notEmpty(),
    body('new_password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/[A-Z]/)
        .withMessage('Password must contain at least one uppercase letter')
        .matches(/[a-z]/)
        .withMessage('Password must contain at least one lowercase letter')
        .matches(/[0-9]/)
        .withMessage('Password must contain at least one number')
        .matches(/[!@#$%^&*(),.?":{}|<>]/)
        .withMessage('Password must contain at least one special character')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { current_password, new_password } = req.body;
        const db = req.app.locals.db;

        // Get current password hash
        const [users] = await db.execute(
            'SELECT password_hash FROM users WHERE id = ?',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password
        const validPassword = await verifyPassword(current_password, users[0].password_hash);
        if (!validPassword) {
            // Log failed password change attempt
            await auditLog(db, req.user.id, 'CHANGE_PASSWORD_FAILED', 'user', req.user.id, null, null, req);

            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        // Hash new password
        const newHash = await hashPassword(new_password);
        
        // Update password
        await db.execute(
            'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
            [newHash, req.user.id]
        );
        
        await auditLog(db, req.user.id, 'CHANGE_PASSWORD', 'user', req.user.id, null, null, req);
        
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// Update profile
app.put('/api/auth/update-profile', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const { first_name, last_name, phone, license_number } = req.body;
        
        const updateFields = [];
        const updateValues = [];
        
        if (first_name) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        if (last_name) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        if (phone !== undefined) {
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        if (license_number !== undefined) {
            updateFields.push('license_number = ?');
            updateValues.push(license_number);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        updateFields.push('updated_at = NOW()');
        updateValues.push(userId);
        
        await db.execute(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );
        
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ========================================
// PATIENT MANAGEMENT ROUTES
// ========================================

// Get all patients
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, search } = req.query;

        // Validate pagination
        const pagination = validatePagination(req.query.page, req.query.limit);

        let query = `
            SELECT p.*, c.name as clinic_name,
                   CONCAT(u.first_name, ' ', u.last_name) as created_by_name
            FROM patients p
            JOIN clinics c ON p.clinic_id = c.id
            JOIN users u ON p.created_by = u.id
            WHERE 1=1
        `;
        let countQuery = 'SELECT COUNT(*) as total FROM patients p WHERE 1=1';
        const params = [];
        const countParams = [];

        // Role-based filtering for patients
        // ADMIN: See all patients from all clinics
        // CLINIC: See only patients registered to their clinic
        // PT: See all patients (can access everything)

        if (req.user.role === 'CLINIC') {
            // CLINIC users can only see their own clinic's patients
            if (!req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC user must be assigned to a clinic'
                });
            }
            query += ' AND p.clinic_id = ?';
            countQuery += ' AND p.clinic_id = ?';
            params.push(req.user.clinic_id);
            countParams.push(req.user.clinic_id);
        }
        // ADMIN and PT roles: No filtering, they see all patients

        // Filter by specific clinic (if provided in query)
        if (clinic_id && req.user.role !== 'CLINIC') {
            const clinicIdNum = safeParseInt(clinic_id, null, 1);
            if (clinicIdNum) {
                query += ' AND p.clinic_id = ?';
                countQuery += ' AND p.clinic_id = ?';
                params.push(clinicIdNum);
                countParams.push(clinicIdNum);
            }
        }

        // Search (sanitize search input)
        if (search && search.length > 0) {
            const searchPattern = `%${search.substring(0, 100)}%`; // Limit search length
            query += ' AND (p.hn LIKE ? OR p.pt_number LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR p.diagnosis LIKE ?)';
            countQuery += ' AND (p.hn LIKE ? OR p.pt_number LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR p.diagnosis LIKE ?)';
            params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
            countParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
        }

        // Get total count
        const [countResult] = await db.execute(countQuery, countParams);
        const total = countResult[0].total;

        // Add pagination
        query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
        params.push(pagination.limit, pagination.offset);

        const [patients] = await db.execute(query, params);

        res.json({
            patients,
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                total,
                pages: Math.ceil(total / pagination.limit)
            }
        });
    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({ error: 'Failed to retrieve patients' });
    }
});

// Search patients (for appointment booking)
app.get('/api/patients/search', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.json([]);
        }

        const searchPattern = `%${q}%`;
        let query = `
            SELECT p.id, p.hn, p.pt_number, p.first_name, p.last_name, p.dob, p.gender, p.diagnosis
            FROM patients p
            WHERE (
                p.hn LIKE ? OR
                p.pt_number LIKE ? OR
                p.first_name LIKE ? OR
                p.last_name LIKE ?
            )
        `;
        const params = [searchPattern, searchPattern, searchPattern, searchPattern];

        if (req.user.role !== 'ADMIN') {
            const accessibleClinics = await getAccessibleClinicIds(db, req.user);

            if (req.user.role === 'CLINIC' && accessibleClinics.length === 0) {
                return res.json([]);
            }

            if (accessibleClinics.length > 0) {
                query += ` AND p.clinic_id IN (${accessibleClinics.map(() => '?').join(',')})`;
                params.push(...accessibleClinics);
            }
        }

        query += ' ORDER BY p.last_name, p.first_name LIMIT 20';

        const [patients] = await db.execute(query, params);

        res.json(patients);
    } catch (error) {
        console.error('Search patients error:', error);
        res.status(500).json({ error: 'Failed to search patients' });
    }
});

// Get single patient
app.get('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        
        const [patients] = await db.execute(
            `SELECT p.*, c.name as clinic_name,
                    CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM patients p
             JOIN clinics c ON p.clinic_id = c.id
             JOIN users u ON p.created_by = u.id
             WHERE p.id = ?`,
            [id]
        );
        
        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        // Check clinic access
        const patient = patients[0];
        if (req.user.role !== 'ADMIN') {
            const [grants] = await db.execute(
                'SELECT clinic_id FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ? UNION SELECT ? as clinic_id WHERE ? = ?',
                [req.user.id, patient.clinic_id, req.user.clinic_id, req.user.clinic_id, patient.clinic_id]
            );
            
            if (grants.length === 0) {
                return res.status(403).json({ error: 'No access to this patient' });
            }
        }
        
        res.json(patient);
    } catch (error) {
        console.error('Get patient error:', error);
        res.status(500).json({ error: 'Failed to retrieve patient' });
    }
});

// Create patient
app.post('/api/patients', authenticateToken, [
    body('hn').notEmpty(),
    body('first_name').notEmpty(),
    body('last_name').notEmpty(),
    body('dob').isDate(),
    body('diagnosis').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const db = req.app.locals.db;
        const ptNumber = generatePTNumber();
        
        // Role-based clinic assignment
        // ADMIN: Can create patients for any clinic (clinic_id from request)
        // CLINIC: Can only create patients for their own clinic
        // PT: Can create patients for any clinic (clinic_id from request)

        let clinicId;

        if (req.user.role === 'CLINIC') {
            // CLINIC users can only create patients for their own clinic
            if (!req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC user must be assigned to a clinic'
                });
            }
            clinicId = req.user.clinic_id; // Always use their clinic
        } else {
            // ADMIN and PT can specify clinic_id
            clinicId = req.body.clinic_id;
            if (!clinicId) {
                return res.status(400).json({
                    error: 'Clinic ID is required for patient registration'
                });
            }
        }
        
        const patientData = {
            ...req.body,
            pt_number: ptNumber,
            clinic_id: clinicId,
            created_by: req.user.id
        };
        
        const [result] = await db.execute(
            `INSERT INTO patients (
                hn, pt_number, pid, passport_no, title, first_name, last_name, 
                dob, gender, phone, email, address, emergency_contact, emergency_phone,
                diagnosis, rehab_goal, rehab_goal_other, body_area, frequency, 
                expected_duration, doctor_note, precaution, contraindication, 
                medical_history, clinic_id, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                patientData.hn, ptNumber, patientData.pid, patientData.passport_no,
                patientData.title, patientData.first_name, patientData.last_name,
                patientData.dob, patientData.gender, patientData.phone, patientData.email,
                patientData.address, patientData.emergency_contact, patientData.emergency_phone,
                patientData.diagnosis, patientData.rehab_goal, patientData.rehab_goal_other,
                patientData.body_area, patientData.frequency, patientData.expected_duration,
                patientData.doctor_note, patientData.precaution, patientData.contraindication,
                patientData.medical_history, clinicId, req.user.id
            ]
        );

        await auditLog(db, req.user.id, 'CREATE', 'patient', result.insertId, null, patientData, req);

        // Send LINE notification for new patient registration
        try {
            const patientName = `${patientData.first_name} ${patientData.last_name}`.trim();

            // Get clinic name
            const [clinics] = await db.execute(
                'SELECT name FROM clinics WHERE id = ?',
                [clinicId]
            );
            const clinicName = clinics.length > 0 ? clinics[0].name : 'N/A';

            const notificationMessage = `👤 New Patient Registered

📋 Patient ID: ${result.insertId}
🔢 PT Number: ${ptNumber}
👤 Name: ${patientName}
${patientData.gender ? `⚧ Gender: ${patientData.gender}` : ''}
📅 Date of Birth: ${moment(patientData.dob).format('DD/MM/YYYY')}
📞 Phone: ${patientData.phone || 'N/A'}
📧 Email: ${patientData.email || 'N/A'}
🏢 Clinic: ${clinicName}
🩺 Diagnosis: ${patientData.diagnosis}
${patientData.rehab_goal ? `🎯 Rehab Goal: ${patientData.rehab_goal}` : ''}`;

            await sendLINENotification(db, 'newPatient', notificationMessage);
        } catch (notifError) {
            console.error('Failed to send LINE notification:', notifError);
            // Don't fail the request if notification fails
        }

        res.status(201).json({
            success: true,
            message: 'Patient created successfully',
            patient_id: result.insertId,
            pt_number: ptNumber
        });
    } catch (error) {
        console.error('Create patient error:', error);
        res.status(500).json({ error: 'Failed to create patient' });
    }
});

// Update patient
app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get current patient data
        const [patients] = await db.execute(
            'SELECT * FROM patients WHERE id = ?',
            [id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const oldData = patients[0];

        // Check clinic access
        if (req.user.role !== 'ADMIN') {
            const [grants] = await db.execute(
                'SELECT clinic_id FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ? UNION SELECT ? as clinic_id WHERE ? = ?',
                [req.user.id, oldData.clinic_id, req.user.clinic_id, req.user.clinic_id, oldData.clinic_id]
            );

            if (grants.length === 0) {
                return res.status(403).json({ error: 'No access to update this patient' });
            }
        }

        // Update patient
        const updateFields = [];
        const updateValues = [];
        const allowedFields = [
            'pid', 'passport_no', 'title', 'first_name', 'last_name', 'gender',
            'phone', 'email', 'address', 'emergency_contact', 'emergency_phone',
            'diagnosis', 'rehab_goal', 'rehab_goal_other', 'body_area', 'frequency',
            'expected_duration', 'doctor_note', 'precaution', 'contraindication', 'medical_history'
        ];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updateFields.push(`${field} = ?`);
                updateValues.push(req.body[field]);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(id);

        await db.execute(
            `UPDATE patients SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        await auditLog(db, req.user.id, 'UPDATE', 'patient', id, oldData, req.body, req);

        res.json({ success: true, message: 'Patient updated successfully' });
    } catch (error) {
        console.error('Update patient error:', error);
        res.status(500).json({ error: 'Failed to update patient' });
    }
});

// Delete patient (ADMIN only)
app.delete('/api/patients/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get current patient data for audit log
        const [patients] = await db.execute(
            'SELECT * FROM patients WHERE id = ?',
            [id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patientData = patients[0];

        // Check if patient has associated PN cases
        const [pnCases] = await db.execute(
            'SELECT COUNT(*) as count FROM pn_cases WHERE patient_id = ?',
            [id]
        );

        if (pnCases[0].count > 0) {
            return res.status(400).json({
                error: 'Cannot delete patient with associated PN cases. Please delete or reassign PN cases first.'
            });
        }

        // Delete the patient (CASCADE will handle related records if configured)
        await db.execute('DELETE FROM patients WHERE id = ?', [id]);

        // Log the deletion
        await auditLog(db, req.user.id, 'DELETE', 'patient', id, patientData, null, req);

        res.json({ success: true, message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Delete patient error:', error);
        res.status(500).json({ error: 'Failed to delete patient' });
    }
});

// ========================================
// PATIENT CSV IMPORT/EXPORT
// ========================================

// Download CSV template
app.get('/api/patients/csv/template', authenticateToken, (req, res) => {
    try {
        const csvHeaders = [
            'hn', 'pid', 'passport_no', 'title', 'first_name', 'last_name',
            'dob', 'gender', 'phone', 'email', 'address',
            'emergency_contact', 'emergency_phone',
            'diagnosis', 'rehab_goal', 'rehab_goal_other',
            'body_area', 'frequency', 'expected_duration',
            'doctor_note', 'precaution', 'contraindication',
            'medical_history', 'clinic_id'
        ];

        const sampleData = [
            'HN001', '1234567890123', '', 'Mr.', 'John', 'Doe',
            '1990-01-15', 'Male', '0812345678', 'john@email.com', '123 Main St',
            'Jane Doe', '0898765432',
            'Back pain', 'Improve mobility', '',
            'Lower back', '3 times/week', '6 weeks',
            'Avoid heavy lifting', 'None', 'Heart condition',
            'Previous surgery in 2020', '1'
        ];

        const csvContent = [
            csvHeaders.join(','),
            sampleData.join(','),
            csvHeaders.map(() => '').join(',') // Empty row for user to fill
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=patients_template.csv');
        res.send(csvContent);
    } catch (error) {
        console.error('Download template error:', error);
        res.status(500).json({ error: 'Failed to generate template' });
    }
});

// Import patients from CSV
app.post('/api/patients/csv/import', authenticateToken, uploadCSV.single('file'), async (req, res) => {
    let filePath = null;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        filePath = req.file.path;
        const db = req.app.locals.db;
        const results = [];
        const errors = [];
        let rowNumber = 1; // Start from 1 (header is 0)

        // Read and parse CSV
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push({ ...data, rowNumber: ++rowNumber }))
                .on('end', resolve)
                .on('error', reject);
        });

        let successCount = 0;
        let failedCount = 0;

        // Process each row
        for (const row of results) {
            try {
                // Skip empty rows
                if (!row.first_name || !row.last_name) {
                    continue;
                }

                // Generate PT number
                const ptNumber = generatePTNumber();

                // Validate required fields
                if (!row.clinic_id) {
                    errors.push({ row: row.rowNumber, error: 'clinic_id is required' });
                    failedCount++;
                    continue;
                }

                // Insert patient
                await db.execute(
                    `INSERT INTO patients (
                        hn, pt_number, pid, passport_no, title, first_name, last_name,
                        dob, gender, phone, email, address, emergency_contact, emergency_phone,
                        diagnosis, rehab_goal, rehab_goal_other, body_area, frequency,
                        expected_duration, doctor_note, precaution, contraindication,
                        medical_history, clinic_id, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        row.hn || null,
                        ptNumber,
                        row.pid || null,
                        row.passport_no || null,
                        row.title || null,
                        row.first_name,
                        row.last_name,
                        row.dob || null,
                        row.gender || null,
                        row.phone || null,
                        row.email || null,
                        row.address || null,
                        row.emergency_contact || null,
                        row.emergency_phone || null,
                        row.diagnosis || null,
                        row.rehab_goal || null,
                        row.rehab_goal_other || null,
                        row.body_area || null,
                        row.frequency || null,
                        row.expected_duration || null,
                        row.doctor_note || null,
                        row.precaution || null,
                        row.contraindication || null,
                        row.medical_history || null,
                        row.clinic_id,
                        req.user.id
                    ]
                );

                successCount++;
            } catch (error) {
                console.error(`Error importing row ${row.rowNumber}:`, error);
                errors.push({
                    row: row.rowNumber,
                    error: error.message
                });
                failedCount++;
            }
        }

        // Delete uploaded file
        if (filePath) {
            fs.unlinkSync(filePath);
        }

        res.json({
            success: true,
            total: results.length,
            success: successCount,
            failed: failedCount,
            errors: errors
        });

    } catch (error) {
        console.error('CSV import error:', error);

        // Clean up file on error
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.status(500).json({ error: 'Failed to import CSV: ' + error.message });
    }
});

// ========================================
// DASHBOARD SUMMARY STATISTICS
// ========================================

// Get dashboard summary statistics
app.get('/api/dashboard/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const now = new Date();
        const currentMonth = now.getMonth() + 1; // 1-12
        const currentYear = now.getFullYear();
        const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

        // Get CL001 clinic ID
        const [clinicResult] = await db.execute(
            `SELECT id FROM clinics WHERE code = 'CL001' LIMIT 1`
        );

        const cl001Id = clinicResult.length > 0 ? clinicResult[0].id : null;

        // Get bills paid summary (current month only)
        const [billsSummary] = await db.execute(
            `SELECT
                COUNT(*) as paid_count,
                COALESCE(SUM(total_amount), 0) as paid_amount
             FROM bills
             WHERE payment_status = 'PAID'
             AND MONTH(created_at) = ?
             AND YEAR(created_at) = ?`,
            [currentMonth, currentYear]
        );

        // Get bills today (all statuses)
        const [billsToday] = await db.execute(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(total_amount), 0) as amount
             FROM bills
             WHERE DATE(created_at) = CURDATE()`
        );

        // Get new patients this month in CL001
        const [patientsThisMonth] = await db.execute(
            `SELECT COUNT(*) as count
             FROM patients
             WHERE MONTH(created_at) = ?
             AND YEAR(created_at) = ?
             ${cl001Id ? 'AND clinic_id = ?' : ''}`,
            cl001Id ? [currentMonth, currentYear, cl001Id] : [currentMonth, currentYear]
        );

        // Get new patients last month in CL001 (for comparison)
        const [patientsLastMonth] = await db.execute(
            `SELECT COUNT(*) as count
             FROM patients
             WHERE MONTH(created_at) = ?
             AND YEAR(created_at) = ?
             ${cl001Id ? 'AND clinic_id = ?' : ''}`,
            cl001Id ? [lastMonth, lastMonthYear, cl001Id] : [lastMonth, lastMonthYear]
        );

        // Get total patients in CL001
        const [totalPatients] = await db.execute(
            `SELECT COUNT(*) as count
             FROM patients
             ${cl001Id ? 'WHERE clinic_id = ?' : ''}`,
            cl001Id ? [cl001Id] : []
        );

        const thisMonthCount = patientsThisMonth[0].count || 0;
        const lastMonthCount = patientsLastMonth[0].count || 0;
        const changeFromLastMonth = thisMonthCount - lastMonthCount;

        res.json({
            bills_paid: {
                count: billsSummary[0].paid_count || 0,
                amount: parseFloat(billsSummary[0].paid_amount) || 0
            },
            bills_today: {
                count: billsToday[0].count || 0,
                amount: parseFloat(billsToday[0].amount) || 0
            },
            patients_this_month: {
                count: thisMonthCount,
                change: changeFromLastMonth,
                month: now.toLocaleString('default', { month: 'long' }),
                year: currentYear,
                clinic: 'CL001'
            },
            total_patients: {
                count: totalPatients[0].count || 0,
                clinic: 'CL001'
            }
        });
    } catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
});

// ========================================
// PN CASE MANAGEMENT ROUTES
// ========================================

// Get PN cases
app.get('/api/pn', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            status, clinic_id, from_date, to_date,
            search, page = 1, limit = 20
        } = req.query;

        const offset = (page - 1) * limit;

        // Query for PN cases with appointments
        let pnCasesQuery = `
            SELECT
                pn.id, pn.patient_id, pn.pn_code, pn.diagnosis, pn.purpose,
                pn.status, pn.created_at, pn.updated_at, pn.completed_at,
                p.hn, p.first_name, p.last_name,
                sc.name as source_clinic_name,
                CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
                (SELECT MAX(r.created_at)
                 FROM pn_reports r
                 JOIN pn_visits v ON r.visit_id = v.id
                 WHERE v.pn_id = pn.id) as last_report_at,
                b.id as bill_id,
                apt.appointment_date,
                apt.start_time as appointment_start_time,
                apt.end_time as appointment_end_time,
                apt.booking_type,
                apt.walk_in_name,
                'PN_CASE' as record_type
            FROM pn_cases pn
            JOIN patients p ON pn.patient_id = p.id
            JOIN clinics sc ON pn.source_clinic_id = sc.id
            JOIN clinics tc ON pn.target_clinic_id = tc.id
            JOIN users u ON pn.created_by = u.id
            LEFT JOIN bills b ON pn.id = b.pn_case_id
            LEFT JOIN appointments apt ON pn.id = apt.pn_case_id
            WHERE 1=1
        `;

        // Query for ALL walk-in appointments (with or without PN case)
        let walkInQuery = `
            SELECT
                apt.id, apt.patient_id,
                COALESCE(p.hn, '') as hn,
                COALESCE(p.first_name, apt.walk_in_name) as first_name,
                COALESCE(p.last_name, '') as last_name,
                c.name as source_clinic_name,
                CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
                apt.created_at,
                apt.appointment_date,
                apt.start_time as appointment_start_time,
                apt.end_time as appointment_end_time,
                apt.booking_type,
                apt.walk_in_name,
                'WALK_IN' as record_type
            FROM appointments apt
            LEFT JOIN patients p ON apt.patient_id = p.id
            JOIN clinics c ON apt.clinic_id = c.id
            JOIN users u ON apt.created_by = u.id
            WHERE apt.booking_type = 'WALK_IN'
            AND apt.status != 'CANCELLED'
        `;

        let countQuery = `
            SELECT COUNT(*) as total
            FROM pn_cases pn
            JOIN patients p ON pn.patient_id = p.id
            WHERE 1=1
        `;

        const pnParams = [];
        const walkInParams = [];
        const countParams = [];

        // Role-based filtering
        if (req.user.role === 'CLINIC') {
            if (!req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC user must be assigned to a clinic'
                });
            }
            pnCasesQuery += ' AND (pn.source_clinic_id = ? OR pn.target_clinic_id = ?)';
            walkInQuery += ' AND c.id = ?';
            countQuery += ' AND (pn.source_clinic_id = ? OR pn.target_clinic_id = ?)';
            pnParams.push(req.user.clinic_id, req.user.clinic_id);
            walkInParams.push(req.user.clinic_id);
            countParams.push(req.user.clinic_id, req.user.clinic_id);
        }

        // Filter by specific clinic
        if (clinic_id) {
            pnCasesQuery += ' AND (pn.source_clinic_id = ? OR pn.target_clinic_id = ?)';
            walkInQuery += ' AND c.id = ?';
            countQuery += ' AND (pn.source_clinic_id = ? OR pn.target_clinic_id = ?)';
            pnParams.push(clinic_id, clinic_id);
            walkInParams.push(clinic_id);
            countParams.push(clinic_id, clinic_id);
        }

        // Filter by status (only for PN cases)
        if (status) {
            pnCasesQuery += ' AND pn.status = ?';
            countQuery += ' AND pn.status = ?';
            pnParams.push(status);
            countParams.push(status);
        } else {
            pnCasesQuery += ' AND pn.status != ?';
            countQuery += ' AND pn.status != ?';
            pnParams.push('CANCELLED');
            countParams.push('CANCELLED');
        }

        // Date range filter
        if (from_date) {
            pnCasesQuery += ' AND COALESCE(apt.appointment_date, DATE(pn.created_at)) >= ?';
            walkInQuery += ' AND apt.appointment_date >= ?';
            countQuery += ' AND DATE(pn.created_at) >= ?';
            pnParams.push(from_date);
            walkInParams.push(from_date);
            countParams.push(from_date);
        }

        if (to_date) {
            pnCasesQuery += ' AND COALESCE(apt.appointment_date, DATE(pn.created_at)) <= ?';
            walkInQuery += ' AND apt.appointment_date <= ?';
            countQuery += ' AND DATE(pn.created_at) <= ?';
            pnParams.push(to_date);
            walkInParams.push(to_date);
            countParams.push(to_date);
        }

        // Search filter
        if (search) {
            const searchPattern = `%${search}%`;
            pnCasesQuery += ` AND (p.hn LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?
                      OR pn.pn_code LIKE ? OR pn.diagnosis LIKE ? OR pn.purpose LIKE ?)`;
            walkInQuery += ` AND (COALESCE(p.first_name, apt.walk_in_name) LIKE ? OR COALESCE(p.last_name, '') LIKE ?)`;
            countQuery += ` AND (p.hn LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?
                           OR pn.pn_code LIKE ? OR pn.diagnosis LIKE ? OR pn.purpose LIKE ?)`;
            const pnSearchParams = Array(6).fill(searchPattern);
            pnParams.push(...pnSearchParams);
            walkInParams.push(searchPattern, searchPattern);
            countParams.push(...pnSearchParams);
        }

        // Get total count for PN cases
        const [countResult] = await db.execute(countQuery, countParams);
        const total = countResult[0].total;

        // Execute PN cases query with pagination
        pnCasesQuery += ' ORDER BY COALESCE(apt.appointment_date, DATE(pn.created_at)) DESC, pn.created_at DESC LIMIT ? OFFSET ?';
        pnParams.push(parseInt(limit), offset);
        const [cases] = await db.execute(pnCasesQuery, pnParams);

        // Execute walk-in query (no pagination - get all matching walk-ins)
        walkInQuery += ' ORDER BY apt.appointment_date DESC, apt.created_at DESC';
        console.log('🔍 Walk-in Query:', walkInQuery);
        console.log('🔍 Walk-in Params:', walkInParams);
        const [walkIns] = await db.execute(walkInQuery, walkInParams);
        console.log('🔍 Walk-ins returned:', walkIns.length, 'records');
        if (walkIns.length > 0) {
            console.log('🔍 First walk-in:', walkIns[0]);
        }

        // Get statistics with role-based filtering (exclude CANCELLED from total)
        let statsQuery = `
            SELECT
                COUNT(CASE WHEN status != 'CANCELLED' THEN 1 END) as total,
                SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as waiting,
                SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted,
                SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN MONTH(created_at) = MONTH(CURRENT_DATE())
                    AND YEAR(created_at) = YEAR(CURRENT_DATE())
                    AND status != 'CANCELLED' THEN 1 ELSE 0 END) as this_month
            FROM pn_cases
            WHERE 1=1
        `;

        const statsParams = [];

        // Apply same role-based filtering to statistics
        if (req.user.role === 'CLINIC') {
            statsQuery += ' AND (source_clinic_id = ? OR target_clinic_id = ?)';
            statsParams.push(req.user.clinic_id, req.user.clinic_id);
        }

        const [stats] = await db.execute(statsQuery, statsParams);

        res.json({
            cases,
            walkIns,
            statistics: stats[0],
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get PN cases error:', error);
        res.status(500).json({ error: 'Failed to retrieve PN cases' });
    }
});

// Create PN case
app.post('/api/pn', authenticateToken, [
    body('patient_id').isInt(),
    body('diagnosis').notEmpty(),
    body('purpose').notEmpty(),
    body('target_clinic_id').optional().isInt(),  // Optional for CLINIC users
    body('course_id').optional().isInt()  // Optional course_id for course cutting
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const db = req.app.locals.db;
        const pnCode = generatePNCode();

        // Get patient's clinic as source
        const [patients] = await db.execute(
            'SELECT clinic_id FROM patients WHERE id = ?',
            [req.body.patient_id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patientClinicId = patients[0].clinic_id;

        // Role-based access control for PN case creation
        // ADMIN: Can create PN cases - any source to any target
        // CLINIC: Can only create PN cases for their own clinic as TARGET (receiving referrals)
        // PT: Can create PN cases for any patient to any clinic

        let sourceClinicId;
        let targetClinicId;

        if (req.user.role === 'CLINIC') {
            // CLINIC users create PN cases for their own clinic to treat
            // They are the TARGET clinic (receiving the patient)
            if (!req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC user must be assigned to a clinic'
                });
            }

            // Source: Patient's current clinic
            sourceClinicId = patientClinicId;

            // Target: LOCKED to CLINIC user's clinic (they are receiving the patient)
            targetClinicId = req.user.clinic_id;

            // If target_clinic_id is provided in request, ignore it for CLINIC users
            if (req.body.target_clinic_id && req.body.target_clinic_id !== req.user.clinic_id) {
                return res.status(403).json({
                    error: 'CLINIC users can only create PN cases for their own clinic'
                });
            }
        } else {
            // ADMIN and PT can specify any source and target
            sourceClinicId = patientClinicId;
            targetClinicId = req.body.target_clinic_id;

            if (!targetClinicId) {
                return res.status(400).json({
                    error: 'Target clinic ID is required'
                });
            }
        }

        // Course validation if course_id is provided
        let courseId = req.body.course_id || null;
        if (courseId) {
            const [courses] = await db.execute(
                `SELECT id, course_code, remaining_sessions, status, patient_id, expiry_date
                 FROM courses WHERE id = ?`,
                [courseId]
            );

            if (courses.length === 0) {
                return res.status(404).json({ error: 'Course not found' });
            }

            const course = courses[0];

            // Validate course belongs to the patient
            if (course.patient_id !== req.body.patient_id) {
                return res.status(400).json({
                    error: 'Course does not belong to this patient'
                });
            }

            // Validate course status
            if (course.status !== 'ACTIVE') {
                return res.status(400).json({
                    error: `Course is ${course.status}. Only ACTIVE courses can be used.`
                });
            }

            // Validate remaining sessions
            if (course.remaining_sessions <= 0) {
                return res.status(400).json({
                    error: 'Course has no remaining sessions. Please purchase a new course.',
                    course_code: course.course_code,
                    remaining_sessions: course.remaining_sessions
                });
            }

            // Validate expiry date
            if (course.expiry_date && new Date(course.expiry_date) < new Date()) {
                return res.status(400).json({
                    error: 'Course has expired',
                    expiry_date: course.expiry_date
                });
            }

            // Course validation passed - will deduct 1 session
        }

        // ******** FIX: REMOVED 'priority' from column list and '?' from values ********
        // Insert PN case with course_id
        const [result] = await db.execute(
            `INSERT INTO pn_cases (
                pn_code, patient_id, diagnosis, purpose, status,
                source_clinic_id, target_clinic_id, referring_doctor,
                notes, current_medications, allergies,
                pn_precautions, pn_contraindications, treatment_goals,
                expected_outcomes, medical_notes, pain_scale, functional_status,
                course_id, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pnCode,
                req.body.patient_id,
                req.body.diagnosis,
                req.body.purpose,
                'PENDING',
                sourceClinicId,
                targetClinicId,
                req.body.referring_doctor || null,
                // ******** FIX: REMOVED 'req.body.priority || 'NORMAL',' ********
                req.body.notes || null,
                req.body.current_medications || null,
                req.body.allergies || null,
                req.body.pn_precautions || null,
                req.body.pn_contraindications || null,
                req.body.treatment_goals || null,
                req.body.expected_outcomes || null,
                req.body.medical_notes || null,
                req.body.pain_scale || null,
                req.body.functional_status || null,
                courseId,
                req.user.id
            ]
        );

        // NOTE: Course session is NOT deducted here
        // Session will be deducted when PN status changes to ACCEPTED

        await auditLog(db, req.user.id, 'CREATE', 'pn_case', result.insertId, null, req.body, req);

        const responseMessage = courseId
            ? 'PN case created successfully with course linked (session will be deducted when accepted)'
            : 'PN case created successfully';

        res.status(201).json({
            success: true,
            message: responseMessage,
            pn_id: result.insertId,
            pn_code: pnCode,
            course_id: courseId
        });
    } catch (error) {
        console.error('Create PN case error:', error);
        res.status(500).json({ error: 'Failed to create PN case' });
    }
});

// Update PN case medical information
app.put('/api/pn/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get current PN case
        const [cases] = await db.execute(
            'SELECT * FROM pn_cases WHERE id = ?',
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const oldCase = cases[0];

        // Check access - PT and ADMIN can update, CLINIC can update if it's their clinic
        if (req.user.role === 'CLINIC') {
            if (oldCase.target_clinic_id !== req.user.clinic_id && oldCase.source_clinic_id !== req.user.clinic_id) {
                return res.status(403).json({ error: 'No access to update this PN case' });
            }
        }

        // Allowed medical fields to update
        const allowedFields = [
            'diagnosis', 'purpose', 'referring_doctor', 'notes',
            'current_medications', 'allergies', 'pn_precautions', 'pn_contraindications',
            'treatment_goals', 'expected_outcomes', 'medical_notes', 'pain_scale', 'functional_status'
        ];

        const updateFields = [];
        const updateValues = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updateFields.push(`${field} = ?`);
                updateValues.push(req.body[field]);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(id);

        await db.execute(
            `UPDATE pn_cases SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        await auditLog(db, req.user.id, 'UPDATE', 'pn_case', id, oldCase, req.body, req);

        res.json({ success: true, message: 'PN case updated successfully' });
    } catch (error) {
        console.error('Update PN case error:', error);
        res.status(500).json({ error: 'Failed to update PN case' });
    }
});

// Update PN case status
app.patch('/api/pn/:id/status', authenticateToken, [
    body('status').isIn(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const db = req.app.locals.db;
        const { id } = req.params;
        const { status, pt_diagnosis, pt_chief_complaint, pt_present_history, pt_pain_score, soap_notes } = req.body;

        // Get current case with clinic information and linked appointment
        const [cases] = await db.execute(
            `SELECT pn.*,
                    COALESCE(a.course_id, pn.course_id) as final_course_id,
                    sc.code as source_clinic_code,
                    tc.code as target_clinic_code,
                    a.id as appointment_id,
                    a.status as appointment_status
             FROM pn_cases pn
             JOIN clinics sc ON pn.source_clinic_id = sc.id
             JOIN clinics tc ON pn.target_clinic_id = tc.id
             LEFT JOIN appointments a ON pn.id = a.pn_case_id
             WHERE pn.id = ?`,
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const oldCase = cases[0];

        // Use final_course_id (from COALESCE) instead of pn.course_id
        oldCase.course_id = oldCase.final_course_id;

        // Check access - ADMIN and PT can change status
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({ error: 'Only ADMIN or PT can change PN case status' });
        }

        // Update status with appropriate timestamp
        let updateQuery = 'UPDATE pn_cases SET status = ?, updated_at = NOW()';
        const updateParams = [status];

        console.log('=== PN STATUS CHANGE DEBUG ===');
        console.log('PN ID:', id);
        console.log('Old Status:', oldCase.status);
        console.log('New Status:', status);
        console.log('Course ID:', oldCase.course_id);
        console.log('Source Clinic:', oldCase.source_clinic_code);
        console.log('Target Clinic:', oldCase.target_clinic_code);
        console.log('Linked Appointment ID:', oldCase.appointment_id);
        console.log('Appointment Status:', oldCase.appointment_status);

        // PENDING → ACCEPTED: Save PT information for non-CL001 clinics
        // NOTE: Course session is NOT deducted here (only deducted via Appointment COMPLETED)
        if (status === 'ACCEPTED' && oldCase.status === 'PENDING') {
            updateQuery += ', accepted_at = NOW()';

            // For non-CL001 clinics, require and save PT assessment information
            if (oldCase.source_clinic_code !== 'CL001' && oldCase.target_clinic_code !== 'CL001') {
                if (!pt_diagnosis || !pt_chief_complaint || !pt_present_history || pt_pain_score === undefined) {
                    return res.status(400).json({
                        error: 'PT assessment information required for non-CL001 clinics',
                        required_fields: ['pt_diagnosis', 'pt_chief_complaint', 'pt_present_history', 'pt_pain_score']
                    });
                }

                updateQuery += ', pt_diagnosis = ?, pt_chief_complaint = ?, pt_present_history = ?, pt_pain_score = ?';
                updateParams.push(pt_diagnosis, pt_chief_complaint, pt_present_history, pt_pain_score);
            }

            // ❌ REMOVED: Course session deduction from Dashboard
            // ✅ Course sessions are ONLY deducted via Appointment COMPLETED → PN ACCEPTED

            // Sync appointment to COMPLETED (Dashboard ACCEPTED → Appointment COMPLETED)
            if (oldCase.appointment_id) {
                await db.execute(
                    `UPDATE appointments
                     SET status = 'COMPLETED', updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.appointment_id]
                );
                console.log('✅ Synced: PN ACCEPTED → Appointment COMPLETED');

                // Deduct course session when PN is accepted from dashboard
                if (oldCase.course_id) {
                    // Check if course session was already deducted for this PN
                    const [usageHistory] = await db.execute(
                        `SELECT id FROM course_usage_history
                         WHERE course_id = ? AND pn_id = ? AND action_type = 'USE'
                         LIMIT 1`,
                        [oldCase.course_id, id]
                    );

                    if (usageHistory.length === 0) {
                        // No session deducted yet - deduct now
                        console.log('🎯 Dashboard PN ACCEPTED: Deducting course session for course:', oldCase.course_id);

                        await db.execute(
                            `UPDATE courses
                             SET used_sessions = used_sessions + 1,
                                 remaining_sessions = remaining_sessions - 1,
                                 status = CASE
                                     WHEN remaining_sessions - 1 <= 0 THEN 'COMPLETED'
                                     ELSE status
                                 END,
                                 updated_at = NOW()
                             WHERE id = ?`,
                            [oldCase.course_id]
                        );

                        // Log course usage
                        await db.execute(
                            `INSERT INTO course_usage_history
                             (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                             VALUES (?, NULL, ?, 1, CURDATE(), 'USE', 'Dashboard: PN case accepted - session deducted', ?)`,
                            [oldCase.course_id, id, req.user.id]
                        ).catch(err => console.warn('Failed to log course usage:', err.message));

                        console.log('✅ Course session deducted from dashboard');
                    } else {
                        console.log('ℹ️  Course session already deducted for this PN - skipping');
                    }
                }
            }
        }
        // ACCEPTED → PENDING: Return course session (ADMIN only can reverse)
        else if (status === 'PENDING' && oldCase.status === 'ACCEPTED') {
            // Only ADMIN can reverse from ACCEPTED to PENDING
            if (req.user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only ADMIN can reverse from ACCEPTED to PENDING' });
            }

            updateQuery += ', accepted_at = NULL';

            // Clear PT assessment information
            updateQuery += ', pt_diagnosis = NULL, pt_chief_complaint = NULL, pt_present_history = NULL, pt_pain_score = NULL';

            // Only return course session if PN has linked appointment (meaning course was deducted via Appointment)
            if (oldCase.course_id && oldCase.appointment_id) {
                console.log('ACCEPTED → PENDING: Returning session to course (PN from Appointment):', oldCase.course_id);

                await db.execute(
                    `UPDATE courses
                     SET used_sessions = GREATEST(0, used_sessions - 1),
                         remaining_sessions = remaining_sessions + 1,
                         status = CASE
                             WHEN status = 'COMPLETED' AND remaining_sessions + 1 > 0 THEN 'ACTIVE'
                             ELSE status
                         END,
                         updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.course_id]
                );

                // Log course return
                await db.execute(
                    `INSERT INTO course_usage_history
                     (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                     VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'PN case reversed to pending - session returned', ?)`,
                    [oldCase.course_id, id, req.user.id]
                ).catch(err => console.warn('Failed to log course return:', err.message));
            } else if (oldCase.course_id && !oldCase.appointment_id) {
                console.log('ℹ️  PN has course but no appointment - no session to return (Dashboard-created PN)');
            }

            // Sync appointment back to SCHEDULED (Dashboard PENDING → Appointment SCHEDULED)
            if (oldCase.appointment_id) {
                await db.execute(
                    `UPDATE appointments
                     SET status = 'SCHEDULED', updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.appointment_id]
                );
                console.log('✅ Synced: PN PENDING → Appointment SCHEDULED');
            }
        }
        // ACCEPTED → COMPLETED: Require SOAP notes for all clinics
        else if (status === 'COMPLETED' && oldCase.status === 'ACCEPTED') {
            updateQuery += ', completed_at = NOW()';

            // SOAP notes required for all clinics when completing
            if (!soap_notes || !soap_notes.subjective || !soap_notes.objective ||
                !soap_notes.assessment || !soap_notes.plan) {
                return res.status(400).json({
                    error: 'SOAP notes required when completing case',
                    required_fields: ['soap_notes.subjective', 'soap_notes.objective', 'soap_notes.assessment', 'soap_notes.plan']
                });
            }

            // Save SOAP notes to separate table
            await db.execute(
                `INSERT INTO pn_soap_notes (pn_id, subjective, objective, assessment, plan, timestamp, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
                [id, soap_notes.subjective, soap_notes.objective, soap_notes.assessment,
                 soap_notes.plan, soap_notes.notes || '', req.user.id]
            );

            // Sync appointment to COMPLETED (Dashboard COMPLETED → Appointment COMPLETED)
            if (oldCase.appointment_id) {
                await db.execute(
                    `UPDATE appointments
                     SET status = 'COMPLETED', updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.appointment_id]
                );
                console.log('✅ Synced: PN COMPLETED → Appointment COMPLETED');
            }
        }
        // CANCELLED: Return the course session (only if was ACCEPTED AND from Appointment)
        else if (status === 'CANCELLED') {
            updateQuery += ', cancelled_at = NOW()';
            if (req.body.cancellation_reason) {
                updateQuery += ', cancellation_reason = ?';
                updateParams.push(req.body.cancellation_reason);
            }

            // Only return session if PN was ACCEPTED, has course, AND has appointment (course was deducted via Appointment)
            if (oldCase.status === 'ACCEPTED' && oldCase.course_id && oldCase.appointment_id) {
                console.log('🔄 DASHBOARD CANCELLATION: Returning course session (PN from Appointment)');
                console.log('   PN ID:', id);
                console.log('   Course ID:', oldCase.course_id);
                console.log('   Old Status:', oldCase.status);
                console.log('   Has Appointment:', oldCase.appointment_id);

                await db.execute(
                    `UPDATE courses
                     SET used_sessions = GREATEST(0, used_sessions - 1),
                         remaining_sessions = remaining_sessions + 1,
                         status = CASE
                             WHEN status = 'COMPLETED' AND remaining_sessions + 1 > 0 THEN 'ACTIVE'
                             ELSE status
                         END,
                         updated_at = NOW()
                     WHERE id = ?`,
                    [oldCase.course_id]
                );

                // Log course return
                await db.execute(
                    `INSERT INTO course_usage_history
                     (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                     VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'PN case cancelled - session returned', ?)`,
                    [oldCase.course_id, id, req.user.id]
                ).catch(err => console.warn('Failed to log course return:', err.message));

                console.log('✅ Course session returned successfully');
            } else {
                console.log('ℹ️  No course session to return');
                console.log('   Status:', oldCase.status, ', Course ID:', oldCase.course_id, ', Appointment:', oldCase.appointment_id);
                if (oldCase.course_id && !oldCase.appointment_id) {
                    console.log('   → Dashboard-created PN (no appointment) - no session was deducted');
                }
            }

            // Sync appointment to CANCELLED (Dashboard CANCELLED → Appointment CANCELLED)
            if (oldCase.appointment_id) {
                await db.execute(
                    `UPDATE appointments
                     SET status = 'CANCELLED',
                         cancellation_reason = ?,
                         cancelled_at = NOW(),
                         updated_at = NOW()
                     WHERE id = ?`,
                    [req.body.cancellation_reason || 'Cancelled from Dashboard', oldCase.appointment_id]
                );
                console.log('✅ Synced: PN CANCELLED → Appointment CANCELLED');
            }
        }

        updateQuery += ' WHERE id = ?';
        updateParams.push(id);

        await db.execute(updateQuery, updateParams);

        // Log status change in history
        await db.execute(
            `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, is_reversal)
             VALUES (?, ?, ?, ?, FALSE)`,
            [id, oldCase.status, status, req.user.id]
        );

        await auditLog(db, req.user.id, 'UPDATE_STATUS', 'pn_case', id,
                      { status: oldCase.status }, { status }, req);

        res.json({
            success: true,
            message: `PN case status updated to ${status}`
        });
    } catch (error) {
        console.error('Update PN status error:', error);
        res.status(500).json({ error: 'Failed to update PN case status' });
    }
});

// Reverse PN case status (ADMIN only)
app.post('/api/pn/:id/reverse-status', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Reversal reason is required' });
        }

        // Get current case
        const [cases] = await db.execute(
            'SELECT * FROM pn_cases WHERE id = ?',
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const currentCase = cases[0];

        // Only allow reversal from COMPLETED to ACCEPTED
        if (currentCase.status !== 'COMPLETED') {
            return res.status(400).json({
                error: 'Can only reverse COMPLETED cases back to ACCEPTED'
            });
        }

        // Update status back to ACCEPTED and clear completed_at
        await db.execute(
            `UPDATE pn_cases
             SET status = 'ACCEPTED',
                 completed_at = NULL,
                 is_reversed = TRUE,
                 last_reversal_reason = ?,
                 last_reversed_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [reason, id]
        );

        // Log status reversal in history
        await db.execute(
            `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, change_reason, is_reversal)
             VALUES (?, ?, ?, ?, ?, TRUE)`,
            [id, 'COMPLETED', 'ACCEPTED', req.user.id, reason]
        );

        await auditLog(db, req.user.id, 'REVERSE_STATUS', 'pn_case', id,
                      { status: 'COMPLETED' }, { status: 'ACCEPTED', reason }, req);

        res.json({
            success: true,
            message: 'Case status reversed to ACCEPTED. SOAP notes must be re-entered.'
        });
    } catch (error) {
        console.error('Reverse status error:', error);
        res.status(500).json({ error: 'Failed to reverse status' });
    }
});

// Get SOAP notes for a PN case
app.get('/api/pn/:id/soap-notes', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [notes] = await db.execute(
            `SELECT s.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM pn_soap_notes s
             JOIN users u ON s.created_by = u.id
             WHERE s.pn_id = ?
             ORDER BY s.timestamp DESC`,
            [id]
        );

        res.json(notes);
    } catch (error) {
        console.error('Get SOAP notes error:', error);
        res.status(500).json({ error: 'Failed to retrieve SOAP notes' });
    }
});

// Create PT certificate
app.post('/api/pn/:id/certificate', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { certificate_type, certificate_data } = req.body;

        // Check access - ADMIN and PT only
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({ error: 'Only ADMIN or PT can create certificates' });
        }

        if (!certificate_type || !['thai', 'english'].includes(certificate_type)) {
            return res.status(400).json({ error: 'Invalid certificate type. Must be "thai" or "english"' });
        }

        // Verify case is COMPLETED
        const [cases] = await db.execute(
            'SELECT status FROM pn_cases WHERE id = ?',
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        if (cases[0].status !== 'COMPLETED') {
            return res.status(400).json({ error: 'Can only create certificates for COMPLETED cases' });
        }

        // Insert certificate
        const [result] = await db.execute(
            `INSERT INTO pt_certificates (pn_id, certificate_type, certificate_data, created_by)
             VALUES (?, ?, ?, ?)`,
            [id, certificate_type, JSON.stringify(certificate_data), req.user.id]
        );

        await auditLog(db, req.user.id, 'CREATE_CERTIFICATE', 'pt_certificate', result.insertId,
                      null, { pn_id: id, certificate_type }, req);

        res.json({
            success: true,
            message: 'Certificate created successfully',
            certificate_id: result.insertId
        });
    } catch (error) {
        console.error('Create certificate error:', error);
        res.status(500).json({ error: 'Failed to create certificate' });
    }
});

// Get certificates for a PN case
app.get('/api/pn/:id/certificates', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [certificates] = await db.execute(
            `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM pt_certificates c
             JOIN users u ON c.created_by = u.id
             WHERE c.pn_id = ?
             ORDER BY c.created_at DESC`,
            [id]
        );

        res.json(certificates);
    } catch (error) {
        console.error('Get certificates error:', error);
        res.status(500).json({ error: 'Failed to retrieve certificates' });
    }
});

// Certificate Settings Page (ADMIN only)
app.get('/certificate-settings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'ADMIN') {
        return res.status(403).send('Access denied. ADMIN only.');
    }
    res.render('certificate_settings', { user: req.user });
});

// Get certificate settings
app.get('/api/certificate-settings', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id } = req.query;

        let query = 'SELECT * FROM certificate_settings WHERE ';
        let params = [];

        if (clinic_id) {
            query += 'clinic_id = ?';
            params.push(clinic_id);
        } else {
            query += 'clinic_id IS NULL';
        }

        query += ' LIMIT 1';

        const [settings] = await db.execute(query, params);

        res.json(settings.length > 0 ? settings[0] : null);
    } catch (error) {
        console.error('Get certificate settings error:', error);
        res.status(500).json({ error: 'Failed to retrieve settings' });
    }
});

// Create certificate settings
app.post('/api/certificate-settings', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can modify certificate settings' });
        }

        const db = req.app.locals.db;
        const {
            clinic_id, clinic_logo_url, clinic_name, clinic_address,
            clinic_phone, clinic_email, header_text, footer_text,
            show_pt_diagnosis, show_subjective, show_treatment_period
        } = req.body;

        const [result] = await db.execute(
            `INSERT INTO certificate_settings
             (clinic_id, clinic_logo_url, clinic_name, clinic_address, clinic_phone,
              clinic_email, header_text, footer_text, show_pt_diagnosis,
              show_subjective, show_treatment_period)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clinic_id || null, clinic_logo_url, clinic_name, clinic_address,
                clinic_phone, clinic_email, header_text, footer_text,
                show_pt_diagnosis !== false, show_subjective !== false,
                show_treatment_period !== false
            ]
        );

        res.json({
            success: true,
            message: 'Settings created successfully',
            id: result.insertId
        });
    } catch (error) {
        console.error('Create certificate settings error:', error);
        res.status(500).json({ error: 'Failed to create settings' });
    }
});

// Update certificate settings
app.put('/api/certificate-settings/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can modify certificate settings' });
        }

        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            clinic_id, clinic_logo_url, clinic_name, clinic_address,
            clinic_phone, clinic_email, header_text, footer_text,
            show_pt_diagnosis, show_subjective, show_treatment_period
        } = req.body;

        await db.execute(
            `UPDATE certificate_settings
             SET clinic_id = ?, clinic_logo_url = ?, clinic_name = ?,
                 clinic_address = ?, clinic_phone = ?, clinic_email = ?,
                 header_text = ?, footer_text = ?, show_pt_diagnosis = ?,
                 show_subjective = ?, show_treatment_period = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [
                clinic_id || null, clinic_logo_url, clinic_name, clinic_address,
                clinic_phone, clinic_email, header_text, footer_text,
                show_pt_diagnosis !== false, show_subjective !== false,
                show_treatment_period !== false, id
            ]
        );

        res.json({
            success: true,
            message: 'Settings updated successfully'
        });
    } catch (error) {
        console.error('Update certificate settings error:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Update PT certificate (ADMIN only)
app.put('/api/certificates/:certificateId', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { certificateId } = req.params;
        const { certificate_data } = req.body;

        // Only ADMIN can edit certificates
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can edit certificates' });
        }

        // Check if certificate exists
        const [certificates] = await db.execute(
            'SELECT * FROM pt_certificates WHERE id = ?',
            [certificateId]
        );

        if (certificates.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        // Update certificate
        await db.execute(
            `UPDATE pt_certificates
             SET certificate_data = ?, updated_at = NOW()
             WHERE id = ?`,
            [JSON.stringify(certificate_data), certificateId]
        );

        await auditLog(db, req.user.id, 'UPDATE_CERTIFICATE', 'pt_certificate', certificateId,
                      certificates[0], { certificate_data }, req);

        res.json({
            success: true,
            message: 'Certificate updated successfully'
        });
    } catch (error) {
        console.error('Update certificate error:', error);
        res.status(500).json({ error: 'Failed to update certificate' });
    }
});

// Delete PN case (Only PENDING status can be deleted)
app.delete('/api/pn/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get current PN case
        const [cases] = await db.execute(
            'SELECT * FROM pn_cases WHERE id = ?',
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const pnCase = cases[0];

        // Only PENDING cases can be deleted
        if (pnCase.status !== 'PENDING') {
            return res.status(400).json({
                error: `Cannot delete PN case with status ${pnCase.status}. Only PENDING cases can be deleted.`
            });
        }

        // Check access - PT and ADMIN can delete, CLINIC can delete if it's their clinic
        if (req.user.role === 'CLINIC') {
            if (pnCase.target_clinic_id !== req.user.clinic_id && pnCase.source_clinic_id !== req.user.clinic_id) {
                return res.status(403).json({ error: 'No access to delete this PN case' });
            }
        }

        const removedAppointments = [];

        try {
            await db.beginTransaction();

            const [appointments] = await db.execute(
                'SELECT * FROM appointments WHERE pn_case_id = ?',
                [id]
            );

            if (appointments.length > 0) {
                removedAppointments.push(...appointments.map(apt => apt.id));
                await db.execute('DELETE FROM appointments WHERE pn_case_id = ?', [id]);

                for (const appointment of appointments) {
                    await auditLog(db, req.user.id, 'DELETE', 'appointment', appointment.id, appointment, null, req);
                }
            }

            await db.execute('DELETE FROM pn_status_history WHERE pn_id = ?', [id]);
            await db.execute('DELETE FROM pn_visits WHERE pn_id = ?', [id]);
            await db.execute('DELETE FROM pn_attachments WHERE pn_id = ?', [id]);
            await db.execute('DELETE FROM pt_certificates WHERE pn_id = ?', [id]);

            await db.execute('DELETE FROM pn_cases WHERE id = ?', [id]);
            await auditLog(db, req.user.id, 'DELETE', 'pn_case', id, pnCase, null, req);

            await db.commit();

            res.json({
                success: true,
                message: 'PN case deleted successfully',
                removed_appointments: removedAppointments
            });
        } catch (transactionError) {
            await db.rollback();
            console.error('Delete PN case transaction error:', transactionError);
            return res.status(500).json({ error: 'Failed to delete PN case' });
        }
    } catch (error) {
        console.error('Delete PN case error:', error);
        res.status(500).json({ error: 'Failed to delete PN case' });
    }
});

// Get single PN case with details
app.get('/api/pn/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [cases] = await db.execute(
            `SELECT
                pn.*,
                p.hn, p.pt_number, p.first_name, p.last_name, p.dob, p.gender,
                p.diagnosis as patient_diagnosis, p.rehab_goal, p.precaution,
                sc.name as source_clinic_name,
                tc.name as target_clinic_name,
                CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
                CONCAT(pt.first_name, ' ', pt.last_name) as assigned_pt_name
            FROM pn_cases pn
            JOIN patients p ON pn.patient_id = p.id
            JOIN clinics sc ON pn.source_clinic_id = sc.id
            JOIN clinics tc ON pn.target_clinic_id = tc.id
            JOIN users u ON pn.created_by = u.id
            LEFT JOIN users pt ON pn.assigned_pt_id = pt.id
            WHERE pn.id = ?`,
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        // Get visits
        let visits = [];
        try {
            const [result] = await db.execute(
                `SELECT v.*, CONCAT(u.first_name, ' ', u.last_name) as therapist_name
                 FROM pn_visits v
                 LEFT JOIN users u ON v.therapist_id = u.id
                 WHERE v.pn_id = ?
                 ORDER BY v.visit_no`,
                [id]
            );
            visits = result;
        } catch (err) {
            console.warn('Failed to load visits:', err.message);
        }

        // Get reports
        let reports = [];
        try {
            const [result] = await db.execute(
                `SELECT r.*, v.visit_no
                 FROM pn_reports r
                 JOIN pn_visits v ON r.visit_id = v.id
                 WHERE v.pn_id = ?
                 ORDER BY r.created_at DESC`,
                [id]
            );
            reports = result;
        } catch (err) {
            console.warn('Failed to load reports:', err.message);
        }

        // Get SOAP notes (table may not exist yet - run migration_add_missing_tables.sql)
        let soap_notes = [];
        try {
            const [result] = await db.execute(
                `SELECT s.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name
                 FROM pn_soap_notes s
                 JOIN users u ON s.created_by = u.id
                 WHERE s.pn_id = ?
                 ORDER BY s.timestamp DESC`,
                [id]
            );
            soap_notes = result;
        } catch (err) {
            console.warn('Failed to load SOAP notes (table may not exist):', err.message);
        }

        // Get attachments (table may not exist yet - run migration_add_missing_tables.sql)
        let attachments = [];
        try {
            const [result] = await db.execute(
                `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) as uploaded_by_name
                 FROM pn_attachments a
                 JOIN users u ON a.uploaded_by = u.id
                 WHERE a.pn_id = ?
                 ORDER BY a.created_at DESC`,
                [id]
            );
            attachments = result;
        } catch (err) {
            console.warn('Failed to load attachments (table may not exist):', err.message);
        }

        res.json({
            ...cases[0],
            visits,
            reports,
            soap_notes,
            attachments
        });
    } catch (error) {
        console.error('Get PN case error:', error);
        res.status(500).json({ error: 'Failed to retrieve PN case details' });
    }
});

app.get('/api/pn/:id/timeline', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [cases] = await db.execute(
            `SELECT pn.*, 
                    CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name,
                    sc.name AS source_clinic_name,
                    tc.name AS target_clinic_name
             FROM pn_cases pn
             JOIN clinics sc ON pn.source_clinic_id = sc.id
             JOIN clinics tc ON pn.target_clinic_id = tc.id
             JOIN users creator ON pn.created_by = creator.id
             WHERE pn.id = ?`,
            [id]
        );

        if (cases.length === 0) {
            return res.status(404).json({ error: 'PN case not found' });
        }

        const pnCase = cases[0];

        if (req.user.role === 'CLINIC') {
            if (pnCase.source_clinic_id !== req.user.clinic_id && pnCase.target_clinic_id !== req.user.clinic_id) {
                return res.status(403).json({ error: 'No access to this PN case' });
            }
        }

        const timeline = [];

        timeline.push({
            type: 'CASE_CREATED',
            timestamp: pnCase.created_at,
            status: pnCase.status,
            title: 'PN case created',
            description: `Case created by ${pnCase.created_by_name || 'System'}`,
            meta: {
                created_by: pnCase.created_by_name || null,
                clinic: pnCase.target_clinic_name || null
            }
        });

        const [statusHistory] = await db.execute(
            `SELECT h.old_status, h.new_status, h.change_reason, h.is_reversal,
                    DATE_FORMAT(h.created_at, '%Y-%m-%d %H:%i:%s') AS changed_at,
                    CONCAT(u.first_name, ' ', u.last_name) AS changed_by_name
             FROM pn_status_history h
             LEFT JOIN users u ON h.changed_by = u.id
             WHERE h.pn_id = ?
             ORDER BY h.created_at ASC`,
            [id]
        );

        statusHistory.forEach(entry => {
            timeline.push({
                type: 'STATUS_CHANGE',
                timestamp: entry.changed_at,
                status: entry.new_status,
                title: `Status changed to ${entry.new_status}`,
                description: entry.change_reason || null,
                meta: {
                    changed_by: entry.changed_by_name || null,
                    old_status: entry.old_status,
                    is_reversal: !!entry.is_reversal
                }
            });
        });

        const [appointmentHistory] = await db.execute(
            `SELECT a.id, a.status, a.booking_type,
                    DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
                    TIME_FORMAT(a.start_time, '%H:%i:%s') AS start_time,
                    TIME_FORMAT(a.end_time, '%H:%i:%s') AS end_time,
                    DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                    a.walk_in_name, a.walk_in_phone,
                    CASE
                        WHEN a.booking_type = 'WALK_IN' THEN CONCAT('W', LPAD(a.id, 6, '0'))
                        ELSE NULL
                    END AS walk_in_id,
                    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                    CONCAT(pt.first_name, ' ', pt.last_name) AS pt_name,
                    c.name AS clinic_name,
                    CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name
             FROM appointments a
             LEFT JOIN patients p ON a.patient_id = p.id
             LEFT JOIN users pt ON a.pt_id = pt.id
             JOIN clinics c ON a.clinic_id = c.id
             LEFT JOIN users creator ON a.created_by = creator.id
             WHERE a.pn_case_id = ?
             ORDER BY a.appointment_date ASC, a.start_time ASC`,
            [id]
        );

        appointmentHistory.forEach(apt => {
            const appointmentTitle = apt.status === 'CANCELLED'
                ? 'Appointment cancelled'
                : apt.status === 'COMPLETED'
                    ? 'Appointment completed'
                    : 'Appointment scheduled';
            const participant = apt.booking_type === 'WALK_IN'
                ? `Walk-in: ${apt.walk_in_name || 'Unknown visitor'}`
                : (apt.patient_name || 'Unknown patient');
            const description = `${participant} with ${apt.pt_name || 'Unassigned PT'}`;
            const timestamp = apt.appointment_date
                ? `${apt.appointment_date}T${apt.start_time || '00:00:00'}`
                : apt.created_at;

            timeline.push({
                type: 'APPOINTMENT',
                timestamp,
                status: apt.status,
                title: appointmentTitle,
                description,
                    meta: {
                        appointment_id: apt.id,
                        booking_type: apt.booking_type,
                        clinic: apt.clinic_name,
                        start_time: apt.start_time,
                        end_time: apt.end_time,
                        created_at: apt.created_at,
                        created_by: apt.created_by_name,
                        walk_in_phone: apt.walk_in_phone,
                        walk_in_name: apt.walk_in_name,
                        walk_in_id: apt.walk_in_id
                    }
                });
        });

        const [visits] = await db.execute(
            `SELECT v.id, v.visit_no, v.status,
                    DATE_FORMAT(v.visit_date, '%Y-%m-%d') AS visit_date,
                    TIME_FORMAT(v.visit_time, '%H:%i:%s') AS visit_time,
                    CONCAT(u.first_name, ' ', u.last_name) AS therapist_name
             FROM pn_visits v
             LEFT JOIN users u ON v.therapist_id = u.id
             WHERE v.pn_id = ?
             ORDER BY v.visit_date ASC, v.visit_time ASC`,
            [id]
        );

        visits.forEach(visit => {
            const visitTimestamp = visit.visit_date
                ? `${visit.visit_date}T${visit.visit_time || '00:00:00'}`
                : null;
            timeline.push({
                type: 'VISIT',
                timestamp: visitTimestamp,
                status: visit.status,
                title: `Visit #${visit.visit_no}`,
                description: `Visit ${visit.visit_no} recorded`,
                meta: {
                    visit_id: visit.id,
                    therapist: visit.therapist_name || null
                }
            });
        });

        timeline.sort((a, b) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return aTime - bTime;
        });

        res.json({
            case: {
                id: pnCase.id,
                pn_code: pnCase.pn_code,
                status: pnCase.status
            },
            events: timeline
        });
    } catch (error) {
        console.error('Get PN timeline error:', error);
        res.status(500).json({ error: 'Failed to retrieve PN timeline' });
    }
});

// ========================================
// APPOINTMENT ROUTES (NEW)
// ========================================

// Shared select clause for appointment queries
const appointmentSelectClause = `
    SELECT
        a.id,
        a.patient_id,
        a.pt_id,
        a.clinic_id,
        DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
        TIME_FORMAT(a.start_time, '%H:%i:%s') AS start_time,
        TIME_FORMAT(a.end_time, '%H:%i:%s') AS end_time,
        a.status,
        a.appointment_type,
        a.booking_type,
        a.walk_in_name,
        a.walk_in_phone,
        CASE
            WHEN a.booking_type = 'WALK_IN' THEN CONCAT('W', LPAD(a.id, 6, '0'))
            ELSE NULL
        END AS walk_in_id,
        a.pn_case_id,
        a.auto_created_pn,
        a.reason,
        a.notes,
        a.created_by,
        DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(a.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
        a.cancellation_reason,
        DATE_FORMAT(a.cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelled_at,
        a.cancelled_by,
        p.hn,
        p.pt_number,
        p.first_name AS patient_first_name,
        p.last_name AS patient_last_name,
        p.email AS patient_email,
        p.gender,
        p.dob,
        CASE
            WHEN a.booking_type = 'WALK_IN' THEN a.walk_in_name
            ELSE CONCAT_WS(' ', p.first_name, p.last_name)
        END AS patient_name,
        CONCAT_WS(' ', pt.first_name, pt.last_name) AS pt_name,
        c.name AS clinic_name,
        c.code AS clinic_code,
        CONCAT_WS(' ', creator.first_name, creator.last_name) AS created_by_name,
        CONCAT_WS(' ', canceller.first_name, canceller.last_name) AS cancelled_by_name,
        pn.pn_code,
        pn.status AS pn_status
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    LEFT JOIN users pt ON a.pt_id = pt.id
    JOIN clinics c ON a.clinic_id = c.id
    LEFT JOIN users creator ON a.created_by = creator.id
    LEFT JOIN users canceller ON a.cancelled_by = canceller.id
    LEFT JOIN pn_cases pn ON a.pn_case_id = pn.id
`;

// Get all appointments (with filters)
app.get('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { pt_id, clinic_id, start_date, end_date, status } = req.query;

        const accessibleClinics = await getAccessibleClinicIds(db, req.user);

        if (req.user.role === 'CLINIC' && accessibleClinics.length === 0) {
            return res.json([]);
        }

        let query = `${appointmentSelectClause} WHERE 1=1`;
        const params = [];

        if (req.user.role !== 'ADMIN' && accessibleClinics.length > 0) {
            query += ` AND a.clinic_id IN (${accessibleClinics.map(() => '?').join(',')})`;
            params.push(...accessibleClinics);
        }

        // Filter by PT
        if (pt_id) {
            query += ' AND a.pt_id = ?';
            params.push(pt_id);
        }

        // Filter by Clinic
        if (clinic_id) {
            query += ' AND a.clinic_id = ?';
            params.push(clinic_id);
        }

        // Filter by date range
        if (start_date) {
            query += ' AND a.appointment_date >= ?';
            params.push(start_date);
        }
        if (end_date) {
            query += ' AND a.appointment_date <= ?';
            params.push(end_date);
        }

        // Filter by status
        if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        } else {
            // By default, exclude CANCELLED appointments from calendar view
            query += ' AND a.status != ?';
            params.push('CANCELLED');
        }

        query += ' ORDER BY a.appointment_date, a.start_time';

        const [appointments] = await db.execute(query, params);

        res.json(appointments);
    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({ error: 'Failed to retrieve appointments' });
    }
});

// Check for appointment conflicts
app.post('/api/appointments/check-conflict', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { pt_id, appointment_date, start_time, end_time, exclude_appointment_id } = req.body;

        if (!pt_id || !appointment_date || !start_time || !end_time) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let query = `
            SELECT id, start_time, end_time,
                   CONCAT(p.first_name, ' ', p.last_name) as patient_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.pt_id = ?
              AND a.appointment_date = ?
              AND a.status != 'CANCELLED'
              AND (
                  (a.start_time < ? AND a.end_time > ?) OR
                  (a.start_time < ? AND a.end_time > ?) OR
                  (a.start_time >= ? AND a.end_time <= ?)
              )
        `;
        const params = [pt_id, appointment_date, end_time, start_time, end_time, start_time, start_time, end_time];

        // Exclude current appointment when rescheduling
        if (exclude_appointment_id) {
            query += ' AND a.id != ?';
            params.push(exclude_appointment_id);
        }

        const [conflicts] = await db.execute(query, params);

        res.json({
            hasConflict: conflicts.length > 0,
            conflicts: conflicts
        });
    } catch (error) {
        console.error('Check conflict error:', error);
        res.status(500).json({ error: 'Failed to check conflicts' });
    }
});

// Get available time slots for a specific date, clinic, and PT
app.get('/api/appointments/available-slots', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { date, clinic_id, pt_id } = req.query;

        if (!date || !clinic_id) {
            return res.status(400).json({ error: 'Date and clinic_id are required' });
        }

        // Define time slots (from 8:00 AM to 8:00 PM in 30-minute intervals)
        const timeSlots = [];
        for (let hour = 8; hour < 20; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const startHour = hour.toString().padStart(2, '0');
                const startMinute = minute.toString().padStart(2, '0');
                const endMinute = (minute + 30) % 60;
                const endHour = minute === 30 ? hour + 1 : hour;

                timeSlots.push({
                    start_time: `${startHour}:${startMinute}:00`,
                    end_time: `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}:00`,
                    label: `${startHour}:${startMinute} - ${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`
                });
            }
        }

        // Get existing appointments for the date and clinic
        let query = `
            SELECT start_time, end_time, pt_id
            FROM appointments
            WHERE appointment_date = ?
              AND clinic_id = ?
              AND status != 'CANCELLED'
        `;
        const params = [date, clinic_id];

        // If PT is specified, only check that PT's schedule
        if (pt_id) {
            query += ' AND pt_id = ?';
            params.push(pt_id);
        }

        const [existingAppointments] = await db.execute(query, params);

        // Mark slots as available or booked
        const availableSlots = timeSlots.map(slot => {
            // Check if this slot conflicts with any existing appointment
            const hasConflict = existingAppointments.some(apt => {
                // Check if the slot overlaps with the appointment
                return (
                    (slot.start_time < apt.end_time && slot.end_time > apt.start_time)
                );
            });

            return {
                ...slot,
                available: !hasConflict,
                booked: hasConflict
            };
        });

        res.json({
            date,
            clinic_id,
            pt_id: pt_id || null,
            slots: availableSlots
        });
    } catch (error) {
        console.error('Get available slots error:', error);
        res.status(500).json({ error: 'Failed to retrieve available time slots' });
    }
});

// Create new appointment
app.post('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            booking_type,  // NEW: 'WALK_IN' or 'OLD_PATIENT'
            patient_id,
            walk_in_name,   // NEW: For walk-in patients
            walk_in_phone,  // NEW: For walk-in patients
            pt_id,
            clinic_id,
            appointment_date,
            start_time,
            end_time,
            appointment_type,
            reason,
            notes,
            auto_create_pn,  // NEW: Flag to auto-create PN case
            course_id,       // NEW: Course ID for course cutting
            pn_case_id       // NEW: Link existing PN case to appointment
        } = req.body;

        // Check access - Only ADMIN and PT can create appointments
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({ error: 'Only ADMIN or PT can create appointments' });
        }

        // Validate booking type
        const validBookingType = booking_type || 'OLD_PATIENT';
        if (!['WALK_IN', 'OLD_PATIENT'].includes(validBookingType)) {
            return res.status(400).json({ error: 'Invalid booking_type' });
        }

        const sanitizedWalkInName = typeof walk_in_name === 'string' ? walk_in_name.trim() : walk_in_name;
        const sanitizedWalkInPhone = typeof walk_in_phone === 'string' ? walk_in_phone.trim() : walk_in_phone;

        // Validate required fields based on booking type
        if (validBookingType === 'WALK_IN') {
            if (!sanitizedWalkInName || !pt_id || !clinic_id || !appointment_date || !start_time || !end_time) {
                return res.status(400).json({ error: 'Missing required fields for walk-in booking' });
            }
        } else {
            // OLD_PATIENT
            if (!patient_id || !pt_id || !clinic_id || !appointment_date || !start_time || !end_time) {
                return res.status(400).json({ error: 'Missing required fields for patient booking' });
            }
        }

        // Check for conflicts
        const [conflicts] = await db.execute(
            `SELECT id FROM appointments
             WHERE pt_id = ? AND appointment_date = ? AND status != 'CANCELLED'
               AND (
                   (start_time < ? AND end_time > ?) OR
                   (start_time < ? AND end_time > ?) OR
                   (start_time >= ? AND end_time <= ?)
               )`,
            [pt_id, appointment_date, end_time, start_time, end_time, start_time, start_time, end_time]
        );

        if (conflicts.length > 0) {
            return res.status(409).json({ error: 'Time slot conflict detected' });
        }

        // Course validation if course_id is provided
        let validatedCourseId = null;
        if (course_id && validBookingType === 'OLD_PATIENT' && patient_id) {
            const [courses] = await db.execute(
                `SELECT id, course_code, remaining_sessions, status, patient_id, expiry_date
                 FROM courses WHERE id = ?`,
                [course_id]
            );

            if (courses.length === 0) {
                return res.status(404).json({ error: 'Course not found' });
            }

            const course = courses[0];

            // Validate course belongs to the patient
            if (course.patient_id !== parseInt(patient_id)) {
                return res.status(400).json({
                    error: 'Course does not belong to this patient'
                });
            }

            // Validate course status
            if (course.status !== 'ACTIVE') {
                return res.status(400).json({
                    error: `Course is ${course.status}. Only ACTIVE courses can be used.`
                });
            }

            // Validate remaining sessions
            if (course.remaining_sessions <= 0) {
                return res.status(400).json({
                    error: 'Course has no remaining sessions. Please purchase a new course.',
                    course_code: course.course_code,
                    remaining_sessions: course.remaining_sessions
                });
            }

            // Validate expiry date
            if (course.expiry_date && new Date(course.expiry_date) < new Date()) {
                return res.status(400).json({
                    error: 'Course has expired',
                    expiry_date: course.expiry_date
                });
            }

            // Course validation passed
            validatedCourseId = course_id;
        }

        let pnCaseId = pn_case_id || null;  // Use provided pn_case_id if exists
        let autoCreatedPN = false;

        // Auto-create PN case for OLD_PATIENT bookings if requested (and no pn_case_id provided)
        if (validBookingType === 'OLD_PATIENT' && auto_create_pn && patient_id && !pnCaseId) {
            try {
                // Get patient details
                const [patients] = await db.execute(
                    'SELECT clinic_id, first_name, last_name, diagnosis FROM patients WHERE id = ?',
                    [patient_id]
                );

                if (patients.length > 0) {
                    const patient = patients[0];
                    const pnCode = generatePNCode();

                    // Create PN case with PENDING status
                    const [pnResult] = await db.execute(
                        `INSERT INTO pn_cases (
                            pn_code, patient_id, diagnosis, purpose, status,
                            source_clinic_id, target_clinic_id, notes, created_by
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            pnCode,
                            patient_id,
                            patient.diagnosis || 'Appointment for physiotherapy treatment',
                            'Physiotherapy treatment from appointment booking',
                            'PENDING',
                            patient.clinic_id,
                            clinic_id,
                            `Auto-created from appointment on ${appointment_date}`,
                            req.user.id
                        ]
                    );

                    pnCaseId = pnResult.insertId;
                    autoCreatedPN = true;

                    console.log(`Auto-created PN case ${pnCode} (ID: ${pnCaseId}) for appointment`);
                }
            } catch (pnError) {
                console.error('Failed to auto-create PN case:', pnError);
                // Continue with appointment creation even if PN creation fails
            }
        }

        console.log('=== CREATING APPOINTMENT ===');
        console.log('PN Case ID:', pnCaseId);
        console.log('Patient ID:', patient_id);
        console.log('Clinic ID:', clinic_id);
        console.log('Auto Created PN:', autoCreatedPN);

        // Create appointment with new fields including course_id
        const [result] = await db.execute(
            `INSERT INTO appointments
             (patient_id, pt_id, clinic_id, appointment_date, start_time, end_time,
              appointment_type, booking_type, walk_in_name, walk_in_phone,
              pn_case_id, auto_created_pn, course_id, reason, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                validBookingType === 'OLD_PATIENT' ? patient_id : null,
                pt_id,
                clinic_id,
                appointment_date,
                start_time,
                end_time,
                appointment_type,
                validBookingType,
                validBookingType === 'WALK_IN' ? sanitizedWalkInName : null,
                validBookingType === 'WALK_IN' ? (sanitizedWalkInPhone || null) : null,
                pnCaseId,
                autoCreatedPN ? 1 : 0,
                validatedCourseId,
                reason,
                notes,
                req.user.id
            ]
        );

        // NOTE: Course session is NOT deducted here
        // Session will be deducted when appointment status changes to COMPLETED

        // Get created appointment details
        const [appointments] = await db.execute(
            `${appointmentSelectClause} WHERE a.id = ?`,
            [result.insertId]
        );

        const response = appointments[0];
        if (pnCaseId) {
            response.pn_case_id = pnCaseId;
            response.auto_created_pn = true;
        }

        // Send LINE notification for new appointment
        try {
            const appointmentData = appointments[0];
            const patientName = validBookingType === 'WALK_IN'
                ? sanitizedWalkInName
                : `${appointmentData.patient_first_name || ''} ${appointmentData.patient_last_name || ''}`.trim();
            const ptName = `${appointmentData.pt_first_name || ''} ${appointmentData.pt_last_name || ''}`.trim();
            const clinicName = appointmentData.clinic_name || 'N/A';

            const notificationMessage = `🏥 New Appointment Created

📋 Appointment ID: ${result.insertId}
👤 Patient: ${patientName || 'N/A'}
${validBookingType === 'WALK_IN' ? '🚶 Walk-in Patient' : ''}
👨‍⚕️ Physiotherapist: ${ptName}
🏢 Clinic: ${clinicName}
📅 Date: ${moment(appointment_date).format('DD/MM/YYYY')}
🕒 Time: ${start_time} - ${end_time}
📝 Type: ${appointment_type || 'N/A'}
${reason ? `💬 Reason: ${reason}` : ''}

${pnCaseId ? `✅ PN Case Created (ID: ${pnCaseId})` : ''}`;

            await sendLINENotification(db, 'newAppointment', notificationMessage);
        } catch (notifError) {
            console.error('Failed to send LINE notification:', notifError);
            // Don't fail the request if notification fails
        }

        // Create Google Calendar event
        try {
            const appointmentData = appointments[0];

            // Prepare data for calendar
            const calendarData = {
                appointment_date: appointment_date,
                start_time: start_time,
                end_time: end_time,
                patient_name: validBookingType === 'WALK_IN'
                    ? sanitizedWalkInName
                    : `${appointmentData.patient_first_name || ''} ${appointmentData.patient_last_name || ''}`.trim(),
                walk_in_name: validBookingType === 'WALK_IN' ? sanitizedWalkInName : null,
                pt_name: `${appointmentData.pt_first_name || ''} ${appointmentData.pt_last_name || ''}`.trim(),
                clinic_name: appointmentData.clinic_name || '',
                reason: reason,
                patient_email: appointmentData.patient_email || null
            };

            const calendarEventId = await createGoogleCalendarEvent(db, calendarData);

            if (calendarEventId) {
                // Store calendar event ID in database
                await db.execute(
                    'UPDATE appointments SET calendar_event_id = ? WHERE id = ?',
                    [calendarEventId, result.insertId]
                );
                response.calendar_event_id = calendarEventId;
            }
        } catch (calendarError) {
            console.error('Failed to create Google Calendar event:', calendarError);
            // Don't fail the request if calendar creation fails
        }

        // Send confirmation email to patient (only for OLD_PATIENT with email)
        try {
            if (validBookingType === 'OLD_PATIENT' && patient_id) {
                const appointmentData = appointments[0];
                const patientEmail = appointmentData.patient_email;

                if (patientEmail && patientEmail.includes('@')) {
                    console.log('Sending confirmation email to patient:', patientEmail);
                    const emailSent = await sendAppointmentConfirmationEmail(
                        db,
                        result.insertId,
                        patientEmail
                    );

                    if (emailSent) {
                        console.log('✅ Confirmation email sent to:', patientEmail);
                        response.email_sent = true;
                    } else {
                        console.log('⚠️ Email not sent (SMTP disabled or error)');
                        response.email_sent = false;
                    }
                } else {
                    console.log('⚠️ No patient email available');
                    response.email_sent = false;
                }
            } else {
                console.log('⚠️ Walk-in booking - no email sent');
                response.email_sent = false;
            }
        } catch (emailError) {
            console.error('❌ Failed to send confirmation email:', emailError);
            response.email_sent = false;
            // Don't fail the request if email sending fails
        }

        res.status(201).json(response);
    } catch (error) {
        console.error('Create appointment error:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});
// Cancel appointment
// Cancel appointment (with PN case sync)
app.delete('/api/appointments/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { cancellation_reason } = req.body;

        // Check access
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            return res.status(403).json({ error: 'Only ADMIN or PT can cancel appointments' });
        }

        // Get appointment with full details for notification
        const [appointments] = await db.execute(
            `SELECT a.*,
                    COALESCE(a.course_id, pn.course_id) as course_id,
                    pn.status as pn_status,
                    p.first_name as patient_first_name,
                    p.last_name as patient_last_name,
                    pt.first_name as pt_first_name,
                    pt.last_name as pt_last_name,
                    c.name as clinic_name
             FROM appointments a
             LEFT JOIN pn_cases pn ON a.pn_case_id = pn.id
             LEFT JOIN patients p ON a.patient_id = p.id
             LEFT JOIN users pt ON a.pt_id = pt.id
             LEFT JOIN clinics c ON a.clinic_id = c.id
             WHERE a.id = ?`,
            [id]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        const appointment = appointments[0];

        console.log('=== APPOINTMENT CANCELLATION ===');
        console.log('Appointment ID:', id);
        console.log('PN Case ID:', appointment.pn_case_id);
        console.log('PN Status:', appointment.pn_status);
        console.log('Course ID:', appointment.course_id);

        // Cancel appointment
        await db.execute(
            `UPDATE appointments
             SET status = 'CANCELLED',
                 cancellation_reason = ?,
                 cancelled_at = NOW(),
                 cancelled_by = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [cancellation_reason || '', req.user.id, id]
        );

        // Sync with PN case if linked
        if (appointment.pn_case_id) {
            // Return course session if PN was ACCEPTED (session was already deducted)
            if (appointment.pn_status === 'ACCEPTED' && appointment.course_id) {
                console.log('🔄 APPOINTMENT DELETION: Returning course session');
                console.log('   Appointment ID:', id);
                console.log('   PN Case ID:', appointment.pn_case_id);
                console.log('   PN Status:', appointment.pn_status);
                console.log('   Course ID:', appointment.course_id);

                await db.execute(
                    `UPDATE courses
                     SET used_sessions = used_sessions - 1,
                         remaining_sessions = remaining_sessions + 1,
                         status = CASE
                             WHEN status = 'COMPLETED' AND remaining_sessions + 1 > 0 THEN 'ACTIVE'
                             ELSE status
                         END,
                         updated_at = NOW()
                     WHERE id = ?`,
                    [appointment.course_id]
                );

                // Log course return
                await db.execute(
                    `INSERT INTO course_usage_history
                     (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                     VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'Appointment cancelled - session returned', ?)`,
                    [appointment.course_id, appointment.pn_case_id, req.user.id]
                ).catch(err => console.warn('Failed to log course return:', err.message));

                console.log('✅ Course session returned successfully');
            } else {
                console.log('ℹ️  No course session to return (PN status:', appointment.pn_status, ', course_id:', appointment.course_id, ')');
            }

            // Update PN case to CANCELLED
            await db.execute(
                `UPDATE pn_cases
                 SET status = 'CANCELLED',
                     cancelled_at = NOW(),
                     cancellation_reason = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [cancellation_reason || 'Cancelled from appointment', appointment.pn_case_id]
            );

            // Log status change
            await db.execute(
                `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, change_reason, is_reversal)
                 VALUES (?, ?, 'CANCELLED', ?, ?, FALSE)`,
                [appointment.pn_case_id, appointment.pn_status, req.user.id, cancellation_reason || 'Cancelled from appointment']
            ).catch(err => console.warn('Failed to log status history:', err.message));

            console.log('✅ Synced: Appointment CANCELLED → PN case CANCELLED');
        }

        // Send LINE notification for cancelled appointment
        try {
            const patientName = appointment.booking_type === 'WALK_IN'
                ? appointment.walk_in_name
                : `${appointment.patient_first_name || ''} ${appointment.patient_last_name || ''}`.trim();
            const ptName = `${appointment.pt_first_name || ''} ${appointment.pt_last_name || ''}`.trim();
            const clinicName = appointment.clinic_name || 'N/A';

            const notificationMessage = `❌ Appointment Cancelled

📋 Appointment ID: ${id}
👤 Patient: ${patientName || 'N/A'}
👨‍⚕️ Physiotherapist: ${ptName}
🏢 Clinic: ${clinicName}
📅 Date: ${moment(appointment.appointment_date).format('DD/MM/YYYY')}
🕒 Time: ${appointment.start_time} - ${appointment.end_time}
${cancellation_reason ? `💬 Reason: ${cancellation_reason}` : ''}

${appointment.pn_case_id ? `🔗 Linked PN Case also cancelled` : ''}`;

            await sendLINENotification(db, 'appointmentCancelled', notificationMessage);
        } catch (notifError) {
            console.error('Failed to send LINE notification:', notifError);
            // Don't fail the request if notification fails
        }

        // Delete Google Calendar event
        try {
            if (appointment.calendar_event_id) {
                const deleted = await deleteGoogleCalendarEvent(db, appointment.calendar_event_id);
                if (deleted) {
                    // Clear calendar_event_id from database
                    await db.execute(
                        'UPDATE appointments SET calendar_event_id = NULL WHERE id = ?',
                        [id]
                    );
                }
            }
        } catch (calendarError) {
            console.error('Failed to delete Google Calendar event:', calendarError);
            // Don't fail the request if calendar deletion fails
        }

        res.json({
            message: 'Appointment cancelled successfully',
            pn_synced: !!appointment.pn_case_id
        });
    } catch (error) {
        console.error('Cancel appointment error:', error);
        res.status(500).json({ error: 'Failed to cancel appointment' });
    }
});

// ========================================
// ATTACHMENT ROUTES (NEW)
// ========================================

// Upload attachment
app.post('/api/pn/:id/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const pnId = req.params.id;
        const file = req.file;
        const userId = req.user.id;

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Save to database
        const [result] = await db.execute(
            `INSERT INTO pn_attachments (pn_id, file_name, file_path, mime_type, file_size, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [pnId, file.originalname, file.path, file.mimetype, file.size, userId]
        );
        
        await auditLog(db, userId, 'UPLOAD_ATTACHMENT', 'pn_attachment', result.insertId, null, file, req);
        
        // Get the newly created attachment to send back
        const [newAttachment] = await db.execute(
            `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) as uploaded_by_name
             FROM pn_attachments a
             JOIN users u ON a.uploaded_by = u.id
             WHERE a.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'File uploaded successfully',
            attachment: newAttachment[0]
        });

    } catch (error) {
        console.error('Upload attachment error:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// Download attachment
app.get('/api/attachment/:id/download', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get attachment with associated PN case and clinics
        const [attachments] = await db.execute(
            `SELECT pa.*, pn.source_clinic_id, pn.target_clinic_id
             FROM pn_attachments pa
             JOIN pn_cases pn ON pa.pn_id = pn.id
             WHERE pa.id = ?`,
            [id]
        );

        if (attachments.length === 0) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const attachment = attachments[0];

        // Check clinic access
        if (req.user.role !== 'ADMIN' && req.user.role !== 'PT') {
            // CLINIC users can only access attachments for cases involving their clinic
            if (req.user.role === 'CLINIC') {
                const hasAccess = (
                    req.user.clinic_id === attachment.source_clinic_id ||
                    req.user.clinic_id === attachment.target_clinic_id
                );

                if (!hasAccess) {
                    return res.status(403).json({ error: 'No access to this attachment' });
                }
            } else {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
        }

        // Validate file path to prevent path traversal
        const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
        const filePath = path.resolve(attachment.file_path);

        if (!filePath.startsWith(uploadDir)) {
            console.error('Path traversal attempt detected:', filePath);
            return res.status(403).json({ error: 'Invalid file path' });
        }

        // Check file exists
        try {
            await fs.promises.access(filePath);
            res.download(filePath, attachment.file_name);
        } catch {
            return res.status(404).json({ error: 'File not found on server' });
        }

    } catch (error) {
        console.error('Download attachment error:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Delete attachment
app.delete('/api/attachment/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get attachment details with associated PN case
        const [attachments] = await db.execute(
            `SELECT pa.*, pn.source_clinic_id, pn.target_clinic_id
             FROM pn_attachments pa
             JOIN pn_cases pn ON pa.pn_id = pn.id
             WHERE pa.id = ?`,
            [id]
        );

        if (attachments.length === 0) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const attachment = attachments[0];

        // Check permissions (Admin, PT can always delete)
        const allowedRoles = ['ADMIN', 'PT', 'PT_ADMIN'];
        if (!allowedRoles.includes(req.user.role)) {
            // CLINIC users can only delete attachments for cases involving their clinic
            if (req.user.role === 'CLINIC') {
                const hasAccess = (
                    req.user.clinic_id === attachment.source_clinic_id ||
                    req.user.clinic_id === attachment.target_clinic_id
                );

                if (!hasAccess) {
                    return res.status(403).json({ error: 'No access to delete this attachment' });
                }
            } else {
                return res.status(403).json({ error: 'You do not have permission to delete this file' });
            }
        }

        // Validate file path to prevent path traversal
        const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
        const filePath = path.resolve(attachment.file_path);

        if (!filePath.startsWith(uploadDir)) {
            console.error('Path traversal attempt detected during delete:', filePath);
            return res.status(403).json({ error: 'Invalid file path' });
        }

        // Delete file from disk
        try {
            await fs.promises.unlink(filePath);
        } catch (err) {
            console.error(`Failed to delete file from disk: ${filePath}`, err);
            // Don't stop the process, just log it. We still want to remove the DB entry.
        }

        // Delete from database
        await db.execute('DELETE FROM pn_attachments WHERE id = ?', [id]);
        
        await auditLog(db, req.user.id, 'DELETE_ATTACHMENT', 'pn_attachment', id, attachment, null, req);

        res.json({ success: true, message: 'Attachment deleted successfully' });

    } catch (error) {
        console.error('Delete attachment error:', error);
        res.status(500).json({ error: 'Failed to delete attachment' });
    }
});


// ========================================
// VISITS AND REPORTS ROUTES
// ========================================

// Create visit
app.post('/api/pn/:id/visit', authenticateToken, [
    body('visit_date').isDate(),
    body('status').isIn(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const db = req.app.locals.db;
        const pnId = req.params.id;
        
        // Get next visit number
        const [maxVisit] = await db.execute(
            'SELECT MAX(visit_no) as max_no FROM pn_visits WHERE pn_id = ?',
            [pnId]
        );
        
        const visitNo = (maxVisit[0].max_no || 0) + 1;
        
        const [result] = await db.execute(
            `INSERT INTO pn_visits (
                pn_id, visit_no, visit_date, visit_time, status,
                chief_complaint, subjective, objective, assessment, plan,
                treatment_provided, therapist_id, duration_minutes, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pnId, visitNo, req.body.visit_date, req.body.visit_time || null,
                req.body.status || 'SCHEDULED',
                req.body.chief_complaint || null, req.body.subjective || null,
                req.body.objective || null, req.body.assessment || null,
                req.body.plan || null, req.body.treatment_provided || null,
                req.body.therapist_id || req.user.id, req.body.duration_minutes || null,
                req.body.notes || null, req.user.id
            ]
        );
        
        await auditLog(db, req.user.id, 'CREATE', 'visit', result.insertId, null, req.body, req);
        
        res.status(201).json({
            success: true,
            message: 'Visit created successfully',
            visit_id: result.insertId,
            visit_no: visitNo
        });
    } catch (error) {
        console.error('Create visit error:', error);
        res.status(500).json({ error: 'Failed to create visit' });
    }
});

// Generate and save report
app.post('/api/visit/:id/report', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const visitId = req.params.id;
        
        // Get visit and case details
        const [visits] = await db.execute(
            `SELECT v.*, pn.pn_code, pn.diagnosis, pn.purpose,
                    p.hn, p.pt_number, p.first_name, p.last_name, p.dob,
                    c.name as clinic_name, c.address as clinic_address
             FROM pn_visits v
             JOIN pn_cases pn ON v.pn_id = pn.id
             JOIN patients p ON pn.patient_id = p.id
             JOIN clinics c ON pn.target_clinic_id = c.id
             WHERE v.id = ?`,
            [visitId]
        );
        
        if (visits.length === 0) {
            return res.status(404).json({ error: 'Visit not found' });
        }
        
        const visit = visits[0];
        const fileName = `report_${visit.pn_code}_visit${visit.visit_no}_${Date.now()}.pdf`;
        const filePath = path.join(process.env.REPORTS_DIR || './reports', fileName);
        
        // Create PDF
        const doc = new PDFDocument();
        const writeStream = require('fs').createWriteStream(filePath);
        const stream = doc.pipe(writeStream);
        
        // Header
        doc.fontSize(20).text('Physiotherapy Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(visit.clinic_name, { align: 'center' });
        doc.fontSize(10).text(visit.clinic_address || '', { align: 'center' });
        doc.moveDown();
        
        // Report info
        doc.fontSize(12);
        doc.text(`Report Date: ${moment().format('DD/MM/YYYY HH:mm')}`);
        doc.text(`PN Code: ${visit.pn_code}`);
        doc.text(`Visit No: ${visit.visit_no}`);
        doc.moveDown();
        
        // Patient info
        doc.fontSize(14).text('Patient Information', { underline: true });
        doc.fontSize(11);
        doc.text(`HN: ${visit.hn}`);
        doc.text(`PT Number: ${visit.pt_number}`);
        doc.text(`Name: ${visit.first_name} ${visit.last_name}`);
        doc.text(`DOB: ${moment(visit.dob).format('DD/MM/YYYY')}`);
        doc.text(`Diagnosis: ${visit.diagnosis}`);
        doc.moveDown();
        
        // Visit details
        doc.fontSize(14).text('Visit Details', { underline: true });
        doc.fontSize(11);
        doc.text(`Visit Date: ${moment(visit.visit_date).format('DD/MM/YYYY')}`);
        doc.text(`Status: ${visit.status}`);
        
        if (visit.chief_complaint) {
            doc.moveDown();
            doc.text('Chief Complaint:', { underline: true });
            doc.text(visit.chief_complaint);
        }
        
        if (visit.subjective) {
            doc.moveDown();
            doc.text('Subjective:', { underline: true });
            doc.text(visit.subjective);
        }
        
        if (visit.objective) {
            doc.moveDown();
            doc.text('Objective:', { underline: true });
            doc.text(visit.objective);
        }
        
        if (visit.assessment) {
            doc.moveDown();
            doc.text('Assessment:', { underline: true });
            doc.text(visit.assessment);
        }
        
        if (visit.plan) {
            doc.moveDown();
            doc.text('Plan:', { underline: true });
            doc.text(visit.plan);
        }
        
        if (visit.treatment_provided) {
            doc.moveDown();
            doc.text('Treatment Provided:', { underline: true });
            doc.text(visit.treatment_provided);
        }
        
        // Generate QR code for download link
        const downloadUrl = `${process.env.APP_BASE_URL}/api/report/${visitId}/download`;
        const qrCode = await QRCode.toDataURL(downloadUrl);
        
        // Add QR code to PDF
        doc.moveDown();
        doc.text('Scan QR code to download this report:', { align: 'center' });
        doc.image(qrCode, doc.page.width / 2 - 50, doc.y + 10, { width: 100 });
        
        // Footer
        doc.fontSize(10);
        doc.text(`Generated on ${moment().format('DD/MM/YYYY HH:mm:ss')}`, 
                50, doc.page.height - 50, { align: 'center' });
        
        doc.end();
        
        // Wait for PDF to be written
        await new Promise((resolve) => stream.on('finish', resolve));
        
        // Save report record to database
        const [result] = await db.execute(
            `INSERT INTO pn_reports (
                visit_id, report_type, file_path, file_name, 
                mime_type, file_size, qr_code, report_data, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                visitId,
                req.body.report_type || 'PROGRESS',
                filePath,
                fileName,
                'application/pdf',
                (await require('fs').promises.stat(filePath)).size,
                qrCode,
                JSON.stringify(visit),
                req.user.id
            ]
        );
        
        await auditLog(db, req.user.id, 'CREATE', 'report', result.insertId, null, 
                      { visit_id: visitId }, req);
        
        res.json({
            success: true,
            message: 'Report generated successfully',
            report_id: result.insertId,
            download_url: `/api/report/${result.insertId}/download`
        });
    } catch (error) {
        console.error('Generate report error:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Download report
app.get('/api/report/:id/download', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        
        const [reports] = await db.execute(
            'SELECT * FROM pn_reports WHERE id = ?',
            [id]
        );
        
        if (reports.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const report = reports[0];
        
        // Check if file exists
        try {
            await require('fs').promises.access(report.file_path);
        } catch {
            return res.status(404).json({ error: 'Report file not found' });
        }
        
        res.download(report.file_path, report.file_name);
    } catch (error) {
        console.error('Download report error:', error);
        res.status(500).json({ error: 'Failed to download report' });
    }
});

// ========================================
// DATABASE DIAGNOSTIC ROUTE
// ========================================

// Check database structure for course-related tables
app.get('/api/diagnostic/db-structure', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const results = {};

        // Check if courses table exists
        try {
            const [coursesDesc] = await db.execute('DESCRIBE courses');
            results.courses_table = { exists: true, columns: coursesDesc.map(c => c.Field) };
        } catch (e) {
            results.courses_table = { exists: false, error: e.message };
        }

        // Check if course_templates table exists
        try {
            const [templatesDesc] = await db.execute('DESCRIBE course_templates');
            results.course_templates_table = { exists: true, columns: templatesDesc.map(c => c.Field) };
        } catch (e) {
            results.course_templates_table = { exists: false, error: e.message };
        }

        // Check if course_usage_history table exists
        try {
            const [historyDesc] = await db.execute('DESCRIBE course_usage_history');
            results.course_usage_history_table = { exists: true, columns: historyDesc.map(c => c.Field) };
        } catch (e) {
            results.course_usage_history_table = { exists: false, error: e.message };
        }

        // Check if pn_cases has course_id column
        try {
            const [pnDesc] = await db.execute('DESCRIBE pn_cases');
            const hasCourseId = pnDesc.some(c => c.Field === 'course_id');
            results.pn_cases_course_id = { exists: hasCourseId, all_columns: pnDesc.map(c => c.Field) };
        } catch (e) {
            results.pn_cases_course_id = { exists: false, error: e.message };
        }

        res.json(results);
    } catch (error) {
        console.error('Diagnostic error:', error);
        res.status(500).json({ error: 'Diagnostic failed', details: error.message });
    }
});

// CLINIC MANAGEMENT ROUTES
// ========================================

// Get clinics
app.get('/api/clinics', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        let query = 'SELECT * FROM clinics WHERE active = 1';
        const params = [];
        
        // If not admin, only show accessible clinics
        if (req.user.role !== 'ADMIN') {
            const [grants] = await db.execute(
                'SELECT clinic_id FROM user_clinic_grants WHERE user_id = ? UNION SELECT ? as clinic_id WHERE ? IS NOT NULL',
                [req.user.id, req.user.clinic_id, req.user.clinic_id]
            );
            
            if (grants.length > 0) {
                const clinicIds = grants.map(g => g.clinic_id).filter(id => id);
                query += ` AND id IN (${clinicIds.map(() => '?').join(',')})`;
                params.push(...clinicIds);
            }
        }
        
        query += ' ORDER BY name';
        
        const [clinics] = await db.execute(query, params);
        res.json(clinics);
    } catch (error) {
        console.error('Get clinics error:', error);
        res.status(500).json({ error: 'Failed to retrieve clinics' });
    }
});

// Get users by role (for appointments, etc.)
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { role } = req.query;

        let query = 'SELECT id, email, first_name, last_name, role, clinic_id FROM users WHERE active = 1';
        const params = [];

        // Filter by role if provided
        if (role) {
            query += ' AND role = ?';
            params.push(role);
        }

        query += ' ORDER BY first_name, last_name';

        const [users] = await db.execute(query, params);
        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to retrieve users' });
    }
});

// ========================================
// ADMIN ROUTES
// ========================================

// Get all users (Admin only)
app.get('/api/admin/users', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        
        const [users] = await db.execute(
            `SELECT u.*, c.name as clinic_name
             FROM users u
             LEFT JOIN clinics c ON u.clinic_id = c.id
             ORDER BY u.created_at DESC`
        );
        
        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to retrieve users' });
    }
});

// Create user (Admin only)
app.post('/api/admin/users', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { email, password, role, first_name, last_name, clinic_id, phone, license_number } = req.body;
        
        // Check if email exists
        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        
        const hashedPassword = await hashPassword(password);
        
        const [result] = await db.execute(
            `INSERT INTO users (email, password_hash, role, first_name, last_name, clinic_id, phone, license_number, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [email, hashedPassword, role, first_name, last_name, clinic_id, phone, license_number, true]
        );
        
        await auditLog(db, req.user.id, 'CREATE', 'user', result.insertId, null, req.body, req);
        
        res.status(201).json({ success: true, user_id: result.insertId });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user (Admin only)
app.put('/api/admin/users/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { email, first_name, last_name, role, clinic_id, phone, license_number, active, password } = req.body;

        console.log('Update user request for ID:', id);
        console.log('Has password in request:', !!password);

        const updateFields = [];
        const updateValues = [];

        if (email !== undefined) {
            // Check if email is already taken by another user
            const [existingUsers] = await db.execute(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [email, id]
            );
            if (existingUsers.length > 0) {
                return res.status(400).json({ error: 'Email already in use by another user' });
            }
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        if (first_name !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        if (last_name !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        if (role !== undefined) {
            updateFields.push('role = ?');
            updateValues.push(role);
        }
        if (clinic_id !== undefined) {
            updateFields.push('clinic_id = ?');
            updateValues.push(clinic_id);
        }
        if (phone !== undefined) {
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        if (license_number !== undefined) {
            updateFields.push('license_number = ?');
            updateValues.push(license_number);
        }
        if (active !== undefined) {
            updateFields.push('active = ?');
            updateValues.push(active);
        }
        if (password && password.trim() !== '') {
            console.log('Updating password for user:', id);
            const hashedPassword = await hashPassword(password);
            updateFields.push('password_hash = ?');
            updateValues.push(hashedPassword);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        updateFields.push('updated_at = NOW()');
        updateValues.push(id);
        
        await db.execute(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        console.log('User updated successfully. Fields updated:', updateFields.map(f => f.split(' = ')[0]));

        await auditLog(db, req.user.id, 'UPDATE', 'user', id, null, req.body, req);

        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Toggle user status (Admin only)
app.patch('/api/admin/users/:id/status', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { active } = req.body;
        
        await db.execute(
            'UPDATE users SET active = ?, updated_at = NOW() WHERE id = ?',
            [active, id]
        );
        
        await auditLog(db, req.user.id, 'UPDATE_STATUS', 'user', id, null, { active }, req);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Toggle user status error:', error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
});

// Get user clinic grants
app.get('/api/admin/users/:id/grants', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        
        const [grants] = await db.execute(
            `SELECT g.*, c.name as clinic_name
             FROM user_clinic_grants g
             JOIN clinics c ON g.clinic_id = c.id
             WHERE g.user_id = ?`,
            [id]
        );
        
        res.json(grants);
    } catch (error) {
        console.error('Get user grants error:', error);
        res.status(500).json({ error: 'Failed to retrieve grants' });
    }
});

// Add clinic grant
app.post('/api/admin/grants', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { user_id, clinic_id } = req.body;
        
        // Check if grant already exists
        const [existing] = await db.execute(
            'SELECT id FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ?',
            [user_id, clinic_id]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Grant already exists' });
        }
        
        await db.execute(
            'INSERT INTO user_clinic_grants (user_id, clinic_id, granted_by) VALUES (?, ?, ?)',
            [user_id, clinic_id, req.user.id]
        );
        
        await auditLog(db, req.user.id, 'CREATE', 'grant', null, null, { user_id, clinic_id }, req);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Add grant error:', error);
        res.status(500).json({ error: 'Failed to add grant' });
    }
});

// Remove clinic grant
app.delete('/api/admin/grants/:userId/:clinicId', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { userId, clinicId } = req.params;
        
        await db.execute(
            'DELETE FROM user_clinic_grants WHERE user_id = ? AND clinic_id = ?',
            [userId, clinicId]
        );
        
        await auditLog(db, req.user.id, 'DELETE', 'grant', null, { user_id: userId, clinic_id: clinicId }, null, req);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Remove grant error:', error);
        res.status(500).json({ error: 'Failed to remove grant' });
    }
});

// Get all clinics with statistics (Admin only)
app.get('/api/admin/clinics', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        
        const [clinics] = await db.execute(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM patients WHERE clinic_id = c.id) as patient_count,
                    (SELECT COUNT(*) FROM pn_cases WHERE source_clinic_id = c.id OR target_clinic_id = c.id) as case_count,
                    (SELECT COUNT(*) FROM users WHERE clinic_id = c.id AND active = 1) as user_count
             FROM clinics c
             ORDER BY c.name`
        );
        
        const [stats] = await db.execute(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active,
                (SELECT COUNT(*) FROM patients) as total_patients,
                (SELECT COUNT(*) FROM pn_cases) as total_cases
             FROM clinics`
        );
        
        res.json({
            clinics,
            statistics: stats[0]
        });
    } catch (error) {
        console.error('Get clinics error:', error);
        res.status(500).json({ error: 'Failed to retrieve clinics' });
    }
});

// Create clinic (Admin only)
app.post('/api/admin/clinics', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { code, name, address, phone, email, contact_person } = req.body;
        
        // Check if code exists
        const [existing] = await db.execute(
            'SELECT id FROM clinics WHERE code = ?',
            [code]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Clinic code already exists' });
        }
        
        const [result] = await db.execute(
            `INSERT INTO clinics (code, name, address, phone, email, contact_person, active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [code, name, address, phone, email, contact_person, true]
        );
        
        await auditLog(db, req.user.id, 'CREATE', 'clinic', result.insertId, null, req.body, req);
        
        res.status(201).json({ success: true, clinic_id: result.insertId });
    } catch (error) {
        console.error('Create clinic error:', error);
        res.status(500).json({ error: 'Failed to create clinic' });
    }
});

// Update clinic (Admin only)
app.put('/api/admin/clinics/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { code, name, address, phone, email, contact_person, active } = req.body;
        
        const updateFields = [];
        const updateValues = [];
        
        if (code !== undefined) {
            updateFields.push('code = ?');
            updateValues.push(code);
        }
        if (name !== undefined) {
            updateFields.push('name = ?');
            updateValues.push(name);
        }
        if (address !== undefined) {
            updateFields.push('address = ?');
            updateValues.push(address);
        }
        if (phone !== undefined) {
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        if (email !== undefined) {
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        if (contact_person !== undefined) {
            updateFields.push('contact_person = ?');
            updateValues.push(contact_person);
        }
        if (active !== undefined) {
            updateFields.push('active = ?');
            updateValues.push(active);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        updateFields.push('updated_at = NOW()');
        updateValues.push(id);
        
        await db.execute(
            `UPDATE clinics SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );
        
        await auditLog(db, req.user.id, 'UPDATE', 'clinic', id, null, req.body, req);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Update clinic error:', error);
        res.status(500).json({ error: 'Failed to update clinic' });
    }
});

// Toggle clinic status (Admin only)
app.patch('/api/admin/clinics/:id/status', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { active } = req.body;
        
        await db.execute(
            'UPDATE clinics SET active = ?, updated_at = NOW() WHERE id = ?',
            [active, id]
        );
        
        await auditLog(db, req.user.id, 'UPDATE_STATUS', 'clinic', id, null, { active }, req);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Toggle clinic status error:', error);
        res.status(500).json({ error: 'Failed to update clinic status' });
    }
});

// Get clinic details (Admin only)
app.get('/api/admin/clinics/:id/details', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        
        const [clinic] = await db.execute(
            'SELECT * FROM clinics WHERE id = ?',
            [id]
        );
        
        if (clinic.length === 0) {
            return res.status(404).json({ error: 'Clinic not found' });
        }
        
        const [stats] = await db.execute(
            `SELECT 
                (SELECT COUNT(*) FROM patients WHERE clinic_id = ?) as patient_count,
                (SELECT COUNT(*) FROM pn_cases WHERE source_clinic_id = ? OR target_clinic_id = ?) as case_count,
                (SELECT COUNT(*) FROM users WHERE clinic_id = ? AND active = 1) as user_count`,
            [id, id, id, id]
        );
        
        const [recentCases] = await db.execute(
            `SELECT pn.pn_code, pn.status, pn.created_at,
                    CONCAT(p.first_name, ' ', p.last_name) as patient_name
             FROM pn_cases pn
             JOIN patients p ON pn.patient_id = p.id
             WHERE pn.source_clinic_id = ? OR pn.target_clinic_id = ?
             ORDER BY pn.created_at DESC
             LIMIT 5`,
            [id, id]
        );
        
        res.json({
            ...clinic[0],
            ...stats[0],
            recent_cases: recentCases
        });
    } catch (error) {
        console.error('Get clinic details error:', error);
        res.status(500).json({ error: 'Failed to retrieve clinic details' });
    }
});

// ========================================
// NEW FEATURES API ROUTES
// ========================================

// APPOINTMENTS API (with fixed IDs for old patients vs walk-ins)
//app.js line 7898

const generateAppointmentCode = (bookingType) => {
    const timestamp = moment().format('YYYYMMDD');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return bookingType === 'WALK_IN' ? `WI-${timestamp}-${random}` : `APT-${timestamp}-${random}`;
};

const generateWalkInId = async (db) => {
    const [rows] = await db.execute(
        `SELECT walk_in_id FROM appointments WHERE booking_type = 'WALK_IN' ORDER BY id DESC LIMIT 1`
    );
    let nextNumber = 1;
    if (rows.length > 0 && rows[0].walk_in_id) {
        const lastNumber = parseInt(rows[0].walk_in_id.split('-')[1]);
        nextNumber = lastNumber + 1;
    }
    return `WI-${nextNumber.toString().padStart(6, '0')}`;
};

// Note: GET /api/appointments endpoint already exists at line ~1906 with clinic access control
// Create appointment
app.post('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            patient_id, pt_id, clinic_id, appointment_date, start_time, end_time,
            appointment_type, booking_type, walk_in_name, walk_in_phone, reason, notes
        } = req.body;

        const appointment_code = generateAppointmentCode(booking_type);
        const walk_in_id = booking_type === 'WALK_IN' ? await generateWalkInId(db) : null;

        const [result] = await db.execute(
            `INSERT INTO appointments (
                appointment_code, patient_id, pt_id, clinic_id, appointment_date,
                start_time, end_time, appointment_type, booking_type, walk_in_name,
                walk_in_phone, walk_in_id, reason, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [appointment_code, patient_id || null, pt_id, clinic_id, appointment_date,
             start_time, end_time, appointment_type, booking_type, walk_in_name,
             walk_in_phone, walk_in_id, reason, notes, req.user.id]
        );

        res.status(201).json({
            message: 'Appointment created successfully',
            id: result.insertId,
            appointment_code,
            walk_in_id
        });
    } catch (error) {
        console.error('Create appointment error:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

// Update appointment (with PN case sync)
app.put('/api/appointments/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            appointment_date,
            start_time,
            end_time,
            status,
            appointment_type,
            reason,
            notes,
            booking_type,
            patient_id,
            walk_in_name,
            walk_in_phone,
            pt_diagnosis,
            pt_chief_complaint,
            pt_present_history,
            pt_pain_score
        } = req.body;

        // Get appointment details with linked PN case, clinic info, and course info
        const [appointments] = await db.execute(
            `SELECT a.*,
                    p.id as patient_id,
                    COALESCE(a.course_id, pn.course_id) as course_id,
                    pn.status as pn_status,
                    sc.code as source_clinic_code,
                    tc.code as target_clinic_code,
                    c.code as clinic_code,
                    c.name as clinic_name
             FROM appointments a
             LEFT JOIN pn_cases pn ON a.pn_case_id = pn.id
             LEFT JOIN patients p ON a.patient_id = p.id
             LEFT JOIN clinics sc ON pn.source_clinic_id = sc.id
             LEFT JOIN clinics tc ON pn.target_clinic_id = tc.id
             LEFT JOIN clinics c ON a.clinic_id = c.id
             WHERE a.id = ?`,
            [id]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        const appointment = appointments[0];

        console.log('=== APPOINTMENT UPDATE ===');
        console.log('Appointment ID:', id);
        console.log('Appointment Clinic Code:', appointment.clinic_code);
        console.log('Appointment Clinic Name:', appointment.clinic_name);
        console.log('Old Status:', appointment.status);
        console.log('New Status:', status);
        console.log('Linked PN Case ID:', appointment.pn_case_id);
        console.log('PN Current Status:', appointment.pn_status);
        console.log('PN Source Clinic Code:', appointment.source_clinic_code);
        console.log('PN Target Clinic Code:', appointment.target_clinic_code);
        console.log('Course ID:', appointment.course_id);

        // Check for time conflicts if rescheduling
        if (appointment_date && start_time && end_time) {
            const [conflicts] = await db.execute(
                `SELECT id FROM appointments
                 WHERE pt_id = ? AND appointment_date = ? AND status != 'CANCELLED' AND id != ?
                   AND (
                       (start_time < ? AND end_time > ?) OR
                       (start_time < ? AND end_time > ?) OR
                       (start_time >= ? AND end_time <= ?)
                   )`,
                [appointment.pt_id, appointment_date, id, end_time, start_time, end_time, start_time, start_time, end_time]
            );

            if (conflicts.length > 0) {
                return res.status(409).json({ error: 'Time slot conflict detected' });
            }
        }

        // Build dynamic update query
        const updates = [];
        const params = [];

        if (appointment_date) {
            updates.push('appointment_date = ?');
            params.push(appointment_date);
        }
        if (start_time) {
            updates.push('start_time = ?');
            params.push(start_time);
        }
        if (end_time) {
            updates.push('end_time = ?');
            params.push(end_time);
        }
        if (status) {
            updates.push('status = ?');
            params.push(status);
        }
        if (appointment_type !== undefined) {
            updates.push('appointment_type = ?');
            params.push(appointment_type);
        }
        if (reason !== undefined) {
            updates.push('reason = ?');
            params.push(reason);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        // Handle booking_type changes
        const normalizedBookingType = booking_type ? booking_type.toUpperCase() : null;
        if (normalizedBookingType && !['OLD_PATIENT', 'WALK_IN'].includes(normalizedBookingType)) {
            return res.status(400).json({ error: 'Invalid booking_type' });
        }

        const trimmedWalkInName = typeof walk_in_name === 'string' ? walk_in_name.trim() : walk_in_name;
        const trimmedWalkInPhone = typeof walk_in_phone === 'string' ? walk_in_phone.trim() : walk_in_phone;

        if (normalizedBookingType) {
            updates.push('booking_type = ?');
            params.push(normalizedBookingType);

            if (normalizedBookingType === 'OLD_PATIENT') {
                if (!patient_id) {
                    return res.status(400).json({ error: 'patient_id is required for OLD_PATIENT bookings' });
                }
                updates.push('patient_id = ?');
                params.push(patient_id);
                updates.push('walk_in_name = NULL');
                updates.push('walk_in_phone = NULL');
            } else if (normalizedBookingType === 'WALK_IN') {
                if (!trimmedWalkInName) {
                    return res.status(400).json({ error: 'walk_in_name is required for WALK_IN bookings' });
                }
                updates.push('patient_id = NULL');
                updates.push('walk_in_name = ?');
                params.push(trimmedWalkInName);
                updates.push('walk_in_phone = ?');
                params.push(trimmedWalkInPhone || null);
            }
        }

        // Update appointment if there are changes
        if (updates.length > 0) {
            updates.push('updated_at = CURRENT_TIMESTAMP');
            params.push(id);

            await db.execute(
                `UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`,
                params
            );
        }

        // Sync with PN case if linked
        console.log('=== CHECKING PN CASE SYNC ===');
        console.log('appointment.pn_case_id:', appointment.pn_case_id);
        console.log('status param:', status);
        console.log('Should sync?', appointment.pn_case_id ? 'YES' : 'NO - pn_case_id is null/undefined');

        if (appointment.pn_case_id) {
            console.log('✅ PN case is linked, checking status...');

            // COMPLETED → ACCEPTED (Accept the PN case)
            if (status === 'COMPLETED') {
                console.log('✅ Status is COMPLETED, proceeding with PN acceptance...');

                // Check if this is a CL001 clinic appointment
                // Use appointment's clinic code first, fall back to PN case source/target clinics
                const isCL001 = appointment.clinic_code === 'CL001' ||
                                appointment.source_clinic_code === 'CL001' ||
                                appointment.target_clinic_code === 'CL001';

                console.log('=== PN CASE ACCEPTANCE LOGIC ===');
                console.log('Appointment Clinic Code:', appointment.clinic_code);
                console.log('Source Clinic Code:', appointment.source_clinic_code);
                console.log('Target Clinic Code:', appointment.target_clinic_code);
                console.log('Is CL001:', isCL001);

                // For non-CL001 clinics, PT assessment is required
                if (!isCL001) {
                    if (!pt_diagnosis || !pt_chief_complaint || !pt_present_history || pt_pain_score === undefined) {
                        return res.status(400).json({
                            error: 'PT assessment required for non-CL001 clinics',
                            required_fields: ['pt_diagnosis', 'pt_chief_complaint', 'pt_present_history', 'pt_pain_score']
                        });
                    }

                    // Update PN case with PT assessment and set to ACCEPTED
                    console.log('Updating PN case with PT assessment...');
                    const [pnUpdateResult] = await db.execute(
                        `UPDATE pn_cases
                         SET status = 'ACCEPTED',
                             accepted_at = NOW(),
                             pt_diagnosis = ?,
                             pt_chief_complaint = ?,
                             pt_present_history = ?,
                             pt_pain_score = ?,
                             updated_at = NOW()
                         WHERE id = ?`,
                        [pt_diagnosis, pt_chief_complaint, pt_present_history, pt_pain_score, appointment.pn_case_id]
                    );
                    console.log('PN case update result - rows affected:', pnUpdateResult.affectedRows);
                } else {
                    // CL001: Just set to ACCEPTED without PT assessment
                    console.log('CL001 clinic - updating PN case without PT assessment...');
                    const [pnUpdateResult] = await db.execute(
                        `UPDATE pn_cases
                         SET status = 'ACCEPTED',
                             accepted_at = NOW(),
                             updated_at = NOW()
                         WHERE id = ?`,
                        [appointment.pn_case_id]
                    );
                    console.log('PN case update result - rows affected:', pnUpdateResult.affectedRows);
                }

                // Handle course session deduction (only if not already deducted)
                if (appointment.course_id) {
                    // Check if course session was already deducted for this PN
                    const [usageHistory] = await db.execute(
                        `SELECT id FROM course_usage_history
                         WHERE course_id = ? AND pn_id = ? AND action_type = 'USE'
                         LIMIT 1`,
                        [appointment.course_id, appointment.pn_case_id]
                    );

                    if (usageHistory.length === 0) {
                        // No session deducted yet - deduct now
                        console.log('Deducting course session for course:', appointment.course_id);

                        await db.execute(
                            `UPDATE courses
                             SET used_sessions = used_sessions + 1,
                                 remaining_sessions = remaining_sessions - 1,
                                 status = CASE
                                     WHEN remaining_sessions - 1 <= 0 THEN 'COMPLETED'
                                     ELSE status
                                 END,
                                 updated_at = NOW()
                             WHERE id = ?`,
                            [appointment.course_id]
                        );

                        // Log course usage
                        await db.execute(
                            `INSERT INTO course_usage_history
                             (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                             VALUES (?, NULL, ?, 1, CURDATE(), 'USE', 'Appointment completed - PN case accepted - session deducted', ?)`,
                            [appointment.course_id, appointment.pn_case_id, req.user.id]
                        ).catch(err => console.warn('Failed to log course usage:', err.message));

                        console.log('✅ Course session deducted');
                    } else {
                        console.log('ℹ️  Course session already deducted for this PN - skipping');
                    }
                }

                // Log status change
                await db.execute(
                    `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, is_reversal)
                     VALUES (?, ?, 'ACCEPTED', ?, FALSE)`,
                    [appointment.pn_case_id, appointment.pn_status, req.user.id]
                ).catch(err => console.warn('Failed to log status history:', err.message));

                console.log('✅ Synced: Appointment COMPLETED → PN case ACCEPTED');
            }
            // SCHEDULED ← COMPLETED: Reverse to PENDING and return course session (ADMIN only)
            else if (status === 'SCHEDULED' && appointment.status === 'COMPLETED') {
                // Only ADMIN can reverse appointments
                if (req.user.role !== 'ADMIN') {
                    return res.status(403).json({ error: 'Only ADMIN can reverse completed appointments' });
                }

                // Reverse PN case to PENDING
                await db.execute(
                    `UPDATE pn_cases
                     SET status = 'PENDING',
                         accepted_at = NULL,
                         pt_diagnosis = NULL,
                         pt_chief_complaint = NULL,
                         pt_present_history = NULL,
                         pt_pain_score = NULL,
                         updated_at = NOW()
                     WHERE id = ?`,
                    [appointment.pn_case_id]
                );

                // Return course session if it was deducted (check course_usage_history)
                if (appointment.course_id) {
                    // Check if course session was deducted for this PN
                    const [usageHistory] = await db.execute(
                        `SELECT id FROM course_usage_history
                         WHERE course_id = ? AND pn_id = ? AND action_type = 'USE'
                         LIMIT 1`,
                        [appointment.course_id, appointment.pn_case_id]
                    );

                    if (usageHistory.length > 0) {
                        // Session was deducted - return it
                        console.log('Appointment reversed: Returning session to course:', appointment.course_id);

                        await db.execute(
                            `UPDATE courses
                             SET used_sessions = GREATEST(0, used_sessions - 1),
                                 remaining_sessions = remaining_sessions + 1,
                                 status = CASE
                                     WHEN status = 'COMPLETED' AND remaining_sessions + 1 > 0 THEN 'ACTIVE'
                                     ELSE status
                                 END,
                                 updated_at = NOW()
                             WHERE id = ?`,
                            [appointment.course_id]
                        );

                        // Log course return
                        await db.execute(
                            `INSERT INTO course_usage_history
                             (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                             VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'Appointment reversed - session returned', ?)`,
                            [appointment.course_id, appointment.pn_case_id, req.user.id]
                        ).catch(err => console.warn('Failed to log course return:', err.message));

                        console.log('✅ Course session returned');
                    } else {
                        console.log('ℹ️  No course session to return (session not deducted)');
                    }
                }

                // Log status change
                await db.execute(
                    `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, is_reversal)
                     VALUES (?, ?, 'PENDING', ?, TRUE)`,
                    [appointment.pn_case_id, appointment.pn_status, req.user.id]
                ).catch(err => console.warn('Failed to log status history:', err.message));

                console.log('✅ Synced: Appointment SCHEDULED ← PN case PENDING (reversed)');
            }
            // CANCELLED: Return course session if was COMPLETED/ACCEPTED
            else if (status === 'CANCELLED') {
                console.log('🔄 APPOINTMENT CANCELLATION - Checking if need to return course session');
                console.log('   Appointment Old Status:', appointment.status);
                console.log('   PN Current Status:', appointment.pn_status);
                console.log('   Course ID:', appointment.course_id);
                console.log('   Has PN Case:', !!appointment.pn_case_id);

                // Return course session if it was deducted (check course_usage_history)
                if (appointment.course_id) {
                    // Check if course session was deducted for this PN
                    const [usageHistory] = await db.execute(
                        `SELECT id FROM course_usage_history
                         WHERE course_id = ? AND pn_id = ? AND action_type = 'USE'
                         LIMIT 1`,
                        [appointment.course_id, appointment.pn_case_id]
                    );

                    if (usageHistory.length > 0) {
                        // Session was deducted - return it
                        console.log('✅ Returning course session (appointment cancelled)');
                        console.log('   Course ID:', appointment.course_id);

                        await db.execute(
                            `UPDATE courses
                             SET used_sessions = GREATEST(0, used_sessions - 1),
                                 remaining_sessions = remaining_sessions + 1,
                                 status = CASE
                                     WHEN status = 'COMPLETED' AND remaining_sessions + 1 > 0 THEN 'ACTIVE'
                                     ELSE status
                                 END,
                                 updated_at = NOW()
                             WHERE id = ?`,
                            [appointment.course_id]
                        );

                        // Log course return
                        await db.execute(
                            `INSERT INTO course_usage_history
                             (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                             VALUES (?, NULL, ?, 1, CURDATE(), 'RETURN', 'Appointment cancelled - session returned', ?)`,
                            [appointment.course_id, appointment.pn_case_id, req.user.id]
                        ).catch(err => console.warn('Failed to log course return:', err.message));

                        console.log('✅ Course session returned successfully');
                    } else {
                        console.log('ℹ️  No course session to return (session not deducted)');
                    }
                }

                // Sync PN case to CANCELLED
                await db.execute(
                    `UPDATE pn_cases
                     SET status = 'CANCELLED',
                         cancelled_at = NOW(),
                         updated_at = NOW()
                     WHERE id = ?`,
                    [appointment.pn_case_id]
                );

                // Log status change
                await db.execute(
                    `INSERT INTO pn_status_history (pn_id, old_status, new_status, changed_by, is_reversal)
                     VALUES (?, ?, 'CANCELLED', ?, FALSE)`,
                    [appointment.pn_case_id, appointment.pn_status, req.user.id]
                ).catch(err => console.warn('Failed to log status history:', err.message));

                console.log('✅ Synced: Appointment CANCELLED → PN case CANCELLED');
            }
        }

        res.json({
            message: 'Appointment updated successfully',
            pn_synced: !!appointment.pn_case_id
        });
    } catch (error) {
        console.error('Update appointment error:', error);
        res.status(500).json({ error: 'Failed to update appointment' });
    }
});

// SERVICES & BILLING API
const generateBillCode = () => {
    const timestamp = moment().format('YYYYMMDD');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `BILL-${timestamp}-${random}`;
};

// Get services (filtered by clinic if clinic_id provided)
app.get('/api/bills/services', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id } = req.query;

        let query;
        let params = [];

        if (clinic_id) {
            // Get services that are active globally AND enabled for the specific clinic
            query = `
                SELECT s.*,
                       COALESCE(csp.clinic_price, s.default_price) as price,
                       COALESCE(csp.is_enabled, 1) as is_enabled_for_clinic
                FROM services s
                LEFT JOIN clinic_service_pricing csp ON s.id = csp.service_id AND csp.clinic_id = ?
                WHERE s.active = 1
                  AND (csp.is_enabled IS NULL OR csp.is_enabled = 1)
                ORDER BY s.service_type, s.service_name
            `;
            params.push(clinic_id);
        } else {
            // Get all globally active services
            query = `
                SELECT s.*, s.default_price as price
                FROM services s
                WHERE s.active = 1
                ORDER BY s.service_type, s.service_name
            `;
        }

        const [services] = await db.execute(query, params);
        res.json(services);
    } catch (error) {
        console.error('Get services error:', error);
        res.status(500).json({ error: 'Failed to retrieve services' });
    }
});

// Create service (ADMIN only)
app.post('/api/bills/services', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { service_code, service_name, service_description, default_price, service_type } = req.body;

        const [result] = await db.execute(
            `INSERT INTO services (service_code, service_name, service_description, default_price, service_type, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [service_code, service_name, service_description, default_price, service_type || 'PHYSIOTHERAPY', req.user.id]
        );

        res.status(201).json({ message: 'Service created successfully', id: result.insertId });
    } catch (error) {
        console.error('Create service error:', error);
        res.status(500).json({ error: 'Failed to create service' });
    }
});

// Update service (ADMIN only)
app.put('/api/bills/services/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const serviceId = req.params.id;
        const { service_code, service_name, service_description, default_price, service_type, active } = req.body;

        // Build update query dynamically based on provided fields
        const updates = [];
        const params = [];

        if (service_code !== undefined) {
            updates.push('service_code = ?');
            params.push(service_code);
        }
        if (service_name !== undefined) {
            updates.push('service_name = ?');
            params.push(service_name);
        }
        if (service_description !== undefined) {
            updates.push('service_description = ?');
            params.push(service_description);
        }
        if (default_price !== undefined) {
            updates.push('default_price = ?');
            params.push(default_price);
        }
        if (service_type !== undefined) {
            updates.push('service_type = ?');
            params.push(service_type);
        }
        if (active !== undefined) {
            updates.push('active = ?');
            params.push(active);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(serviceId);

        await db.execute(
            `UPDATE services SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        res.json({ message: 'Service updated successfully' });
    } catch (error) {
        console.error('Update service error:', error);
        res.status(500).json({ error: 'Failed to update service' });
    }
});

// Get clinic-specific pricing (ADMIN only)
app.get('/api/bills/clinic-pricing', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, service_id } = req.query;

        let query = `SELECT csp.*, s.service_name, s.service_code, c.name as clinic_name
                     FROM clinic_service_pricing csp
                     JOIN services s ON csp.service_id = s.id
                     JOIN clinics c ON csp.clinic_id = c.id`;
        const params = [];
        const conditions = [];

        if (clinic_id) {
            conditions.push('csp.clinic_id = ?');
            params.push(clinic_id);
        }

        if (service_id) {
            conditions.push('csp.service_id = ?');
            params.push(service_id);
        }

        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }

        const [pricing] = await db.execute(query, params);
        res.json(pricing);
    } catch (error) {
        console.error('Get clinic pricing error:', error);
        res.status(500).json({ error: 'Failed to retrieve clinic pricing' });
    }
});

// Set clinic-specific pricing (ADMIN only)
app.post('/api/bills/clinic-pricing', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, service_id, clinic_price, is_enabled } = req.body;

        await db.execute(
            `INSERT INTO clinic_service_pricing (clinic_id, service_id, clinic_price, is_enabled, updated_by)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE clinic_price = VALUES(clinic_price), is_enabled = VALUES(is_enabled)`,
            [clinic_id, service_id, clinic_price, is_enabled !== false ? 1 : 0, req.user.id]
        );

        res.json({ message: 'Clinic pricing updated successfully' });
    } catch (error) {
        console.error('Set clinic pricing error:', error);
        res.status(500).json({ error: 'Failed to set clinic pricing' });
    }
});

// Get bills (All roles can view, but with different access levels)
app.get('/api/bills', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, patient_id, status, date_from, date_to } = req.query;

        let query = `SELECT b.*,
                     CONCAT(COALESCE(p.first_name, b.walk_in_name), ' ', COALESCE(p.last_name, '')) as patient_name,
                     c.name as clinic_name
                     FROM bills b
                     LEFT JOIN patients p ON b.patient_id = p.id
                     JOIN clinics c ON b.clinic_id = c.id
                     WHERE 1=1`;
        const params = [];

        if (clinic_id) {
            query += ` AND b.clinic_id = ?`;
            params.push(clinic_id);
        }
        if (patient_id) {
            query += ` AND b.patient_id = ?`;
            params.push(patient_id);
        }
        if (status) {
            query += ` AND b.payment_status = ?`;
            params.push(status);
        }
        if (date_from) {
            query += ` AND b.bill_date >= ?`;
            params.push(date_from);
        }
        if (date_to) {
            query += ` AND b.bill_date <= ?`;
            params.push(date_to);
        }

        query += ` ORDER BY b.bill_date DESC, b.created_at DESC`;

        const [bills] = await db.execute(query, params);
        res.json(bills);
    } catch (error) {
        console.error('Get bills error:', error);
        res.status(500).json({ error: 'Failed to retrieve bills' });
    }
});

// Create bill
app.post('/api/bills', authenticateToken, async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            patient_id, walk_in_name, walk_in_phone, clinic_id, bill_date,
            items, discount, tax, payment_method, payment_notes, bill_notes,
            appointment_id, course_id, is_course_cutting, pn_case_id
        } = req.body;

        // Role validation
        if (req.user.role === 'CLINIC' && clinic_id !== req.user.clinic_id) {
            throw new Error('CLINIC users can only create bills for their own clinic');
        }

        // Calculate totals
        let subtotal = 0;
        for (const item of items) {
            subtotal += item.quantity * item.unit_price - (item.discount || 0);
        }
        const total_amount = subtotal - (discount || 0) + (tax || 0);

        const bill_code = generateBillCode();

        // Insert bill - convert all undefined to null for SQL
        const [billResult] = await connection.execute(
            `INSERT INTO bills (
                bill_code, patient_id, walk_in_name, walk_in_phone, clinic_id, bill_date,
                subtotal, discount, tax, total_amount, payment_method, payment_notes,
                bill_notes, appointment_id, pn_case_id, course_id, is_course_cutting, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [bill_code, patient_id || null, walk_in_name || null, walk_in_phone || null, clinic_id, bill_date,
             subtotal, discount || 0, tax || 0, total_amount, payment_method || null, payment_notes || null,
             bill_notes || null, appointment_id || null, pn_case_id || null, course_id || null, is_course_cutting ? 1 : 0, req.user.id]
        );

        const bill_id = billResult.insertId;

        // Insert bill items - convert undefined to null
        for (const item of items) {
            await connection.execute(
                `INSERT INTO bill_items (bill_id, service_id, service_name, quantity, unit_price, discount, total_price, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [bill_id, item.service_id, item.service_name, item.quantity, item.unit_price,
                 item.discount || 0, item.quantity * item.unit_price - (item.discount || 0), item.notes || null]
            );
        }

        // If course cutting, update course sessions
        if (is_course_cutting && course_id) {
            const sessions = items.reduce((sum, item) => sum + item.quantity, 0);
            await connection.execute(
                `UPDATE courses SET used_sessions = used_sessions + ?, remaining_sessions = remaining_sessions - ?
                 WHERE id = ?`,
                [sessions, sessions, course_id]
            );

            // Log course usage - matches exact table structure
            await connection.execute(
                `INSERT INTO course_usage_history
                 (course_id, bill_id, pn_id, sessions_used, usage_date, action_type, notes, created_by)
                 VALUES (?, ?, NULL, ?, ?, 'USE', 'Bill created with course cutting', ?)`,
                [course_id, bill_id, sessions, bill_date, req.user.id]
            );
        }

        await connection.commit();

        // Send LINE notification for payment received (if payment method is provided)
        if (payment_method) {
            try {
                // Get bill details for notification
                const [billDetails] = await connection.execute(
                    `SELECT b.*,
                     CONCAT(COALESCE(p.first_name, b.walk_in_name), ' ', COALESCE(p.last_name, '')) as patient_name,
                     c.name as clinic_name
                     FROM bills b
                     LEFT JOIN patients p ON b.patient_id = p.id
                     JOIN clinics c ON b.clinic_id = c.id
                     WHERE b.id = ?`,
                    [bill_id]
                );

                if (billDetails.length > 0) {
                    const bill = billDetails[0];

                    const notificationMessage = `💰 Payment Received

🧾 Bill Code: ${bill_code}
👤 Patient: ${bill.patient_name || 'Walk-in'}
🏢 Clinic: ${bill.clinic_name}
📅 Date: ${moment(bill_date).format('DD/MM/YYYY')}
💵 Amount: ${total_amount.toLocaleString()} THB
💳 Payment Method: ${payment_method}
${payment_notes ? `💬 Notes: ${payment_notes}` : ''}
${is_course_cutting ? `📦 Course Cutting Applied` : ''}`;

                    await sendLINENotification(req.app.locals.db, 'paymentReceived', notificationMessage);
                }
            } catch (notifError) {
                console.error('Failed to send LINE notification:', notifError);
                // Don't fail the request if notification fails
            }
        }

        res.status(201).json({ message: 'Bill created successfully', bill_code, id: bill_id });
    } catch (error) {
        await connection.rollback();
        console.error('Create bill error:', error);
        res.status(500).json({ error: error.message || 'Failed to create bill' });
    } finally {
        connection.release();
    }
});

// Get bill details (All roles can view)
app.get('/api/bills/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [bills] = await db.execute(
            `SELECT b.*,
             CONCAT(COALESCE(p.first_name, b.walk_in_name), ' ', COALESCE(p.last_name, '')) as patient_name,
             c.name as clinic_name, c.address as clinic_address, c.phone as clinic_phone,
             pn.pn_code as pn_number, pn.purpose as pn_purpose, pn.status as pn_status
             FROM bills b
             LEFT JOIN patients p ON b.patient_id = p.id
             JOIN clinics c ON b.clinic_id = c.id
             LEFT JOIN pn_cases pn ON b.pn_case_id = pn.id
             WHERE b.id = ?`,
            [id]
        );

        if (bills.length === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        const [items] = await db.execute(
            `SELECT * FROM bill_items WHERE bill_id = ?`,
            [id]
        );

        res.json({ ...bills[0], items });
    } catch (error) {
        console.error('Get bill details error:', error);
        res.status(500).json({ error: 'Failed to retrieve bill details' });
    }
});

// Update bill payment status (ADMIN and PT can update payment status)
app.patch('/api/bills/:id/payment-status', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const { payment_status, payment_notes } = req.body;

        // Validate payment status
        const validStatuses = ['UNPAID', 'PAID', 'PARTIAL', 'CANCELLED'];
        if (!validStatuses.includes(payment_status)) {
            return res.status(400).json({ error: 'Invalid payment status' });
        }

        await db.execute(
            `UPDATE bills SET payment_status = ?, payment_notes = ?, updated_at = NOW() WHERE id = ?`,
            [payment_status, payment_notes || null, id]
        );

        // Send LINE notification when payment status is updated to PAID
        if (payment_status === 'PAID') {
            try {
                // Get bill details for notification
                const [billDetails] = await db.execute(
                    `SELECT b.*,
                     CONCAT(COALESCE(p.first_name, b.walk_in_name), ' ', COALESCE(p.last_name, '')) as patient_name,
                     c.name as clinic_name
                     FROM bills b
                     LEFT JOIN patients p ON b.patient_id = p.id
                     JOIN clinics c ON b.clinic_id = c.id
                     WHERE b.id = ?`,
                    [id]
                );

                if (billDetails.length > 0) {
                    const bill = billDetails[0];

                    const notificationMessage = `💰 Payment Received

🧾 Bill Code: ${bill.bill_code}
👤 Patient: ${bill.patient_name || 'Walk-in'}
🏢 Clinic: ${bill.clinic_name}
📅 Bill Date: ${moment(bill.bill_date).format('DD/MM/YYYY')}
💵 Amount: ${bill.total_amount.toLocaleString()} THB
💳 Payment Method: ${bill.payment_method || 'N/A'}
${payment_notes ? `💬 Notes: ${payment_notes}` : ''}
✅ Status: PAID`;

                    await sendLINENotification(db, 'paymentReceived', notificationMessage);
                }
            } catch (notifError) {
                console.error('Failed to send LINE notification:', notifError);
                // Don't fail the request if notification fails
            }
        }

        res.json({ message: 'Payment status updated successfully' });
    } catch (error) {
        console.error('Update payment status error:', error);
        res.status(500).json({ error: 'Failed to update payment status' });
    }
});

// Update bill (ADMIN only - full bill edit)
app.put('/api/bills/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const {
            patient_id, walk_in_name, walk_in_phone, clinic_id, bill_date,
            items, discount, tax, payment_method, payment_notes, bill_notes,
            payment_status
        } = req.body;

        // Check if bill exists
        const [existingBill] = await connection.execute(
            `SELECT id FROM bills WHERE id = ?`,
            [id]
        );

        if (existingBill.length === 0) {
            throw new Error('Bill not found');
        }

        // Calculate totals
        let subtotal = 0;
        for (const item of items) {
            subtotal += item.quantity * item.unit_price - (item.discount || 0);
        }
        const total_amount = subtotal - (discount || 0) + (tax || 0);

        // Update bill
        await connection.execute(
            `UPDATE bills SET
                patient_id = ?, walk_in_name = ?, walk_in_phone = ?, clinic_id = ?,
                bill_date = ?, subtotal = ?, discount = ?, tax = ?, total_amount = ?,
                payment_method = ?, payment_notes = ?, bill_notes = ?, payment_status = ?,
                updated_at = NOW()
             WHERE id = ?`,
            [patient_id || null, walk_in_name || null, walk_in_phone || null, clinic_id,
             bill_date, subtotal, discount || 0, tax || 0, total_amount,
             payment_method || null, payment_notes || null, bill_notes || null,
             payment_status || 'UNPAID', id]
        );

        // Delete existing bill items
        await connection.execute(`DELETE FROM bill_items WHERE bill_id = ?`, [id]);

        // Insert updated bill items
        for (const item of items) {
            await connection.execute(
                `INSERT INTO bill_items (bill_id, service_id, service_name, quantity, unit_price, discount, total_price, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, item.service_id, item.service_name, item.quantity, item.unit_price,
                 item.discount || 0, item.quantity * item.unit_price - (item.discount || 0), item.notes || null]
            );
        }

        await connection.commit();
        res.json({ message: 'Bill updated successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Update bill error:', error);
        res.status(500).json({ error: error.message || 'Failed to update bill' });
    } finally {
        connection.release();
    }
});

// Delete bill (ADMIN only)
app.delete('/api/bills/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;

        // Check if bill exists
        const [existingBill] = await connection.execute(
            `SELECT id FROM bills WHERE id = ?`,
            [id]
        );

        if (existingBill.length === 0) {
            throw new Error('Bill not found');
        }

        // Delete bill items first (foreign key constraint)
        await connection.execute(`DELETE FROM bill_items WHERE bill_id = ?`, [id]);

        // Delete bill
        await connection.execute(`DELETE FROM bills WHERE id = ?`, [id]);

        await connection.commit();
        res.json({ message: 'Bill deleted successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Delete bill error:', error);
        res.status(500).json({ error: error.message || 'Failed to delete bill' });
    } finally {
        connection.release();
    }
});

// Export bills CSV template (ADMIN only)
app.get('/api/bills/export/template', authenticateToken, authorize('ADMIN'), (req, res) => {
    try {
        const csvHeaders = [
            'bill_ref',
            'patient_hn',
            'walk_in_name',
            'walk_in_phone',
            'clinic_code',
            'bill_date',
            'payment_method',
            'payment_status',
            'service_code',
            'quantity',
            'unit_price',
            'discount',
            'payment_notes',
            'bill_notes'
        ];

        const sampleRow1 = [
            'BILL001',
            'P001',
            '',
            '',
            'CL001',
            '2025-11-08',
            'CASH',
            'PAID',
            'PT001',
            '1',
            '800',
            '0',
            '',
            'Example: Bill with 2 services'
        ];

        const sampleRow2 = [
            'BILL001',
            'P001',
            '',
            '',
            'CL001',
            '2025-11-08',
            'CASH',
            'PAID',
            'MT001',
            '1',
            '600',
            '0',
            '',
            '' // Same bill_ref = same bill, multiple services
        ];

        const sampleRow3 = [
            'BILL002',
            '',
            'Jane Doe',
            '0898765432',
            'CL001',
            '2025-11-08',
            'CASH',
            'UNPAID',
            'CONS001',
            '1',
            '500',
            '0',
            '',
            'Walk-in patient'
        ];

        const csvContent = [
            csvHeaders.join(','),
            sampleRow1.join(','),
            sampleRow2.join(','),
            sampleRow3.join(','),
            // Empty row for user to fill
            ',,,,,,,,,,,,,,'
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=bills_import_template.csv');
        res.send(csvContent);
    } catch (error) {
        console.error('Export template error:', error);
        res.status(500).json({ error: 'Failed to generate template' });
    }
});

// Import bills from CSV (ADMIN only)
app.post('/api/bills/import', authenticateToken, authorize('ADMIN'), async (req, res) => {
    const connection = await req.app.locals.db.getConnection();
    try {
        const { csvData } = req.body;

        if (!csvData || !Array.isArray(csvData) || csvData.length === 0) {
            return res.status(400).json({ error: 'No data provided' });
        }

        await connection.beginTransaction();

        const results = {
            success: 0,
            failed: 0,
            errors: []
        };

        // Group CSV rows by bill_ref (to support multiple services per bill)
        const billGroups = {};
        csvData.forEach((row, index) => {
            const billRef = row.bill_ref || `AUTO_${index}`;
            if (!billGroups[billRef]) {
                billGroups[billRef] = {
                    billData: row, // Use first row for bill-level data
                    items: []
                };
            }
            billGroups[billRef].items.push({ ...row, rowIndex: index });
        });

        console.log(`Grouped into ${Object.keys(billGroups).length} bills from ${csvData.length} rows`);

        // Process each bill group
        for (const [billRef, group] of Object.entries(billGroups)) {
            try {
                const billData = group.billData;

                // Validate bill-level required fields
                if (!billData.bill_date) {
                    throw new Error('Missing required field: bill_date');
                }

                // Get patient_id from HN if provided
                let patient_id = null;
                if (billData.patient_hn) {
                    const [patients] = await connection.execute(
                        'SELECT id FROM patients WHERE hn = ?',
                        [billData.patient_hn]
                    );
                    if (patients.length > 0) {
                        patient_id = patients[0].id;
                    }
                }

                // Get clinic_id from code if provided, otherwise use user's clinic
                let clinic_id = req.user.clinic_id || 1;
                if (billData.clinic_code) {
                    const [clinics] = await connection.execute(
                        'SELECT id FROM clinics WHERE code = ?',
                        [billData.clinic_code]
                    );
                    if (clinics.length > 0) {
                        clinic_id = clinics[0].id;
                    }
                }

                // Generate bill code
                const billDate = new Date(billData.bill_date);
                const dateStr = billDate.toISOString().split('T')[0].replace(/-/g, '');
                const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
                const bill_code = `BILL-${dateStr}-${randomNum}`;

                // Calculate totals from all items
                let subtotal = 0;
                const processedItems = [];

                for (const item of group.items) {
                    // Validate item required fields
                    if ((!item.service_code && !item.service_name) || !item.quantity || !item.unit_price) {
                        throw new Error(`Row ${item.rowIndex + 1}: Missing service_code/service_name, quantity, or unit_price`);
                    }

                    // Lookup service by code if provided
                    let service_id = null;
                    let service_name = item.service_name;

                    if (item.service_code) {
                        const [services] = await connection.execute(
                            'SELECT id, service_name FROM services WHERE service_code = ? AND active = 1',
                            [item.service_code]
                        );
                        if (services.length > 0) {
                            service_id = services[0].id;
                            service_name = services[0].service_name; // Use service name from database
                        } else {
                            throw new Error(`Row ${item.rowIndex + 1}: Service code '${item.service_code}' not found or inactive`);
                        }
                    }

                    const quantity = parseFloat(item.quantity) || 1;
                    const unit_price = parseFloat(item.unit_price) || 0;
                    const discount = parseFloat(item.discount) || 0;
                    const item_total = (quantity * unit_price) - discount;

                    subtotal += item_total;

                    processedItems.push({
                        service_id,
                        service_name,
                        quantity,
                        unit_price,
                        discount,
                        total_price: item_total
                    });
                }

                const tax = 0;
                const total_amount = subtotal + tax;

                // Insert bill
                const [billResult] = await connection.execute(
                    `INSERT INTO bills
                    (bill_code, patient_id, walk_in_name, walk_in_phone, clinic_id, bill_date,
                     subtotal, discount, tax, total_amount, payment_method, payment_status,
                     payment_notes, bill_notes, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        bill_code,
                        patient_id,
                        billData.walk_in_name || null,
                        billData.walk_in_phone || null,
                        clinic_id,
                        billData.bill_date,
                        subtotal,
                        0,
                        tax,
                        total_amount,
                        billData.payment_method || 'CASH',
                        billData.payment_status || 'UNPAID',
                        billData.payment_notes || null,
                        billData.bill_notes || null,
                        req.user.id
                    ]
                );

                const bill_id = billResult.insertId;

                // Insert all bill items
                for (const item of processedItems) {
                    await connection.execute(
                        `INSERT INTO bill_items
                        (bill_id, service_id, service_name, quantity, unit_price, discount, total_price)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            bill_id,
                            item.service_id,
                            item.service_name,
                            item.quantity,
                            item.unit_price,
                            item.discount,
                            item.total_price
                        ]
                    );
                }

                console.log(`✓ Bill ${bill_code} created with ${processedItems.length} items, total: ฿${total_amount}`);
                results.success++;

            } catch (error) {
                results.failed++;
                results.errors.push({
                    bill_ref: billRef,
                    error: error.message
                });
                console.error(`✗ Bill ${billRef} import error:`, error.message);
            }
        }

        await connection.commit();

        res.json({
            message: 'Import completed',
            ...results
        });
    } catch (error) {
        await connection.rollback();
        console.error('Import bills error:', error);
        res.status(500).json({ error: 'Failed to import bills', details: error.message });
    } finally {
        connection.release();
    }
});

// COURSES API
const generateCourseCode = () => {
    const timestamp = moment().format('YYYYMMDD');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `COURSE-${timestamp}-${random}`;
};

// === COURSE TEMPLATES API (Admin defines course packages) ===

// Get all course templates
app.get('/api/course-templates', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { active } = req.query;

        let query = `SELECT * FROM course_templates WHERE 1=1`;
        const params = [];

        if (active !== undefined) {
            query += ` AND active = ?`;
            params.push(active === 'true' || active === '1' ? 1 : 0);
        }

        query += ` ORDER BY created_at DESC`;

        const [templates] = await db.execute(query, params);
        res.json(templates);
    } catch (error) {
        console.error('Get course templates error:', error);
        res.status(500).json({ error: 'Failed to retrieve course templates' });
    }
});

// Create course template (ADMIN only)
app.post('/api/course-templates', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            template_name,
            description,
            total_sessions,
            default_price,
            validity_days,
            active
        } = req.body;

        if (!template_name || !total_sessions || !default_price) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const [result] = await db.execute(
            `INSERT INTO course_templates (
                template_name, description, total_sessions, default_price,
                validity_days, active, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                template_name,
                description || null,
                total_sessions,
                default_price,
                validity_days || null,
                active !== false ? 1 : 0,
                req.user.id
            ]
        );

        res.status(201).json({
            message: 'Course template created successfully',
            id: result.insertId
        });
    } catch (error) {
        console.error('Create course template error:', error);
        res.status(500).json({ error: 'Failed to create course template' });
    }
});

// Update course template (ADMIN only)
app.put('/api/course-templates/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            template_name,
            description,
            total_sessions,
            default_price,
            validity_days,
            active
        } = req.body;

        const updates = [];
        const params = [];

        if (template_name !== undefined) {
            updates.push('template_name = ?');
            params.push(template_name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (total_sessions !== undefined) {
            updates.push('total_sessions = ?');
            params.push(total_sessions);
        }
        if (default_price !== undefined) {
            updates.push('default_price = ?');
            params.push(default_price);
        }
        if (validity_days !== undefined) {
            updates.push('validity_days = ?');
            params.push(validity_days);
        }
        if (active !== undefined) {
            updates.push('active = ?');
            params.push(active ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(id);

        await db.execute(
            `UPDATE course_templates SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
            params
        );

        res.json({ message: 'Course template updated successfully' });
    } catch (error) {
        console.error('Update course template error:', error);
        res.status(500).json({ error: 'Failed to update course template' });
    }
});

// Delete course template (ADMIN only)
app.delete('/api/course-templates/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        await db.execute('DELETE FROM course_templates WHERE id = ?', [id]);

        res.json({ message: 'Course template deleted successfully' });
    } catch (error) {
        console.error('Delete course template error:', error);
        res.status(500).json({ error: 'Failed to delete course template' });
    }
});

// === PURCHASED COURSES API ===

// Get courses
app.get('/api/courses', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, patient_id, status } = req.query;

        let query = `SELECT c.*,
                     CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                     cl.name as clinic_name
                     FROM courses c
                     JOIN patients p ON c.patient_id = p.id
                     JOIN clinics cl ON c.clinic_id = cl.id
                     WHERE 1=1`;
        const params = [];

        if (clinic_id) {
            query += ` AND c.clinic_id = ?`;
            params.push(clinic_id);
        }
        if (patient_id) {
            query += ` AND c.patient_id = ?`;
            params.push(patient_id);
        }
        if (status) {
            query += ` AND c.status = ?`;
            params.push(status);
        }

        query += ` ORDER BY c.purchase_date DESC`;

        const [courses] = await db.execute(query, params);
        res.json(courses);
    } catch (error) {
        console.error('Get courses error:', error);
        res.status(500).json({ error: 'Failed to retrieve courses' });
    }
});

// Get patient active courses (for appointment booking)
app.get('/api/courses/patient/:patientId/active', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { patientId } = req.params;

        const [courses] = await db.execute(
            `SELECT c.*, cl.name as clinic_name
             FROM courses c
             JOIN clinics cl ON c.clinic_id = cl.id
             WHERE c.patient_id = ? AND c.status = 'ACTIVE'
               AND c.remaining_sessions > 0
               AND (c.expiry_date IS NULL OR c.expiry_date >= CURDATE())
             ORDER BY c.purchase_date DESC`,
            [patientId]
        );

        res.json({
            has_active_courses: courses.length > 0,
            courses
        });
    } catch (error) {
        console.error('Get patient active courses error:', error);
        res.status(500).json({ error: 'Failed to retrieve patient courses' });
    }
});

// Purchase/Create course for patient
app.post('/api/courses', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        console.log('=== Course Purchase Request ===');
        console.log('Body:', JSON.stringify(req.body, null, 2));
        console.log('User:', req.user.id, req.user.role);

        const {
            template_id,        // If using template
            patient_id,
            clinic_id,
            course_name,        // Required if not using template
            course_description,
            total_sessions,     // Required if not using template
            course_price,       // Required if not using template
            purchase_date,
            expiry_date,
            bill_id,
            notes
        } = req.body;

        // Validate required fields
        if (!patient_id || !clinic_id) {
            return res.status(400).json({ error: 'Patient ID and Clinic ID are required' });
        }

        let courseName, courseDescription, totalSessions, coursePrice, validityDays;

        // If using template, get template details
        if (template_id) {
            try {
                const [templates] = await db.execute(
                    'SELECT * FROM course_templates WHERE id = ? AND active = 1',
                    [template_id]
                );

                if (templates.length === 0) {
                    return res.status(404).json({ error: 'Course template not found or inactive' });
                }

                const template = templates[0];
                courseName = template.template_name;
                courseDescription = template.description;
                totalSessions = template.total_sessions;
                coursePrice = course_price || template.default_price; // Allow custom price
                validityDays = template.validity_days;
            } catch (templateError) {
                console.error('Template query error:', templateError);
                return res.status(500).json({
                    error: 'Database error when fetching template',
                    details: templateError.message,
                    hint: 'Make sure you have run the migration SQL file to create the course_templates table'
                });
            }
        } else {
            // Manual course creation (Admin only)
            if (req.user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only ADMIN can create custom courses' });
            }

            if (!course_name || !total_sessions || !course_price) {
                return res.status(400).json({
                    error: 'Course name, sessions, and price are required for custom courses'
                });
            }

            courseName = course_name;
            courseDescription = course_description;
            totalSessions = total_sessions;
            coursePrice = course_price;
        }

        const course_code = generateCourseCode();
        const price_per_session = coursePrice / totalSessions;
        const purchaseDate = purchase_date || moment().format('YYYY-MM-DD');

        // Calculate expiry date if validity_days is set
        let expiryDate = expiry_date;
        if (validityDays && !expiryDate) {
            expiryDate = moment(purchaseDate).add(validityDays, 'days').format('YYYY-MM-DD');
        }

        // Insert course - matches existing table structure (without template_id)
        console.log('=== Inserting Course ===');
        console.log('All values before INSERT:');
        console.log('1. course_code:', course_code);
        console.log('2. courseName:', courseName);
        console.log('3. courseDescription:', courseDescription);
        console.log('4. patient_id:', patient_id, 'type:', typeof patient_id);
        console.log('5. clinic_id:', clinic_id, 'type:', typeof clinic_id);
        console.log('6. totalSessions:', totalSessions, 'type:', typeof totalSessions);
        console.log('7. used_sessions: 0');
        console.log('8. remaining_sessions:', totalSessions);
        console.log('9. coursePrice:', coursePrice, 'type:', typeof coursePrice);
        console.log('10. price_per_session:', price_per_session, 'type:', typeof price_per_session);
        console.log('11. purchaseDate:', purchaseDate);
        console.log('12. expiryDate:', expiryDate);
        console.log('13. status: ACTIVE');
        console.log('14. bill_id:', bill_id);
        console.log('15. notes:', notes);
        console.log('16. created_by:', req.user.id);

        const [result] = await db.execute(
            `INSERT INTO courses (
                course_code, course_name, course_description, patient_id, clinic_id,
                total_sessions, used_sessions, remaining_sessions, course_price, price_per_session,
                purchase_date, expiry_date, status, bill_id, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                course_code,
                courseName,
                courseDescription || null,
                parseInt(patient_id),
                parseInt(clinic_id),
                parseInt(totalSessions),
                0,
                parseInt(totalSessions),
                parseFloat(coursePrice),
                parseFloat(price_per_session),
                purchaseDate,
                expiryDate || null,
                'ACTIVE',
                bill_id || null,
                notes || null,
                req.user.id
            ]
        );

        console.log('✅ Course inserted successfully! ID:', result.insertId);

        res.status(201).json({
            message: 'Course purchased successfully',
            id: result.insertId,
            course_code,
            total_sessions: totalSessions,
            remaining_sessions: totalSessions,
            expiry_date: expiryDate
        });
    } catch (error) {
        console.error('=== CREATE COURSE ERROR ===');
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('SQL Message:', error.sqlMessage);
        console.error('SQL State:', error.sqlState);
        console.error('SQL:', error.sql);
        console.error('Stack:', error.stack);

        res.status(500).json({
            error: 'Failed to create course',
            details: error.message,
            sqlMessage: error.sqlMessage,
            sqlState: error.sqlState,
            code: error.code,
            hint: 'Check server console for detailed error logs'
        });
    }
});

// Get single course with usage history
app.get('/api/courses/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Get course details
        const [courses] = await db.execute(
            `SELECT c.*,
                    CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                    p.hn as patient_hn,
                    cl.name as clinic_name,
                    CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM courses c
             JOIN patients p ON c.patient_id = p.id
             JOIN clinics cl ON c.clinic_id = cl.id
             LEFT JOIN users u ON c.created_by = u.id
             WHERE c.id = ?`,
            [id]
        );

        if (courses.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const course = courses[0];

        // Get usage history
        const [usageHistory] = await db.execute(
            `SELECT cuh.*,
                    CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
                    pn.pn_code
             FROM course_usage_history cuh
             LEFT JOIN users u ON cuh.created_by = u.id
             LEFT JOIN pn_cases pn ON cuh.pn_id = pn.id
             WHERE cuh.course_id = ?
             ORDER BY cuh.usage_date DESC, cuh.created_at DESC`,
            [id]
        ).catch(() => [[]]); // Return empty array if table doesn't exist

        course.usage_history = usageHistory;

        res.json(course);
    } catch (error) {
        console.error('Get course error:', error);
        res.status(500).json({ error: 'Failed to retrieve course' });
    }
});

// Update course
app.put('/api/courses/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;
        const {
            course_name,
            course_description,
            course_price,
            expiry_date,
            notes,
            status
        } = req.body;

        // Check if course exists
        const [courses] = await db.execute('SELECT * FROM courses WHERE id = ?', [id]);
        if (courses.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const oldCourse = courses[0];

        // Only ADMIN can change certain fields
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can update courses' });
        }

        // Build update query
        let updateFields = [];
        let updateParams = [];

        if (course_name !== undefined) {
            updateFields.push('course_name = ?');
            updateParams.push(course_name);
        }
        if (course_description !== undefined) {
            updateFields.push('course_description = ?');
            updateParams.push(course_description);
        }
        if (course_price !== undefined) {
            updateFields.push('course_price = ?');
            updateParams.push(parseFloat(course_price));
            // Recalculate price per session
            const pricePerSession = parseFloat(course_price) / oldCourse.total_sessions;
            updateFields.push('price_per_session = ?');
            updateParams.push(pricePerSession);
        }
        if (expiry_date !== undefined) {
            updateFields.push('expiry_date = ?');
            updateParams.push(expiry_date || null);
        }
        if (notes !== undefined) {
            updateFields.push('notes = ?');
            updateParams.push(notes);
        }
        if (status !== undefined) {
            updateFields.push('status = ?');
            updateParams.push(status);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.push('updated_at = NOW()');
        updateParams.push(id);

        await db.execute(
            `UPDATE courses SET ${updateFields.join(', ')} WHERE id = ?`,
            updateParams
        );

        console.log('✅ Course updated:', id);

        res.json({ message: 'Course updated successfully' });
    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({ error: 'Failed to update course' });
    }
});

// Delete course
app.delete('/api/courses/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        // Only ADMIN can delete courses
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can delete courses' });
        }

        // Check if course exists
        const [courses] = await db.execute('SELECT * FROM courses WHERE id = ?', [id]);
        if (courses.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const course = courses[0];

        // Safety check: Don't allow deletion if course has been used
        if (course.used_sessions > 0) {
            return res.status(400).json({
                error: 'Cannot delete course that has been used',
                details: `This course has ${course.used_sessions} sessions already used. You can only mark it as CANCELLED or EXPIRED.`
            });
        }

        // Check if course is linked to any PN cases
        const [pnCases] = await db.execute(
            'SELECT COUNT(*) as count FROM pn_cases WHERE course_id = ?',
            [id]
        );

        if (pnCases[0].count > 0) {
            return res.status(400).json({
                error: 'Cannot delete course linked to PN cases',
                details: `This course is linked to ${pnCases[0].count} PN case(s). Please unlink them first or mark the course as CANCELLED.`
            });
        }

        // Safe to delete
        await db.execute('DELETE FROM courses WHERE id = ?', [id]);

        console.log('✅ Course deleted:', id);

        res.json({ message: 'Course deleted successfully' });
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

// STATISTICS API
app.get('/api/statistics/bills/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { date_from, date_to } = req.query;

        let query = `SELECT
                     COUNT(*) as total_bills,
                     SUM(total_amount) as total_revenue,
                     SUM(CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END) as collected_revenue,
                     SUM(CASE WHEN payment_status = 'UNPAID' THEN total_amount ELSE 0 END) as outstanding_revenue
                     FROM bills WHERE 1=1`;
        const params = [];

        if (date_from) {
            query += ` AND bill_date >= ?`;
            params.push(date_from);
        }
        if (date_to) {
            query += ` AND bill_date <= ?`;
            params.push(date_to);
        }

        const [stats] = await db.execute(query, params);
        res.json(stats[0]);
    } catch (error) {
        console.error('Get bills summary error:', error);
        res.status(500).json({ error: 'Failed to retrieve bills summary' });
    }
});

app.get('/api/statistics/bills/by-clinic', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [stats] = await db.execute(`
            SELECT c.id, c.name as clinic_name,
                   COUNT(b.id) as total_bills,
                   SUM(b.total_amount) as total_revenue,
                   SUM(CASE WHEN b.payment_status = 'PAID' THEN b.total_amount ELSE 0 END) as collected_revenue
            FROM clinics c
            LEFT JOIN bills b ON c.id = b.clinic_id
            GROUP BY c.id, c.name
            ORDER BY total_revenue DESC
        `);
        res.json(stats);
    } catch (error) {
        console.error('Get bills by clinic error:', error);
        res.status(500).json({ error: 'Failed to retrieve bills by clinic' });
    }
});

// Database verification endpoint for debugging
app.get('/api/statistics/debug/data-check', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        console.log('Running data check...');

        // Count records in each table
        const [billsCount] = await db.execute('SELECT COUNT(*) as count FROM bills');
        const [billItemsCount] = await db.execute('SELECT COUNT(*) as count FROM bill_items');
        const [patientsCount] = await db.execute('SELECT COUNT(*) as count FROM patients');
        const [clinicsCount] = await db.execute('SELECT COUNT(*) as count FROM clinics');

        // Get sample bill
        const [sampleBills] = await db.execute('SELECT * FROM bills LIMIT 1');

        // Get sample bill item
        const [sampleBillItems] = await db.execute('SELECT * FROM bill_items LIMIT 1');

        const result = {
            counts: {
                bills: billsCount[0].count,
                bill_items: billItemsCount[0].count,
                patients: patientsCount[0].count,
                clinics: clinicsCount[0].count
            },
            samples: {
                bill: sampleBills[0] || null,
                bill_item: sampleBillItems[0] || null
            }
        };

        console.log('Data check result:', result);

        res.json(result);
    } catch (error) {
        console.error('Data check error:', error);
        res.status(500).json({ error: 'Failed to check data', details: error.message });
    }
});

// Simple test endpoint - just return raw bills without enrichment
app.get('/api/statistics/debug/raw-bills', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { limit = 10 } = req.query;

        console.log('Fetching raw bills...');
        const [bills] = await db.execute('SELECT * FROM bills ORDER BY bill_date DESC LIMIT ?', [parseInt(limit)]);
        console.log(`Found ${bills.length} raw bills`);

        res.json(bills);
    } catch (error) {
        console.error('Raw bills error:', error);
        res.status(500).json({ error: 'Failed to get raw bills', details: error.message });
    }
});

// Get detailed bills with services for statistics
app.get('/api/statistics/bills/detailed', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { date_from, date_to, limit = 50 } = req.query;

        console.log('Fetching detailed bills with params:', { date_from, date_to, limit });

        // Simplified query - just get bills first
        let query = `SELECT * FROM bills WHERE 1=1`;
        const params = [];

        if (date_from) {
            query += ` AND bill_date >= ?`;
            params.push(date_from);
        }
        if (date_to) {
            query += ` AND bill_date <= ?`;
            params.push(date_to);
        }

        query += ` ORDER BY total_amount DESC, bill_date DESC LIMIT ?`;
        params.push(parseInt(limit));

        console.log('Executing simple query with params:', params);
        const [billsRaw] = await db.execute(query, params);
        console.log(`Retrieved ${billsRaw.length} raw bills`);

        // Now enrich with patient/clinic/items data
        const bills = await Promise.all(billsRaw.map(async (bill) => {
            // Get patient name
            let patient_name = bill.walk_in_name || 'Unknown';
            let hn = 'Walk-in';
            if (bill.patient_id) {
                const [patients] = await db.execute('SELECT first_name, last_name, hn FROM patients WHERE id = ?', [bill.patient_id]);
                if (patients.length > 0) {
                    patient_name = `${patients[0].first_name || ''} ${patients[0].last_name || ''}`.trim();
                    hn = patients[0].hn || 'N/A';
                }
            }

            // Get clinic name
            let clinic_name = 'Unknown';
            const [clinics] = await db.execute('SELECT name FROM clinics WHERE id = ?', [bill.clinic_id]);
            if (clinics.length > 0) {
                clinic_name = clinics[0].name;
            }

            // Get services
            const [items] = await db.execute('SELECT service_name FROM bill_items WHERE bill_id = ?', [bill.id]);
            const services = items.map(i => i.service_name).join(', ') || 'N/A';

            return {
                bill_id: bill.id,
                bill_code: bill.bill_code,
                bill_date: bill.bill_date,
                total_amount: bill.total_amount,
                payment_status: bill.payment_status,
                patient_name,
                hn,
                clinic_name,
                services
            };
        }));

        console.log(`Enriched ${bills.length} bills with details`);

        res.json(bills);
    } catch (error) {
        console.error('Get detailed bills error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Failed to retrieve detailed bills', details: error.message });
    }
});

// Get top services ranking
app.get('/api/statistics/services/ranking', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { date_from, date_to, limit = 10 } = req.query;

        console.log('Fetching service ranking with params:', { date_from, date_to, limit });

        let query = `
            SELECT
                bi.service_name,
                COUNT(bi.id) as usage_count,
                SUM(bi.quantity) as total_quantity,
                SUM(bi.total_price) as total_revenue
            FROM bill_items bi
            JOIN bills b ON bi.bill_id = b.id
            WHERE 1=1
        `;
        const params = [];

        if (date_from) {
            query += ` AND b.bill_date >= ?`;
            params.push(date_from);
        }
        if (date_to) {
            query += ` AND b.bill_date <= ?`;
            params.push(date_to);
        }

        query += `
            GROUP BY bi.service_name
            ORDER BY total_revenue DESC, usage_count DESC
            LIMIT ?
        `;
        params.push(parseInt(limit));

        console.log('Executing service ranking query with params:', params);
        const [services] = await db.execute(query, params);
        console.log(`Retrieved ${services.length} services`);

        res.json(services);
    } catch (error) {
        console.error('Get service ranking error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Failed to retrieve service ranking', details: error.message });
    }
});

// ========================================
// LOYALTY/MEMBERSHIP SYSTEM API
// ========================================

// Get all loyalty members (Admin & PT)
app.get('/api/loyalty/members', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Check role - Admin and PT can view
        if (!['ADMIN', 'PT'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied. Only ADMIN and PT roles can view loyalty members.' });
        }

        const { tier, status, search } = req.query;

        let query = `
            SELECT
                lm.*,
                p.hn,
                p.first_name,
                p.last_name,
                p.phone,
                p.email,
                c.name as clinic_name,
                lt.discount_percentage,
                lt.points_per_100_baht
            FROM loyalty_members lm
            INNER JOIN patients p ON lm.patient_id = p.id
            LEFT JOIN clinics c ON p.clinic_id = c.id
            LEFT JOIN loyalty_tier_rules lt ON lm.membership_tier = lt.tier
            WHERE 1=1
        `;
        const params = [];

        if (tier) {
            query += ` AND lm.membership_tier = ?`;
            params.push(tier);
        }

        if (status) {
            query += ` AND lm.status = ?`;
            params.push(status);
        }

        if (search) {
            query += ` AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.hn LIKE ? OR p.phone LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        query += ` ORDER BY lm.lifetime_spending DESC, lm.member_since DESC`;

        const [members] = await db.execute(query, params);
        res.json(members);
    } catch (error) {
        console.error('Get loyalty members error:', error);
        res.status(500).json({ error: 'Failed to retrieve loyalty members', details: error.message });
    }
});

// Get single loyalty member details (Admin & PT)
app.get('/api/loyalty/members/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        if (!['ADMIN', 'PT'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        console.log(`[Member Details] Fetching member ID: ${req.params.id}`);

        const [members] = await db.execute(`
            SELECT
                lm.*,
                p.hn,
                p.first_name,
                p.last_name,
                p.phone,
                p.email,
                c.name as clinic_name,
                lt.discount_percentage,
                lt.points_per_100_baht,
                lt.description as tier_description
            FROM loyalty_members lm
            INNER JOIN patients p ON lm.patient_id = p.id
            LEFT JOIN clinics c ON p.clinic_id = c.id
            LEFT JOIN loyalty_tier_rules lt ON lm.membership_tier = lt.tier
            WHERE lm.id = ?
        `, [req.params.id]);

        console.log(`[Member Details] Found ${members.length} members`);

        if (members.length === 0) {
            return res.status(404).json({ error: 'Loyalty member not found' });
        }

        console.log(`[Member Details] Returning member: ${members[0].first_name} ${members[0].last_name}`);
        res.json(members[0]);
    } catch (error) {
        console.error('[Member Details] Error:', error.message);
        console.error('[Member Details] SQL Error Code:', error.code);
        console.error('[Member Details] SQL State:', error.sqlState);
        console.error('[Member Details] Full Error:', error);
        res.status(500).json({
            error: 'Failed to retrieve loyalty member',
            details: error.message,
            sqlError: error.sqlMessage
        });
    }
});

// Get loyalty transactions for a member (Admin & PT)
app.get('/api/loyalty/members/:id/transactions', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        if (!['ADMIN', 'PT'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        console.log(`[Member Transactions] Fetching for member ID: ${req.params.id}`);

        const { limit = 50 } = req.query;

        const [transactions] = await db.execute(`
            SELECT
                lt.*,
                u.email as performed_by_name,
                b.bill_code,
                gc.gift_card_code
            FROM loyalty_transactions lt
            LEFT JOIN users u ON lt.performed_by = u.id
            LEFT JOIN bills b ON lt.bill_id = b.id
            LEFT JOIN gift_cards gc ON lt.gift_card_id = gc.id
            WHERE lt.member_id = ?
            ORDER BY lt.transaction_date DESC
            LIMIT ?
        `, [req.params.id, parseInt(limit)]);

        console.log(`[Member Transactions] Found ${transactions.length} transactions`);
        res.json(transactions);
    } catch (error) {
        console.error('[Member Transactions] Error:', error.message);
        console.error('[Member Transactions] SQL Error:', error.sqlMessage);
        res.status(500).json({
            error: 'Failed to retrieve transactions',
            details: error.message,
            sqlError: error.sqlMessage
        });
    }
});

// Create loyalty member (Admin only)
app.post('/api/loyalty/members', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { patient_id, membership_tier = 'BRONZE', notes } = req.body;

        if (!patient_id) {
            return res.status(400).json({ error: 'patient_id is required' });
        }

        // Check if patient exists
        const [patients] = await db.execute('SELECT id FROM patients WHERE id = ?', [patient_id]);
        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        // Check if already a member
        const [existing] = await db.execute('SELECT id FROM loyalty_members WHERE patient_id = ?', [patient_id]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Patient is already a loyalty member' });
        }

        const [result] = await db.execute(`
            INSERT INTO loyalty_members (patient_id, membership_tier, member_since, notes)
            VALUES (?, ?, CURDATE(), ?)
        `, [patient_id, membership_tier, notes || null]);

        res.json({
            message: 'Loyalty member created successfully',
            id: result.insertId
        });
    } catch (error) {
        console.error('Create loyalty member error:', error);
        res.status(500).json({ error: 'Failed to create loyalty member', details: error.message });
    }
});

// Update loyalty member (Admin only)
app.put('/api/loyalty/members/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { membership_tier, status, notes } = req.body;

        const updates = [];
        const params = [];

        if (membership_tier) {
            updates.push('membership_tier = ?');
            params.push(membership_tier);
        }
        if (status) {
            updates.push('status = ?');
            params.push(status);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(req.params.id);

        await db.execute(`
            UPDATE loyalty_members
            SET ${updates.join(', ')}
            WHERE id = ?
        `, params);

        res.json({ message: 'Loyalty member updated successfully' });
    } catch (error) {
        console.error('Update loyalty member error:', error);
        res.status(500).json({ error: 'Failed to update loyalty member', details: error.message });
    }
});

// Manual points adjustment (Admin only)
app.post('/api/loyalty/members/:id/adjust-points', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { points, description } = req.body;

        if (!points || points === 0) {
            return res.status(400).json({ error: 'Points value is required and cannot be zero' });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Update member points
            const operation = points > 0 ? '+' : '-';
            await connection.execute(`
                UPDATE loyalty_members
                SET available_points = available_points ${operation} ?,
                    total_points = total_points ${operation} ?,
                    last_activity = NOW()
                WHERE id = ?
            `, [Math.abs(points), Math.abs(points), req.params.id]);

            // Record transaction
            await connection.execute(`
                INSERT INTO loyalty_transactions
                (member_id, transaction_type, points, description, performed_by, transaction_date)
                VALUES (?, 'ADJUST', ?, ?, ?, NOW())
            `, [req.params.id, points, description || 'Manual adjustment', req.user.id]);

            await connection.commit();
            res.json({ message: 'Points adjusted successfully' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Adjust points error:', error);
        res.status(500).json({ error: 'Failed to adjust points', details: error.message });
    }
});

// ========================================
// NOTIFICATION SETTINGS API ROUTES
// ========================================

// Get SMTP settings
app.get('/api/admin/notification/smtp', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'smtp' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'No SMTP settings found' });
        }

        // Parse JSON fields
        const smtpSettings = settings[0];
        if (smtpSettings.setting_value) {
            try {
                const parsed = JSON.parse(smtpSettings.setting_value);
                res.json(parsed);
            } catch (e) {
                res.json(smtpSettings);
            }
        } else {
            res.json(smtpSettings);
        }
    } catch (error) {
        console.error('Get SMTP settings error:', error);
        res.status(500).json({ error: 'Failed to load SMTP settings' });
    }
});

// Save SMTP settings
app.post('/api/admin/notification/smtp', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const settings = req.body;

        const settingValue = JSON.stringify(settings);

        await db.execute(`
            INSERT INTO notification_settings
            (setting_type, setting_value, updated_by, created_at, updated_at)
            VALUES ('smtp', ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
            setting_value = ?,
            updated_by = ?,
            updated_at = NOW()
        `, [settingValue, userId, settingValue, userId]);

        res.json({ success: true, message: 'SMTP settings saved successfully' });
    } catch (error) {
        console.error('Save SMTP settings error:', error);
        res.status(500).json({ error: 'Failed to save SMTP settings' });
    }
});

// Test SMTP configuration
app.post('/api/admin/notification/smtp/test', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email address is required' });
        }

        // Get SMTP settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'smtp' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'SMTP settings not configured' });
        }

        const smtpConfig = JSON.parse(settings[0].setting_value);

        if (!smtpConfig.enabled || smtpConfig.enabled === '0') {
            return res.status(400).json({ error: 'SMTP is not enabled' });
        }

        // Import nodemailer
        const nodemailer = require('nodemailer');

        // Create transporter
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: parseInt(smtpConfig.port),
            secure: smtpConfig.secure === 'ssl',
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.password
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        // Send test email
        const info = await transporter.sendMail({
            from: `"${smtpConfig.fromName || 'RehabPlus'}" <${smtpConfig.fromEmail}>`,
            to: email,
            subject: 'Test Email from RehabPlus',
            html: `
                <h2>Test Email</h2>
                <p>This is a test email from RehabPlus notification system.</p>
                <p>If you receive this email, your SMTP configuration is working correctly.</p>
                <hr>
                <p><small>Sent at: ${new Date().toLocaleString()}</small></p>
            `
        });

        res.json({ success: true, message: 'Test email sent successfully', messageId: info.messageId });
    } catch (error) {
        console.error('Test SMTP error:', error);
        res.status(500).json({ error: error.message || 'Failed to send test email' });
    }
});

// Get LINE settings
app.get('/api/admin/notification/line', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'line' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'No LINE settings found' });
        }

        // Parse JSON fields
        const lineSettings = settings[0];
        if (lineSettings.setting_value) {
            try {
                const parsed = JSON.parse(lineSettings.setting_value);
                res.json(parsed);
            } catch (e) {
                res.json(lineSettings);
            }
        } else {
            res.json(lineSettings);
        }
    } catch (error) {
        console.error('Get LINE settings error:', error);
        res.status(500).json({ error: 'Failed to load LINE settings' });
    }
});

// Save LINE settings
app.post('/api/admin/notification/line', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const settings = req.body;

        const settingValue = JSON.stringify(settings);

        await db.execute(`
            INSERT INTO notification_settings
            (setting_type, setting_value, updated_by, created_at, updated_at)
            VALUES ('line', ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
            setting_value = ?,
            updated_by = ?,
            updated_at = NOW()
        `, [settingValue, userId, settingValue, userId]);

        res.json({ success: true, message: 'LINE settings saved successfully' });
    } catch (error) {
        console.error('Save LINE settings error:', error);
        res.status(500).json({ error: 'Failed to save LINE settings' });
    }
});

// Test LINE notification
app.post('/api/admin/notification/line/test', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get LINE settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'line' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'LINE settings not configured' });
        }

        const lineConfig = JSON.parse(settings[0].setting_value);

        if (!lineConfig.enabled || lineConfig.enabled === '0') {
            return res.status(400).json({ error: 'LINE notification is not enabled' });
        }

        if (!lineConfig.accessToken) {
            return res.status(400).json({ error: 'Channel Access Token not configured' });
        }

        if (!lineConfig.targetId) {
            return res.status(400).json({ error: 'Target User ID or Group ID not configured' });
        }
        // Import axios for HTTP requests
          const axios = require('axios');

        // Send LINE Messaging API notification (Push Message)
        const response = await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
                to: lineConfig.targetId,
                messages: [
                    {
                        type: 'text',
                        text: message
                    }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${lineConfig.accessToken}`
                }
            }
        );

        if (response.status === 200) {
            res.json({ success: true, message: 'Test notification sent successfully' });
        } else {
            throw new Error('Failed to send LINE notification');
        }
    } catch (error) {
        console.error('Test LINE error:', error);
        if (error.response) {
            // Log the full LINE API error for debugging
            console.error('LINE API error details:', JSON.stringify(error.response.data, null, 2));

            const lineError = error.response.data;
            let errorMessage = 'Failed to send test notification';

            // Provide more detailed error messages based on LINE API response
            if (lineError.message) {
                errorMessage = lineError.message;

                // Add helpful hints for common errors
                if (lineError.message.includes('Invalid reply token')) {
                    errorMessage += '. Make sure you are using Push Message API, not Reply API.';
                } else if (lineError.message.includes('The request body has 1 error(s)')) {
                    errorMessage += '. Check your Channel Access Token and Target ID format.';
                } else if (lineError.message.includes('authentication')) {
                    errorMessage += '. Please verify your Channel Access Token is correct.';
                } else if (lineError.message.includes('not found')) {
                    errorMessage += '. The Target User ID or Group ID may be invalid.';
                }
            }

            // Include details if available
            if (lineError.details && lineError.details.length > 0) {
                errorMessage += ' Details: ' + lineError.details.map(d => d.message).join(', ');
            }

            res.status(error.response.status).json({ error: errorMessage });
        } else {
            res.status(500).json({ error: error.message || 'Failed to send test notification' });
        }
    }
});

// LINE Webhook endpoint to capture User/Group IDs
// This helps admins get their User ID or Group ID for notification settings

// Store recent webhook events in memory (last 10 events)
const recentLineEvents = [];

// GET endpoint for testing webhook availability
app.get('/webhook/line', (req, res) => {
    res.status(200).send('LINE Webhook endpoint is ready and active!');
});

app.post('/webhook/line', async (req, res) => {
    try {
        // Log the entire request body for debugging
        console.log('\n========================================');
        console.log('LINE WEBHOOK - Raw Payload Received');
        console.log('========================================');
        console.log('Full Body:', JSON.stringify(req.body, null, 2));
        console.log('========================================\n');

        const events = req.body.events;

        if (!events || events.length === 0) {
            console.log('No events in webhook payload');
            return res.status(200).send('OK');
        }

        // Log all incoming events with User/Group IDs
        console.log('\n========================================');
        console.log('LINE WEBHOOK - Parsed Event Data');
        console.log('========================================');

        events.forEach((event, index) => {
            console.log(`\n--- Event ${index + 1} ---`);
            console.log(`Event Type: ${event.type}`);
            console.log(`Source Type: ${event.source?.type}`);
            console.log(`Source Data:`, JSON.stringify(event.source, null, 2));

            // Store event data for web display
            const eventData = {
                timestamp: new Date().toISOString(),
                type: event.type,
                sourceType: event.source?.type,
                userId: event.source?.userId,
                groupId: event.source?.groupId,
                roomId: event.source?.roomId,
                message: event.message?.text || event.message?.type,
                rawSource: event.source // Store full source for debugging
            };

            // Add to recent events (keep only last 10)
            recentLineEvents.unshift(eventData);
            if (recentLineEvents.length > 10) {
                recentLineEvents.pop();
            }

            if (event.source) {
                console.log(`\n📱 SAVE THIS ID FOR NOTIFICATION SETTINGS:`);
                if (event.source.type === 'user') {
                    console.log(`   ✅ User ID: ${event.source.userId}`);
                    console.log(`   👆 Use this as "Target User ID" in notification settings`);
                } else if (event.source.type === 'group') {
                    console.log(`   ✅ Group ID: ${event.source.groupId}`);
                    console.log(`   👆 Use this as "Target Group ID" in notification settings`);
                    console.log(`   📝 User in Group: ${event.source.userId || 'N/A'}`);
                } else if (event.source.type === 'room') {
                    console.log(`   ✅ Room ID: ${event.source.roomId}`);
                    console.log(`   👆 Use this as "Target Room ID" in notification settings`);
                } else {
                    console.log(`   ⚠️ Unknown source type: ${event.source.type}`);
                }
            } else {
                console.log('   ⚠️ No source data in event');
            }

            if (event.message) {
                console.log(`\n💬 Message: ${event.message.text || event.message.type}`);
            }
        });

        console.log('\n========================================\n');

        // Respond to LINE server
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ LINE webhook error:', error);
        console.error('Error stack:', error.stack);
        res.status(200).send('OK'); // Still return 200 to LINE
    }
});

// Get recent LINE webhook events (for admin to see captured IDs)
app.get('/api/admin/notification/line/webhook-ids', authenticateToken, authorize('ADMIN'), async (req, res) => {
    res.json({
        events: recentLineEvents,
        count: recentLineEvents.length,
        instructions: [
            '1. Add your LINE bot as a friend (or add to group)',
            '2. Send any message to the bot',
            '3. Refresh this page to see the User/Group ID',
            '4. Copy the ID and paste it into notification settings'
        ]
    });
});

// ========================================
// GOOGLE CALENDAR API ROUTES
// ========================================

// Get Google Calendar settings
app.get('/api/admin/notification/google-calendar', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const [settings] = await db.execute(`
            SELECT * FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'No Google Calendar settings found' });
        }

        // Parse JSON fields
        const calendarSettings = settings[0];
        if (calendarSettings.setting_value) {
            try {
                const parsed = JSON.parse(calendarSettings.setting_value);
                res.json(parsed);
            } catch (e) {
                res.json(calendarSettings);
            }
        } else {
            res.json(calendarSettings);
        }
    } catch (error) {
        console.error('Get Google Calendar settings error:', error);
        res.status(500).json({ error: 'Failed to load Google Calendar settings' });
    }
});

// Save Google Calendar settings
app.post('/api/admin/notification/google-calendar', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.user.id;
        const settings = req.body;

        const settingValue = JSON.stringify(settings);

        await db.execute(`
            INSERT INTO notification_settings
            (setting_type, setting_value, updated_by, created_at, updated_at)
            VALUES ('google_calendar', ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
            setting_value = ?,
            updated_by = ?,
            updated_at = NOW()
        `, [settingValue, userId, settingValue, userId]);

        res.json({ success: true, message: 'Google Calendar settings saved successfully' });
    } catch (error) {
        console.error('Save Google Calendar settings error:', error);
        res.status(500).json({ error: 'Failed to save Google Calendar settings' });
    }
});

// Test Google Calendar configuration
app.post('/api/admin/notification/google-calendar/test', authenticateToken, authorize('ADMIN'), async (req, res) => {
    let debugInfo = { step: 'start' }; // Declare outside try block for catch block access

    try {
        const db = req.app.locals.db;

        // Get Google Calendar settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(404).json({ error: 'Google Calendar settings not configured' });
        }

        const calendarConfig = JSON.parse(settings[0].setting_value);

        if (!calendarConfig.enabled || calendarConfig.enabled === '0') {
            return res.status(400).json({ error: 'Google Calendar is not enabled' });
        }

        if (!calendarConfig.serviceAccountEmail) {
            return res.status(400).json({ error: 'Service Account Email not configured' });
        }

        if (!calendarConfig.privateKey) {
            return res.status(400).json({ error: 'Private Key not configured' });
        }

        if (!calendarConfig.calendarId) {
            return res.status(400).json({ error: 'Calendar ID not configured' });
        }

        // Validate private key format
        const privateKey = calendarConfig.privateKey ? calendarConfig.privateKey.trim() : '';

        // Collect debug info
        debugInfo = {
            step: 'initial',
            hasPrivateKey: !!calendarConfig.privateKey,
            privateKeyLength: privateKey.length,
            privateKeyType: typeof privateKey,
            hasBeginMarker: privateKey.includes('-----BEGIN PRIVATE KEY-----'),
            hasEndMarker: privateKey.includes('-----END PRIVATE KEY-----'),
            hasEscapedNewlines: privateKey.includes('\\n'),
            firstChars: privateKey.substring(0, 60),
            lastChars: privateKey.substring(privateKey.length - 60),
            serviceAccountEmail: calendarConfig.serviceAccountEmail,
            calendarId: calendarConfig.calendarId
        };

        // Debug logging
        console.log('🔍 Testing Google Calendar connection...');
        console.log('Debug Info:', JSON.stringify(debugInfo, null, 2));

        if (!privateKey || privateKey.length === 0) {
            return res.status(400).json({
                error: 'Private Key is empty',
                debug: debugInfo
            });
        }

        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
            return res.status(400).json({
                error: 'Invalid Private Key format. The key must include the "-----BEGIN PRIVATE KEY-----" and "-----END PRIVATE KEY-----" lines.',
                debug: debugInfo
            });
        }

        // Create a test event
        const { google } = require('googleapis');

        // Process the private key - replace literal \n with actual newlines
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
            console.log('✅ Converted escaped newlines to actual newlines');
        }

        // Trim the processed key to remove any leading/trailing whitespace or newlines
        processedKey = processedKey.trim();

        debugInfo.step = 'processed_key';
        debugInfo.processedKeyLength = processedKey.length;
        debugInfo.hasActualNewlines = processedKey.includes('\n');
        debugInfo.processedFirstChars = processedKey.substring(0, 60);
        debugInfo.processedLastChars = processedKey.substring(processedKey.length - 60);

        console.log('📋 Processed Key Details:', JSON.stringify({
            length: processedKey.length,
            hasActualNewlines: processedKey.includes('\n'),
            firstChars: processedKey.substring(0, 60),
            lastChars: processedKey.substring(processedKey.length - 60),
            startsWithBegin: processedKey.startsWith('-----BEGIN PRIVATE KEY-----'),
            endsWithEnd: processedKey.endsWith('-----END PRIVATE KEY-----')
        }, null, 2));

        debugInfo.step = 'creating_jwt_client';

        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar']
        );

        debugInfo.step = 'authorizing';
        console.log('🔐 Attempting to authorize with Google...');
        await jwtClient.authorize();
        console.log('✅ Authorization successful!');
        debugInfo.step = 'authorized';
        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        // Create test event 1 hour from now
        const testStart = new Date(Date.now() + 60 * 60 * 1000);
        const testEnd = new Date(Date.now() + 90 * 60 * 1000);

        const testEvent = {
            summary: 'Test Event from RehabPlus',
            description: 'This is a test event to verify Google Calendar integration is working correctly.',
            start: {
                dateTime: testStart.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            end: {
                dateTime: testEnd.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
        };

        const response = await calendar.events.insert({
            calendarId: calendarConfig.calendarId,
            resource: testEvent,
        });

        // Delete the test event immediately
        await calendar.events.delete({
            calendarId: calendarConfig.calendarId,
            eventId: response.data.id,
        });

        res.json({
            success: true,
            message: 'Google Calendar test successful! Connection verified.',
            testEventId: response.data.id
        });

    } catch (error) {
        console.error('❌ Test Google Calendar error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        if (error.response) {
            console.error('Error response:', error.response.data);
        }

        let errorMessage = 'Failed to connect to Google Calendar';

        if (error.code === 401 || error.code === 403) {
            errorMessage = 'Authentication failed. Please check your Service Account credentials.';
        } else if (error.message) {
            errorMessage = error.message;
        }

        // Include debug info in error response
        res.status(500).json({
            error: errorMessage,
            errorDetails: {
                name: error.name,
                message: error.message,
                code: error.code
            },
            debug: debugInfo
        });
    }
});

// Get gift card catalog (Admin & PT)
app.get('/api/loyalty/gift-cards/catalog', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        if (!['ADMIN', 'PT'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const [catalog] = await db.execute(`
            SELECT * FROM gift_card_catalog
            WHERE is_active = TRUE
            ORDER BY display_order ASC, points_required ASC
        `);

        res.json(catalog);
    } catch (error) {
        console.error('Get gift card catalog error:', error);
        res.status(500).json({ error: 'Failed to retrieve gift card catalog', details: error.message });
    }
});

// Redeem gift card (Admin only)
app.post('/api/loyalty/members/:id/redeem-gift-card', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { catalog_id, expiry_days = 365 } = req.body;

        if (!catalog_id) {
            return res.status(400).json({ error: 'catalog_id is required' });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Get catalog item
            const [catalog] = await connection.execute(
                'SELECT * FROM gift_card_catalog WHERE id = ? AND is_active = TRUE',
                [catalog_id]
            );

            if (catalog.length === 0) {
                throw new Error('Gift card not found or inactive');
            }

            const item = catalog[0];

            // Get member
            const [members] = await connection.execute(
                'SELECT * FROM loyalty_members WHERE id = ?',
                [req.params.id]
            );

            if (members.length === 0) {
                throw new Error('Member not found');
            }

            const member = members[0];

            // Check if member has enough points
            if (member.available_points < item.points_required) {
                throw new Error(`Insufficient points. Required: ${item.points_required}, Available: ${member.available_points}`);
            }

            // Check stock
            if (item.stock_quantity !== -1 && item.stock_quantity <= 0) {
                throw new Error('Gift card out of stock');
            }

            // Generate gift card code
            const giftCardCode = `GC-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + expiry_days);

            // Create gift card
            const [gcResult] = await connection.execute(`
                INSERT INTO gift_cards
                (gift_card_code, member_id, points_redeemed, gift_card_value, expiry_date, status)
                VALUES (?, ?, ?, ?, ?, 'ACTIVE')
            `, [giftCardCode, req.params.id, item.points_required, item.gift_card_value, expiryDate.toISOString().split('T')[0]]);

            const giftCardId = gcResult.insertId;

            // Deduct points from member
            await connection.execute(`
                UPDATE loyalty_members
                SET available_points = available_points - ?,
                    last_activity = NOW()
                WHERE id = ?
            `, [item.points_required, req.params.id]);

            // Record transaction
            await connection.execute(`
                INSERT INTO loyalty_transactions
                (member_id, transaction_type, points, gift_card_id, description, performed_by, transaction_date)
                VALUES (?, 'REDEEM', ?, ?, ?, ?, NOW())
            `, [req.params.id, -item.points_required, giftCardId, `Redeemed: ${item.name}`, req.user.id]);

            // Update stock if not unlimited
            if (item.stock_quantity !== -1) {
                await connection.execute(
                    'UPDATE gift_card_catalog SET stock_quantity = stock_quantity - 1 WHERE id = ?',
                    [catalog_id]
                );
            }

            await connection.commit();

            res.json({
                message: 'Gift card redeemed successfully',
                gift_card_code: giftCardCode,
                gift_card_value: item.gift_card_value,
                expiry_date: expiryDate.toISOString().split('T')[0]
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Redeem gift card error:', error);
        res.status(500).json({ error: error.message || 'Failed to redeem gift card' });
    }
});

// Get all gift cards (Admin only)
app.get('/api/loyalty/gift-cards', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { status, member_id } = req.query;

        let query = `
            SELECT
                gc.*,
                lm.patient_id,
                p.first_name,
                p.last_name,
                p.hn
            FROM gift_cards gc
            INNER JOIN loyalty_members lm ON gc.member_id = lm.id
            INNER JOIN patients p ON lm.patient_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ` AND gc.status = ?`;
            params.push(status);
        }

        if (member_id) {
            query += ` AND gc.member_id = ?`;
            params.push(member_id);
        }

        query += ` ORDER BY gc.issued_date DESC`;

        const [giftCards] = await db.execute(query, params);
        res.json(giftCards);
    } catch (error) {
        console.error('Get gift cards error:', error);
        res.status(500).json({ error: 'Failed to retrieve gift cards', details: error.message });
    }
});

// Get loyalty tier rules (Admin & PT)
app.get('/api/loyalty/tier-rules', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        if (!['ADMIN', 'PT'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const [rules] = await db.execute(`
            SELECT * FROM loyalty_tier_rules
            ORDER BY min_spending ASC
        `);

        res.json(rules);
    } catch (error) {
        console.error('Get tier rules error:', error);
        res.status(500).json({ error: 'Failed to retrieve tier rules', details: error.message });
    }
});

// Sync ALL patients with bills - Auto-create loyalty members (Admin only)
app.post('/api/loyalty/sync-all-patients', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // First, verify loyalty_tier_rules table has data
            const [tierCheck] = await connection.execute('SELECT COUNT(*) as count FROM loyalty_tier_rules');
            if (tierCheck[0].count === 0) {
                throw new Error('Loyalty tier rules not configured. Please run the database migration first.');
            }

            // Get all patients who have paid bills
            const [patientsWithBills] = await connection.execute(`
                SELECT DISTINCT p.id as patient_id, p.first_name, p.last_name, p.hn
                FROM patients p
                INNER JOIN bills b ON p.id = b.patient_id
                WHERE b.payment_status = 'PAID'
            `);

            console.log(`\n========== LOYALTY SYNC START ==========`);
            console.log(`Found ${patientsWithBills.length} patients with PAID bills`);

            if (patientsWithBills.length === 0) {
                await connection.commit();
                return res.json({
                    message: 'No patients with paid bills found',
                    patients_with_bills: 0,
                    members_created: 0,
                    members_updated: 0,
                    total_members: 0
                });
            }

            let created = 0;
            let updated = 0;
            let errors = [];

            for (const patient of patientsWithBills) {
                try {
                    console.log(`\nProcessing Patient ID ${patient.patient_id}: ${patient.hn} - ${patient.first_name} ${patient.last_name}`);

                    // Calculate total spending from bills
                    const [bills] = await connection.execute(`
                        SELECT
                            COALESCE(SUM(total_amount), 0) as lifetime_spending,
                            COALESCE(SUM(CASE WHEN YEAR(bill_date) = YEAR(CURDATE()) THEN total_amount ELSE 0 END), 0) as current_year_spending,
                            MIN(bill_date) as first_bill_date,
                            COUNT(*) as bill_count
                        FROM bills
                        WHERE patient_id = ? AND payment_status = 'PAID'
                    `, [patient.patient_id]);

                    const spending = bills[0];
                    console.log(`  Bills: ${spending.bill_count} paid | Lifetime: ฿${spending.lifetime_spending} | This Year: ฿${spending.current_year_spending}`);

                    if (!spending.lifetime_spending || spending.lifetime_spending <= 0) {
                        console.log(`  ⚠ Skipping: No spending found`);
                        continue;
                    }

                    // Determine tier based on spending
                    const [tierRules] = await connection.execute(`
                        SELECT tier, points_per_100_baht, min_spending FROM loyalty_tier_rules
                        WHERE min_spending <= ?
                        ORDER BY min_spending DESC
                        LIMIT 1
                    `, [spending.lifetime_spending]);

                    const newTier = tierRules.length > 0 ? tierRules[0].tier : 'BRONZE';
                    const pointsRate = tierRules.length > 0 ? tierRules[0].points_per_100_baht : 1;

                    console.log(`  Tier: ${newTier} (${pointsRate} points per ฿100)`);

                    // Calculate points earned
                    const earnedPoints = Math.floor(spending.lifetime_spending / 100) * pointsRate;
                    console.log(`  Points Earned: ${earnedPoints}`);

                    // Check if member already exists
                    const [existingMembers] = await connection.execute(
                        'SELECT id, total_points, available_points FROM loyalty_members WHERE patient_id = ?',
                        [patient.patient_id]
                    );

                    if (existingMembers.length > 0) {
                        // Update existing member
                        const member = existingMembers[0];
                        console.log(`  Existing Member ID: ${member.id}`);

                        // Calculate points that were redeemed (old total - old available)
                        const pointsRedeemed = (member.total_points || 0) - (member.available_points || 0);
                        console.log(`  Previous: ${member.total_points} total, ${member.available_points} available (${pointsRedeemed} redeemed)`);

                        // New available points = newly calculated total - what was already redeemed
                        const newAvailablePoints = Math.max(0, earnedPoints - pointsRedeemed);
                        console.log(`  New: ${earnedPoints} total, ${newAvailablePoints} available`);

                        await connection.execute(`
                            UPDATE loyalty_members
                            SET lifetime_spending = ?,
                                current_year_spending = ?,
                                membership_tier = ?,
                                total_points = ?,
                                available_points = ?,
                                last_activity = NOW()
                            WHERE id = ?
                        `, [
                            spending.lifetime_spending,
                            spending.current_year_spending,
                            newTier,
                            earnedPoints,
                            newAvailablePoints,
                            member.id
                        ]);
                        updated++;
                        console.log(`  ✓ Updated`);
                    } else {
                        // Create new member automatically
                        console.log(`  Creating new member...`);

                        const [result] = await connection.execute(`
                            INSERT INTO loyalty_members
                            (patient_id, membership_tier, total_points, available_points,
                             lifetime_spending, current_year_spending, member_since, status)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
                        `, [
                            patient.patient_id,
                            newTier,
                            earnedPoints,
                            earnedPoints,
                            spending.lifetime_spending,
                            spending.current_year_spending,
                            spending.first_bill_date
                        ]);
                        created++;
                        console.log(`  ✓ Created (ID: ${result.insertId})`);
                    }
                } catch (patientError) {
                    console.error(`  ✗ Error processing patient ${patient.patient_id}:`, patientError.message);
                    errors.push({
                        patient_id: patient.patient_id,
                        patient_hn: patient.hn,
                        error: patientError.message
                    });
                }
            }

            await connection.commit();

            console.log(`\n========== LOYALTY SYNC COMPLETE ==========`);
            console.log(`Created: ${created} | Updated: ${updated} | Errors: ${errors.length}`);
            console.log(`===========================================\n`);

            const response = {
                message: 'Sync completed',
                patients_with_bills: patientsWithBills.length,
                members_created: created,
                members_updated: updated,
                total_members: created + updated,
                errors: errors.length > 0 ? errors : undefined
            };

            res.json(response);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Sync all patients error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            error: 'Failed to sync patients',
            details: error.message,
            hint: 'Check if database migration was run: migrations/create_loyalty_system.sql'
        });
    }
});

// ========================================
// PUBLIC BOOKING API (No Authentication Required)
// ========================================

// Helper function to get client IP
const getClientIP = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.ip;
};

// Public: Get list of clinics
app.get('/api/public/clinics', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [clinics] = await db.execute(`
            SELECT id, code, name, address, phone, email
            FROM clinics
            WHERE active = 1
            ORDER BY name
        `);
        res.json(clinics);
    } catch (error) {
        console.error('Get public clinics error:', error);
        res.status(500).json({ error: 'Failed to load clinics' });
    }
});

// DEBUG: Get all appointments for testing
app.get('/api/public/debug-appointments', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id } = req.query;
        const clinicIdToUse = clinic_id || 1;

        console.log('DEBUG: Querying appointments for clinic_id:', clinicIdToUse);

        // Get appointments
        const [appointments] = await db.execute(`
            SELECT
                a.id,
                a.appointment_date,
                a.start_time,
                a.end_time,
                a.booking_type,
                a.status,
                a.walk_in_name,
                CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                a.clinic_id,
                a.created_at
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            WHERE a.clinic_id = ?
            AND a.appointment_date >= CURDATE()
            ORDER BY a.appointment_date, a.start_time
            LIMIT 50
        `, [clinicIdToUse]);

        // Get summary stats
        const [stats] = await db.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS') THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN booking_type = 'WALK_IN' THEN 1 ELSE 0 END) as walk_in,
                SUM(CASE WHEN booking_type = 'OLD_PATIENT' THEN 1 ELSE 0 END) as old_patient
            FROM appointments
            WHERE clinic_id = ?
            AND appointment_date >= CURDATE()
        `, [clinicIdToUse]);

        console.log('DEBUG: Found appointments:', appointments.length);

        res.json({
            clinic_id: clinicIdToUse,
            count: appointments.length,
            stats: stats[0],
            appointments: appointments,
            sample_date_formats: appointments.slice(0, 3).map(a => ({
                date: a.appointment_date,
                date_type: typeof a.appointment_date,
                date_instanceof: a.appointment_date instanceof Date,
                start_time: a.start_time,
                time_type: typeof a.start_time
            }))
        });
    } catch (error) {
        console.error('Debug appointments error:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// Public: Get booking counts per date for calendar
app.get('/api/public/booking-calendar', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, start_date, end_date } = req.query;

        if (!clinic_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'clinic_id, start_date, and end_date are required' });
        }

        console.log('Querying booking calendar:', { clinic_id, start_date, end_date });

        // Get booking counts per date
        const [bookingCounts] = await db.execute(`
            SELECT
                appointment_date,
                COUNT(*) as total_bookings,
                SUM(CASE WHEN booking_type = 'WALK_IN' THEN 1 ELSE 0 END) as walk_in_count,
                SUM(CASE WHEN booking_type = 'OLD_PATIENT' THEN 1 ELSE 0 END) as patient_count
            FROM appointments
            WHERE clinic_id = ?
            AND appointment_date BETWEEN ? AND ?
            AND status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            GROUP BY appointment_date
            ORDER BY appointment_date
        `, [clinic_id, start_date, end_date]);

        console.log('Raw booking counts from DB:', bookingCounts.length, 'dates');

        // Convert to object for easier lookup
        const bookingsByDate = {};
        bookingCounts.forEach(row => {
            // Format date as YYYY-MM-DD string consistently
            let dateStr;
            if (row.appointment_date instanceof Date) {
                // MySQL returns Date object - format to YYYY-MM-DD
                const year = row.appointment_date.getFullYear();
                const month = String(row.appointment_date.getMonth() + 1).padStart(2, '0');
                const day = String(row.appointment_date.getDate()).padStart(2, '0');
                dateStr = `${year}-${month}-${day}`;
            } else {
                // If string, ensure it's YYYY-MM-DD format (remove time if present)
                dateStr = String(row.appointment_date).split('T')[0].split(' ')[0].trim();
            }

            bookingsByDate[dateStr] = {
                total: parseInt(row.total_bookings),
                walkIn: parseInt(row.walk_in_count),
                patient: parseInt(row.patient_count)
            };

            console.log(`Added booking for ${dateStr}:`, bookingsByDate[dateStr]);
        });

        console.log('Booking calendar date keys:', Object.keys(bookingsByDate)); // Debug log
        res.json(bookingsByDate);
    } catch (error) {
        console.error('Get booking calendar error:', error);
        res.status(500).json({ error: 'Failed to load booking calendar' });
    }
});

// Public: Get available time slots
app.get('/api/public/time-slots', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, date } = req.query;

        if (!clinic_id || !date) {
            return res.status(400).json({ error: 'clinic_id and date are required' });
        }

        // Generate time slots (8:00 AM to 8:00 PM, 30-minute intervals) - synced with appointments calendar
        const slots = [];
        const now = new Date();
        const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD format
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const isToday = date === todayDate;

        // Start at 8:00 AM (08:00), end at 8:00 PM (20:00), 30-minute intervals
        for (let hour = 8; hour < 20; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const startHour = hour;
                const startMinute = minute;
                const endMinute = minute + 30;
                const endHour = endMinute >= 60 ? hour + 1 : hour;
                const finalEndMinute = endMinute >= 60 ? 0 : endMinute;

                // Don't create slot that goes past 20:00
                if (endHour > 20 || (endHour === 20 && finalEndMinute > 0)) {
                    break;
                }

                const startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}:00`;
                const endTime = `${endHour.toString().padStart(2, '0')}:${finalEndMinute.toString().padStart(2, '0')}:00`;

                // Skip past time slots if booking for today
                if (isToday) {
                    // Skip if the slot has already passed
                    if (startHour < currentHour || (startHour === currentHour && startMinute <= currentMinute)) {
                        console.log(`Skipping past slot: ${startTime} - ${endTime} (current time: ${currentHour}:${currentMinute})`);
                        continue;
                    }
                }

                slots.push({ start_time: startTime, end_time: endTime });
            }
        }

        // Check which slots are already booked
        const [bookedSlots] = await db.execute(`
            SELECT a.start_time, a.end_time, a.id, a.walk_in_name,
                   CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            WHERE a.clinic_id = ?
            AND a.appointment_date = ?
            AND a.status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
        `, [clinic_id, date]);

        console.log(`\n========== TIME SLOTS DEBUG for ${date} ==========`);
        console.log('Clinic ID:', clinic_id);
        console.log('Total booked appointments:', bookedSlots.length);

        if (bookedSlots.length > 0) {
            console.log('\nBooked appointments from DB:');
            bookedSlots.forEach((booking, idx) => {
                console.log(`  ${idx + 1}. ID:${booking.id} | ${booking.walk_in_name || booking.patient_name}`);
                console.log(`     Start: "${booking.start_time}" (type: ${typeof booking.start_time})`);
                console.log(`     End: "${booking.end_time}" (type: ${typeof booking.end_time})`);
            });
        }

        console.log('\nGenerated time slots:');
        slots.forEach((slot, idx) => {
            console.log(`  ${idx + 1}. "${slot.start_time}" - "${slot.end_time}"`);
        });

        // Mark slots as available or not
        const availableSlots = slots.map((slot, slotIdx) => {
            console.log(`\nChecking slot ${slotIdx + 1}: ${slot.start_time} - ${slot.end_time}`);

            const isBooked = bookedSlots.some((booked, bookIdx) => {
                // Normalize time strings (MySQL might return Buffer or different format)
                const bookedStart = String(booked.start_time).trim();
                const bookedEnd = String(booked.end_time).trim();
                const slotStart = slot.start_time;
                const slotEnd = slot.end_time;

                const bookingName = booked.walk_in_name || booked.patient_name || 'Unknown';
                console.log(`  vs booking ${bookIdx + 1}: "${bookedStart}" - "${bookedEnd}" (${bookingName})`);

                // Check for TIME OVERLAP instead of exact match
                // A slot overlaps with a booking if:
                // - Slot starts before booking ends AND
                // - Slot ends after booking starts
                // Example: Appointment 13:00-15:00 overlaps with:
                //   - Slot 13:00-14:00 (13:00 < 15:00 AND 14:00 > 13:00) ✓
                //   - Slot 14:00-15:00 (14:00 < 15:00 AND 15:00 > 13:00) ✓
                //   - Slot 15:00-16:00 (15:00 < 15:00) ✗ No overlap
                const overlap = slotStart < bookedEnd && slotEnd > bookedStart;

                console.log(`    Overlap? "${slotStart}" < "${bookedEnd}" = ${slotStart < bookedEnd}`);
                console.log(`             "${slotEnd}" > "${bookedStart}" = ${slotEnd > bookedStart}`);
                console.log(`    → ${overlap ? 'YES - BOOKED!' : 'NO - Available'}`);

                return overlap;
            });

            console.log(`  Final: ${isBooked ? '✗ BOOKED' : '✓ AVAILABLE'}`);

            return {
                ...slot,
                available: !isBooked
            };
        });

        console.log('\n========== SUMMARY ==========');
        availableSlots.forEach((slot, idx) => {
            console.log(`${idx + 1}. ${slot.start_time}-${slot.end_time}: ${slot.available ? '✓ AVAILABLE' : '✗ BOOKED'}`);
        });
        console.log('============================\n');

        res.json(availableSlots);
    } catch (error) {
        console.error('Get time slots error:', error);
        console.error('Error message:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({
            error: 'Failed to load time slots',
            message: error.message,
            details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        });
    }
});

// Public: Get user's bookings by IP
app.get('/api/public/my-bookings', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clientIP = getClientIP(req);

        const [bookings] = await db.execute(`
            SELECT
                a.*,
                c.name as clinic_name,
                c.code as clinic_code
            FROM appointments a
            LEFT JOIN clinics c ON a.clinic_id = c.id
            WHERE a.client_ip_address = ?
            AND a.booking_type = 'WALK_IN'
            AND a.status NOT IN ('COMPLETED', 'NO_SHOW')
            ORDER BY a.appointment_date DESC, a.start_time DESC
            LIMIT 10
        `, [clientIP]);

        res.json(bookings);
    } catch (error) {
        console.error('Get my bookings error:', error);
        res.status(500).json({ error: 'Failed to load bookings' });
    }
});

// Public: Book appointment
app.post('/api/public/book-appointment', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clientIP = getClientIP(req);
        const {
            walk_in_name,
            walk_in_phone,
            clinic_id,
            appointment_date,
            start_time,
            end_time,
            reason
        } = req.body;

        console.log('Booking request:', { walk_in_name, walk_in_phone, clinic_id, appointment_date, start_time, end_time, reason });
        console.log('Client IP:', clientIP);

        // Validation
        if (!walk_in_name || !walk_in_phone || !clinic_id || !appointment_date || !start_time || !end_time) {
            console.log('Validation failed - missing fields');
            return res.status(400).json({ error: 'All fields are required' });
        }

        console.log('Validation passed, checking for overlaps...');

        // Check if slot overlaps with existing appointments (not just exact match)
        // Overlap formula: existing.start_time < new.end_time AND existing.end_time > new.start_time
        const [existing] = await db.execute(`
            SELECT id, start_time, end_time FROM appointments
            WHERE clinic_id = ?
            AND appointment_date = ?
            AND status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            AND start_time < ?
            AND end_time > ?
        `, [clinic_id, appointment_date, end_time, start_time]);

        if (existing.length > 0) {
            console.log('Slot overlap detected:', existing);
            return res.status(400).json({ error: 'This time slot overlaps with an existing appointment' });
        }

        console.log('No overlaps found. Creating appointment...');
        console.log('INSERT values:', [walk_in_name, walk_in_phone, clinic_id, appointment_date, start_time, end_time, reason, clientIP]);

        // Create walk-in appointment (created_by = 1 for public bookings - admin user)
        // NOTE: Walk-in bookings don't have patient records, so no email for calendar invites
        const [result] = await db.execute(`
            INSERT INTO appointments (
                walk_in_name, walk_in_phone, booking_type, clinic_id,
                appointment_date, start_time, end_time, status,
                reason, client_ip_address, created_by
            ) VALUES (?, ?, 'WALK_IN', ?, ?, ?, ?, 'SCHEDULED', ?, ?, 1)
        `, [walk_in_name, walk_in_phone, clinic_id, appointment_date, start_time, end_time, reason, clientIP]);

        console.log('Appointment created successfully:', result.insertId);

        // Initialize response data
        let calendarEventId = null;
        let emailSent = false;

        // Create Google Calendar Event
        // Note: Walk-in bookings don't have patient records, so no email for calendar invites
        try {
            // Fetch appointment details with PT and clinic info for calendar event
            const [appointmentDetails] = await db.execute(`
                SELECT a.*,
                       u.first_name as pt_first_name, u.last_name as pt_last_name,
                       c.name as clinic_name
                FROM appointments a
                LEFT JOIN users u ON a.pt_id = u.id
                LEFT JOIN clinics c ON a.clinic_id = c.id
                WHERE a.id = ?
            `, [result.insertId]);

            if (appointmentDetails.length > 0) {
                const apt = appointmentDetails[0];

                // Prepare calendar data (no patient_email for walk-ins)
                const calendarData = {
                    appointment_id: result.insertId,
                    appointment_date: appointment_date,
                    start_time: start_time,
                    end_time: end_time,
                    patient_name: walk_in_name,
                    walk_in_name: walk_in_name,
                    patient_email: null, // Walk-ins don't have email - no calendar invite
                    pt_name: apt.pt_id ? `${apt.pt_first_name} ${apt.pt_last_name}` : 'Unassigned PT',
                    clinic_name: apt.clinic_name || 'Unknown Clinic',
                    reason: reason || 'Walk-in appointment'
                };

                console.log('Creating Google Calendar event for walk-in (no email invite)...');
                calendarEventId = await createGoogleCalendarEvent(db, calendarData);

                if (calendarEventId) {
                    // Store calendar event ID in database
                    await db.execute(
                        'UPDATE appointments SET calendar_event_id = ? WHERE id = ?',
                        [calendarEventId, result.insertId]
                    );
                    console.log('✅ Google Calendar event created:', calendarEventId);
                } else {
                    console.log('⚠️ Google Calendar event not created (disabled or error)');
                }
            }
        } catch (calendarError) {
            console.error('❌ Failed to create Google Calendar event:', calendarError);
            // Don't fail the request - appointment is already created
        }

        // Note: Walk-ins don't receive confirmation emails
        // Only OLD_PATIENT appointments (created by staff) will get emails from patients table

        res.json({
            success: true,
            appointment_id: result.insertId,
            message: 'Appointment booked successfully',
            calendar_event_id: calendarEventId,
            email_sent: emailSent
        });
    } catch (error) {
        console.error('Book appointment error:', error);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('SQL State:', error.sqlState);
        console.error('SQL Message:', error.sqlMessage);
        console.error('Full error:', JSON.stringify(error, null, 2));
        res.status(500).json({
            error: 'Failed to book appointment',
            message: error.message,
            sqlMessage: error.sqlMessage,
            code: error.code,
            sqlState: error.sqlState
        });
    }
});

// Public: Cancel appointment
app.post('/api/public/cancel-appointment/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clientIP = getClientIP(req);
        const appointmentId = req.params.id;

        // Verify this appointment belongs to this IP
        const [appointment] = await db.execute(`
            SELECT * FROM appointments
            WHERE id = ?
            AND client_ip_address = ?
            AND booking_type = 'WALK_IN'
        `, [appointmentId, clientIP]);

        if (appointment.length === 0) {
            return res.status(404).json({ error: 'Appointment not found or does not belong to you' });
        }

        if (!['SCHEDULED', 'CONFIRMED'].includes(appointment[0].status)) {
            return res.status(400).json({ error: 'Cannot cancel this appointment' });
        }

        // Cancel appointment
        await db.execute(`
            UPDATE appointments
            SET status = 'CANCELLED',
                cancellation_reason = 'Cancelled by walk-in user',
                cancelled_at = NOW()
            WHERE id = ?
        `, [appointmentId]);

        res.json({ success: true, message: 'Appointment cancelled successfully' });
    } catch (error) {
        console.error('Cancel appointment error:', error);
        res.status(500).json({ error: 'Failed to cancel appointment' });
    }
});

// ========================================
// ADMIN BOOKING SETTINGS API
// ========================================

// Get all service packages
app.get('/api/admin/booking/packages', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [packages] = await db.execute(`
            SELECT * FROM public_service_packages
            ORDER BY display_order ASC, id DESC
        `);
        res.json(packages);
    } catch (error) {
        console.error('Get packages error:', error);
        res.status(500).json({ error: 'Failed to load packages' });
    }
});

// Get single package
app.get('/api/admin/booking/packages/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [packages] = await db.execute(`
            SELECT * FROM public_service_packages WHERE id = ?
        `, [req.params.id]);

        if (packages.length === 0) {
            return res.status(404).json({ error: 'Package not found' });
        }

        res.json(packages[0]);
    } catch (error) {
        console.error('Get package error:', error);
        res.status(500).json({ error: 'Failed to load package' });
    }
});

// Create package
app.post('/api/admin/booking/packages', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.userId;
        const {
            package_name, package_code, price, duration_minutes,
            description, benefits, pain_zones, display_order,
            active, is_featured, is_best_value
        } = req.body;

        const [result] = await db.execute(`
            INSERT INTO public_service_packages (
                package_name, package_code, price, duration_minutes,
                description, benefits, pain_zones, display_order,
                active, is_featured, is_best_value, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            package_name, package_code, price, duration_minutes,
            description, benefits, pain_zones, display_order,
            active, is_featured, is_best_value, userId
        ]);

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Create package error:', error);
        res.status(500).json({ error: 'Failed to create package', message: error.message });
    }
});

// Update package
app.put('/api/admin/booking/packages/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            package_name, package_code, price, duration_minutes,
            description, benefits, pain_zones, display_order,
            active, is_featured, is_best_value
        } = req.body;

        await db.execute(`
            UPDATE public_service_packages SET
                package_name = ?, package_code = ?, price = ?, duration_minutes = ?,
                description = ?, benefits = ?, pain_zones = ?, display_order = ?,
                active = ?, is_featured = ?, is_best_value = ?
            WHERE id = ?
        `, [
            package_name, package_code, price, duration_minutes,
            description, benefits, pain_zones, display_order,
            active, is_featured, is_best_value, req.params.id
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Update package error:', error);
        res.status(500).json({ error: 'Failed to update package' });
    }
});

// Delete package
app.delete('/api/admin/booking/packages/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        await db.execute('DELETE FROM public_service_packages WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete package error:', error);
        res.status(500).json({ error: 'Failed to delete package' });
    }
});

// Get all promotions
app.get('/api/admin/booking/promotions', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [promos] = await db.execute(`
            SELECT * FROM public_promotions ORDER BY created_at DESC
        `);
        res.json(promos);
    } catch (error) {
        console.error('Get promotions error:', error);
        res.status(500).json({ error: 'Failed to load promotions' });
    }
});

// Get single promotion
app.get('/api/admin/booking/promotions/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [promos] = await db.execute(`
            SELECT * FROM public_promotions WHERE id = ?
        `, [req.params.id]);

        if (promos.length === 0) {
            return res.status(404).json({ error: 'Promotion not found' });
        }

        res.json(promos[0]);
    } catch (error) {
        console.error('Get promotion error:', error);
        res.status(500).json({ error: 'Failed to load promotion' });
    }
});

// Create promotion
app.post('/api/admin/booking/promotions', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.userId;
        const {
            promo_code, description, discount_type, discount_value,
            valid_from, valid_until, usage_limit, active
        } = req.body;

        const [result] = await db.execute(`
            INSERT INTO public_promotions (
                promo_code, description, discount_type, discount_value,
                valid_from, valid_until, usage_limit, active, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            promo_code, description, discount_type, discount_value,
            valid_from, valid_until, usage_limit, active, userId
        ]);

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Create promotion error:', error);
        res.status(500).json({ error: 'Failed to create promotion', message: error.message });
    }
});

// Update promotion
app.put('/api/admin/booking/promotions/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            promo_code, description, discount_type, discount_value,
            valid_from, valid_until, usage_limit, active
        } = req.body;

        await db.execute(`
            UPDATE public_promotions SET
                promo_code = ?, description = ?, discount_type = ?, discount_value = ?,
                valid_from = ?, valid_until = ?, usage_limit = ?, active = ?
            WHERE id = ?
        `, [
            promo_code, description, discount_type, discount_value,
            valid_from, valid_until, usage_limit, active, req.params.id
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Update promotion error:', error);
        res.status(500).json({ error: 'Failed to update promotion' });
    }
});

// Delete promotion
app.delete('/api/admin/booking/promotions/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        await db.execute('DELETE FROM public_promotions WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete promotion error:', error);
        res.status(500).json({ error: 'Failed to delete promotion' });
    }
});

// Get all testimonials
app.get('/api/admin/booking/testimonials', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [testimonials] = await db.execute(`
            SELECT * FROM public_testimonials ORDER BY display_order ASC, created_at DESC
        `);
        res.json(testimonials);
    } catch (error) {
        console.error('Get testimonials error:', error);
        res.status(500).json({ error: 'Failed to load testimonials' });
    }
});

// Get single testimonial
app.get('/api/admin/booking/testimonials/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [testimonials] = await db.execute(`
            SELECT * FROM public_testimonials WHERE id = ?
        `, [req.params.id]);

        if (testimonials.length === 0) {
            return res.status(404).json({ error: 'Testimonial not found' });
        }

        res.json(testimonials[0]);
    } catch (error) {
        console.error('Get testimonial error:', error);
        res.status(500).json({ error: 'Failed to load testimonial' });
    }
});

// Create testimonial
app.post('/api/admin/booking/testimonials', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.userId;
        const {
            patient_name, rating, testimonial_text,
            display_order, display_on_public
        } = req.body;

        const [result] = await db.execute(`
            INSERT INTO public_testimonials (
                patient_name, rating, testimonial_text,
                display_order, display_on_public, created_by
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [patient_name, rating, testimonial_text, display_order, display_on_public, userId]);

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Create testimonial error:', error);
        res.status(500).json({ error: 'Failed to create testimonial', message: error.message });
    }
});

// Update testimonial
app.put('/api/admin/booking/testimonials/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const {
            patient_name, rating, testimonial_text,
            display_order, display_on_public
        } = req.body;

        await db.execute(`
            UPDATE public_testimonials SET
                patient_name = ?, rating = ?, testimonial_text = ?,
                display_order = ?, display_on_public = ?
            WHERE id = ?
        `, [patient_name, rating, testimonial_text, display_order, display_on_public, req.params.id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Update testimonial error:', error);
        res.status(500).json({ error: 'Failed to update testimonial' });
    }
});

// Delete testimonial
app.delete('/api/admin/booking/testimonials/:id', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        await db.execute('DELETE FROM public_testimonials WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete testimonial error:', error);
        res.status(500).json({ error: 'Failed to delete testimonial' });
    }
});

// Get general settings
app.get('/api/admin/booking/settings', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clinicId = req.session.clinicId || 1; // Default to clinic 1

        const [settings] = await db.execute(`
            SELECT * FROM public_booking_settings WHERE clinic_id = ?
        `, [clinicId]);

        res.json(settings);
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// Save general settings
app.post('/api/admin/booking/settings', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const userId = req.session.userId;
        const clinicId = req.session.clinicId || 1;
        const { settings } = req.body;

        // Update or insert each setting
        for (const setting of settings) {
            await db.execute(`
                INSERT INTO public_booking_settings
                (clinic_id, setting_key, setting_value, setting_type, updated_by)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                setting_value = VALUES(setting_value),
                updated_by = VALUES(updated_by),
                updated_at = CURRENT_TIMESTAMP
            `, [clinicId, setting.setting_key, setting.setting_value, setting.setting_type, userId]);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Save settings error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// ========================================
// WEB PAGE ROUTES (Views)
// ========================================

// ========================================
// PUBLIC ROUTES (No Authentication)
// ========================================

// Public home/landing page
app.get('/', (req, res) => {
    res.render('public-home');
});

// Public booking page
app.get('/book', (req, res) => {
    res.render('public-booking');
});

// Login page
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// ========================================
// AUTHENTICATED ROUTES
// ========================================

// Dashboard page (ADMIN/PT/CLINIC)
app.get('/dashboard', authenticateToken, (req, res) => {
    if (!['ADMIN', 'PT', 'CLINIC'].includes(req.user.role)) {
        return res.status(403).send('Access denied. Only ADMIN, PT, or CLINIC roles can access dashboard.');
    }
    res.render('dashboard', { user: req.user });
});

// Appointments page (ADMIN/PT only)
app.get('/appointments', authenticateToken, (req, res) => {
    if (!['ADMIN', 'PT'].includes(req.user.role)) {
        return res.status(403).send('Access denied. Only ADMIN and PT roles can access appointments.');
    }
    res.render('appointments', { user: req.user });
});

// Admin booking settings page
app.get('/admin/booking-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-booking-settings', { user: req.user });
});

// Admin notification settings page
app.get('/admin/notification-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-notification-settings', { user: req.user });
});

// Document Settings page
app.get('/admin/document-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('document-settings', { user: req.user });
});

// Get document settings
app.get('/api/document-settings', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Load all document settings
        const [settingsRows] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE 'bill_%' OR setting_key LIKE 'pt_cert_%'`
        );

        if (settingsRows.length === 0) {
            return res.json({ settings: null });
        }

        // Reconstruct settings object
        const settings = {
            bill: {},
            certificate: {}
        };

        settingsRows.forEach(row => {
            if (row.setting_key.startsWith('bill_')) {
                const key = row.setting_key.replace('bill_', '');
                // Convert back to camelCase
                const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());

                // Handle special conversions
                if (key === 'company_name') settings.bill.companyName = row.setting_value;
                else if (key === 'company_address') settings.bill.address = row.setting_value;
                else if (key === 'company_phone') settings.bill.phone = row.setting_value;
                else if (key === 'tax_id') settings.bill.taxId = row.setting_value;
                else if (key === 'header_color') settings.bill.headerColor = row.setting_value;
                else if (key === 'footer_text') settings.bill.footerText = row.setting_value;
                else if (key === 'show_logo') settings.bill.showLogo = row.setting_value === 'true';
                else if (key === 'show_tax_id') settings.bill.showTax = row.setting_value === 'true';
                else if (key === 'show_qr') settings.bill.showQR = row.setting_value === 'true';
            } else if (row.setting_key.startsWith('pt_cert_')) {
                const key = row.setting_key.replace('pt_cert_', '');

                // Handle conversions
                if (key === 'clinic_name') settings.certificate.clinicName = row.setting_value;
                else if (key === 'clinic_address') settings.certificate.address = row.setting_value;
                else if (key === 'border_color') settings.certificate.borderColor = row.setting_value;
                else if (key === 'doctor_name') settings.certificate.doctorName = row.setting_value;
                else if (key === 'license_number') settings.certificate.license = row.setting_value;
            }
        });

        res.json({ settings: JSON.stringify(settings) });
    } catch (error) {
        console.error('Get document settings error:', error);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// Save document settings
app.post('/api/document-settings', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { settings } = req.body;

        console.log('=== SAVE DOCUMENT SETTINGS ===');
        console.log('Received settings:', settings);

        // Parse settings JSON
        const settingsObj = typeof settings === 'string' ? JSON.parse(settings) : settings;
        console.log('Parsed settingsObj:', JSON.stringify(settingsObj, null, 2));

        // Save individual settings for bills
        if (settingsObj.bill) {
            const billSettings = settingsObj.bill;
            const billKeys = {
                'company_name': billSettings.companyName || '',
                'company_address': billSettings.address || '',
                'company_phone': billSettings.phone || '',
                'tax_id': billSettings.taxId || '',
                'header_color': billSettings.headerColor || '#667eea',
                'footer_text': billSettings.footerText || '',
                'show_logo': billSettings.showLogo ? 'true' : 'false',
                'show_tax_id': billSettings.showTax ? 'true' : 'false',
                'show_qr': billSettings.showQR ? 'true' : 'false'
            };

            for (const [key, value] of Object.entries(billKeys)) {
                await db.execute(
                    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
                     VALUES (?, ?, NOW(), ?)
                     ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW(), updated_by = ?`,
                    [`bill_${key}`, value, req.user.id, value, req.user.id]
                );
            }
        }

        // Save individual settings for PT certificates
        if (settingsObj.certificate) {
            const certSettings = settingsObj.certificate;
            const certKeys = {
                'clinic_name': certSettings.clinicName || '',
                'clinic_address': certSettings.address || '',
                'border_color': certSettings.borderColor || '#667eea',
                'doctor_name': certSettings.doctorName || '',
                'license_number': certSettings.license || ''
            };

            for (const [key, value] of Object.entries(certKeys)) {
                await db.execute(
                    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
                     VALUES (?, ?, NOW(), ?)
                     ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW(), updated_by = ?`,
                    [`pt_cert_${key}`, value, req.user.id, value, req.user.id]
                );
            }
        }

        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) {
        console.error('Save document settings error:', error);
        console.error('Error details:', error.message);
        res.status(500).json({ error: 'Failed to save settings: ' + error.message });
    }
});

// Get bill document settings for printing (accessible to all authenticated users)
app.get('/api/bills/document-settings', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Load bill settings from system_settings table
        const [settingsRows] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE 'bill_%'`
        );

        // Convert rows to object
        const settings = {};
        settingsRows.forEach(row => {
            // Remove 'bill_' prefix from key
            const key = row.setting_key.replace('bill_', '');
            settings[key] = row.setting_value;
        });

        res.json(settings);
    } catch (error) {
        console.error('Get bill document settings error:', error);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// ========================================
// CENTRALIZED DOCUMENT RENDERING SYSTEM
// ========================================

// Preview document with sample data for settings page
app.get('/documents/preview/:templateType', authenticateToken, authorize('ADMIN'), async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { templateType } = req.params;

        // Load document settings for this template type
        const [settingsRows] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE ?`,
            [`${templateType}_%`]
        );

        const settings = {};
        settingsRows.forEach(row => {
            const key = row.setting_key.replace(`${templateType}_`, '');
            settings[key] = row.setting_value;
        });

        let data, templateFile;

        // Create sample data for preview
        if (templateType === 'bill') {
            data = {
                bill_code: 'BILL-2025-001',
                bill_date: new Date().toISOString().split('T')[0],
                clinic_name: 'Sample Clinic',
                patient_name: 'John Doe',
                patient_hn: 'HN-12345',
                payment_status: 'PAID',
                payment_method: 'CASH',
                subtotal: 800.00,
                discount: 0.00,
                tax: 0.00,
                total_amount: 800.00,
                items: [
                    {
                        service_name: 'Physiotherapy Session',
                        quantity: 1,
                        unit_price: 500.00,
                        discount: 0.00,
                        total_price: 500.00
                    },
                    {
                        service_name: 'Massage Therapy',
                        quantity: 1,
                        unit_price: 300.00,
                        discount: 0.00,
                        total_price: 300.00
                    }
                ],
                bill_notes: 'Sample bill for preview',
                payment_notes: null
            };
            templateFile = 'document_bill_template';

        } else if (templateType === 'pt_cert') {
            data = {
                certificate: {
                    id: 1,
                    pn_code: 'PN-2025-001',
                    created_at: new Date().toISOString(),
                    created_by_name: 'Dr. Sample'
                },
                certData: {
                    diagnosis: 'Sample diagnosis for preview',
                    treatment_plan: 'Continue physiotherapy sessions',
                    recommendations: 'Rest and follow treatment plan'
                },
                patient: {
                    hn: 'HN-12345',
                    first_name: 'John',
                    last_name: 'Doe',
                    dob: '1990-01-01',
                    phone: '02-123-4567'
                },
                pnCase: {
                    diagnosis: 'Lower back pain',
                    purpose: 'Physiotherapy treatment',
                    created_at: new Date().toISOString(),
                    completed_at: null
                },
                clinic: {
                    name: settings.clinic_name || 'Sample Clinic',
                    address: settings.clinic_address || 'Sample Address',
                    phone: '02-123-4567',
                    email: 'info@clinic.com',
                    logo_url: settings.clinic_logo || null,
                    border_color: settings.border_color || '#667eea',
                    doctor_name: settings.doctor_name || 'Dr. Sample',
                    license_number: settings.license_number || 'LICENSE-123'
                },
                soap: {
                    subjective: 'Sample subjective notes',
                    objective: 'Sample objective findings',
                    assessment: 'Sample assessment',
                    plan: 'Sample treatment plan'
                }
            };
            templateFile = 'document_pt_cert_template';

        } else {
            return res.status(400).send('Invalid template type');
        }

        // Render the template with sample data and settings
        res.render(templateFile, {
            data,
            settings,
            user: req.user,
            isPreview: true  // Flag to disable auto-print
        });

    } catch (error) {
        console.error('Document preview error:', error);
        res.status(500).send(`Failed to preview document: ${error.message}`);
    }
});

// Render document by template type and data ID
app.get('/documents/render/:templateType/:dataId', authenticateToken, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { templateType, dataId } = req.params;

        // Load document settings for this template type
        console.log('=== RENDER DOCUMENT ===');
        console.log('Template type:', templateType);
        console.log('Data ID:', dataId);

        const [settingsRows] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE ?`,
            [`${templateType}_%`]
        );

        console.log('Loaded settings rows:', settingsRows);

        const settings = {};
        settingsRows.forEach(row => {
            const key = row.setting_key.replace(`${templateType}_`, '');
            settings[key] = row.setting_value;
        });

        console.log('Final settings object:', settings);

        let data, templateFile;

        // Load data based on template type
        if (templateType === 'bill') {
            // Load bill data
            const [bills] = await db.execute(
                `SELECT b.*, c.name as clinic_name,
                        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                        p.hn as patient_hn
                 FROM bills b
                 LEFT JOIN clinics c ON b.clinic_id = c.id
                 LEFT JOIN patients p ON b.patient_id = p.id
                 WHERE b.id = ?`,
                [dataId]
            );

            if (bills.length === 0) {
                return res.status(404).send('Bill not found');
            }

            // Load bill items
            const [items] = await db.execute(
                `SELECT bi.*, s.service_name
                 FROM bill_items bi
                 LEFT JOIN services s ON bi.service_id = s.id
                 WHERE bi.bill_id = ?`,
                [dataId]
            );

            data = {
                ...bills[0],
                items: items
            };
            templateFile = 'document_bill_template';

        } else if (templateType === 'pt_cert') {
            // Load PT certificate data
            const [certificates] = await db.execute(
                `SELECT c.*,
                        pn.pn_code, pn.diagnosis, pn.purpose, pn.created_at as pn_created_at,
                        pn.completed_at, pn.target_clinic_id,
                        p.hn, p.first_name, p.last_name, p.dob, p.phone,
                        cl.name as clinic_name, cl.address as clinic_address,
                        cl.phone as clinic_phone, cl.email as clinic_email,
                        CONCAT(u.first_name, ' ', u.last_name) as created_by_name
                 FROM pt_certificates c
                 JOIN pn_cases pn ON c.pn_id = pn.id
                 JOIN patients p ON pn.patient_id = p.id
                 LEFT JOIN clinics cl ON pn.target_clinic_id = cl.id
                 JOIN users u ON c.created_by = u.id
                 WHERE c.id = ?`,
                [dataId]
            );

            if (certificates.length === 0) {
                return res.status(404).send('Certificate not found');
            }

            const certificate = certificates[0];
            const certData = JSON.parse(certificate.certificate_data || '{}');

            // Get latest SOAP note
            const [soapNotes] = await db.execute(
                `SELECT subjective, objective, assessment, plan
                 FROM pn_soap_notes
                 WHERE pn_id = ?
                 ORDER BY timestamp DESC
                 LIMIT 1`,
                [certificate.pn_id]
            );

            data = {
                certificate: {
                    id: certificate.id,
                    pn_code: certificate.pn_code,
                    created_at: certificate.created_at,
                    created_by_name: certificate.created_by_name
                },
                certData,
                patient: {
                    hn: certificate.hn,
                    first_name: certificate.first_name,
                    last_name: certificate.last_name,
                    dob: certificate.dob,
                    phone: certificate.phone
                },
                pnCase: {
                    diagnosis: certificate.diagnosis,
                    purpose: certificate.purpose,
                    created_at: certificate.pn_created_at,
                    completed_at: certificate.completed_at
                },
                clinic: {
                    name: settings.clinic_name || certificate.clinic_name || 'RehabPlus',
                    address: settings.clinic_address || certificate.clinic_address || '',
                    phone: certificate.clinic_phone || '',
                    email: certificate.clinic_email || '',
                    logo_url: settings.clinic_logo || null,
                    border_color: settings.border_color || '#667eea',
                    doctor_name: settings.doctor_name || certificate.created_by_name,
                    license_number: settings.license_number || ''
                },
                soap: soapNotes.length > 0 ? soapNotes[0] : null
            };
            templateFile = 'document_pt_cert_template';

        } else {
            return res.status(400).send('Invalid template type');
        }

        // Render the template with data and settings
        res.render(templateFile, {
            data,
            settings,
            user: req.user,
            isPreview: false  // Enable auto-print for actual documents
        });

    } catch (error) {
        console.error('Document render error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).send(`Failed to render document: ${error.message}`);
    }
});

// LINE Webhook IDs viewer page
app.get('/admin/line-webhook-ids', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-line-webhook-ids', { user: req.user });
});

// Google Calendar settings page
app.get('/admin/google-calendar-settings', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin-google-calendar-settings', { user: req.user });
});

// Patients page
app.get('/patients', authenticateToken, (req, res) => {
    res.render('patients', { user: req.user });
});

// Patient registration
app.get('/patient/register', authenticateToken, (req, res) => {
    res.render('patient-register', { user: req.user });
});

// Patient detail
app.get('/patient/:id', authenticateToken, (req, res) => {
    res.render('patient-detail', { user: req.user, patientId: req.params.id });
});

// PN case detail
app.get('/pn/:id', authenticateToken, (req, res) => {
    res.render('pn-detail', { user: req.user, pnId: req.params.id });
});

// Profile page
app.get('/profile', authenticateToken, (req, res) => {
    res.render('profile', { user: req.user });
});

// Diagnostic page (for troubleshooting)
app.get('/diagnostic', authenticateToken, (req, res) => {
    res.render('diagnostic', { user: req.user });
});

// Test static files
app.get('/test-static', authenticateToken, (req, res) => {
    res.render('test-static', { user: req.user });
});

// Bills page (ADMIN only)
app.get('/bills', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('bills', { user: req.user });
});

// Courses page (All authenticated users)
app.get('/courses', authenticateToken, (req, res) => {
    res.render('courses', { user: req.user });
});

// Statistics page (ADMIN and PT only)
app.get('/statistics', authenticateToken, (req, res) => {
    if (!['ADMIN', 'PT'].includes(req.user.role)) {
        return res.status(403).send('Access denied. Only ADMIN and PT roles can access statistics.');
    }
    res.render('statistics', { user: req.user });
});

// Loyalty/Membership page - Admin and PT
app.get('/loyalty', authenticateToken, (req, res) => {
    if (!['ADMIN', 'PT'].includes(req.user.role)) {
        return res.status(403).send('Access denied. Only ADMIN and PT roles can access loyalty program.');
    }
    res.render('loyalty', { user: req.user });
});

// Admin pages
app.get('/admin/users', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin/users', { user: req.user });
});

app.get('/admin/clinics', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin/clinics', { user: req.user });
});

// Admin services management page
app.get('/admin/services', authenticateToken, authorize('ADMIN'), (req, res) => {
    res.render('admin/services', { user: req.user });
});

module.exports = app;
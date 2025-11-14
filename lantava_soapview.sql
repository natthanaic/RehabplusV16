-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Nov 14, 2025 at 08:44 AM
-- Server version: 10.11.6-MariaDB-0+deb12u1-log
-- PHP Version: 8.4.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `lantava_soapview`
--

-- --------------------------------------------------------

--
-- Table structure for table `appointments`
--

CREATE TABLE `appointments` (
  `id` int(11) NOT NULL,
  `patient_id` int(11) DEFAULT NULL,
  `walk_in_name` varchar(200) DEFAULT NULL,
  `walk_in_phone` varchar(50) DEFAULT NULL,
  `walk_in_email` varchar(255) DEFAULT NULL COMMENT 'Email address for walk-in bookings (optional)',
  `booking_type` enum('WALK_IN','OLD_PATIENT') NOT NULL DEFAULT 'OLD_PATIENT',
  `clinic_id` int(11) NOT NULL,
  `pt_id` int(11) DEFAULT NULL,
  `appointment_date` date NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `status` enum('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
  `appointment_type` varchar(100) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `calendar_event_id` varchar(255) DEFAULT NULL COMMENT 'Google Calendar Event ID',
  `cancellation_reason` text DEFAULT NULL,
  `cancelled_by` int(11) DEFAULT NULL,
  `cancelled_at` timestamp NULL DEFAULT NULL,
  `pn_case_id` int(11) DEFAULT NULL COMMENT 'Links to PN case if auto-created',
  `auto_created_pn` tinyint(1) DEFAULT 0 COMMENT 'Whether PN was auto-created from appointment',
  `course_id` int(11) DEFAULT NULL COMMENT 'Links to course for course cutting',
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `pn_id` int(11) DEFAULT NULL COMMENT 'Link to pn_cases for status sync',
  `client_ip_address` varchar(45) DEFAULT NULL COMMENT 'IP address of client who created the appointment (for walk-in bookings)'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audit_logs`
--

CREATE TABLE `audit_logs` (
  `id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `entity_type` varchar(50) DEFAULT NULL,
  `entity_id` int(11) DEFAULT NULL,
  `old_values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`old_values`)),
  `new_values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`new_values`)),
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Audit trail of system actions';

-- --------------------------------------------------------

--
-- Table structure for table `bills`
--

CREATE TABLE `bills` (
  `id` int(11) NOT NULL,
  `bill_code` varchar(50) NOT NULL,
  `patient_id` int(11) DEFAULT NULL,
  `walk_in_name` varchar(200) DEFAULT NULL,
  `walk_in_phone` varchar(50) DEFAULT NULL,
  `clinic_id` int(11) NOT NULL,
  `bill_date` date NOT NULL,
  `subtotal` decimal(10,2) NOT NULL,
  `discount` decimal(10,2) DEFAULT 0.00,
  `tax` decimal(10,2) DEFAULT 0.00,
  `total_amount` decimal(10,2) NOT NULL,
  `payment_method` enum('CASH','CREDIT_CARD','BANK_TRANSFER','INSURANCE','OTHER') DEFAULT 'CASH',
  `payment_status` enum('UNPAID','PAID','PARTIAL','CANCELLED') DEFAULT 'UNPAID',
  `payment_notes` text DEFAULT NULL,
  `bill_notes` text DEFAULT NULL,
  `appointment_id` int(11) DEFAULT NULL,
  `pn_case_id` int(11) DEFAULT NULL COMMENT 'Links to PN case if bill created from PN',
  `course_id` int(11) DEFAULT NULL COMMENT 'Links to course if course cutting',
  `is_course_cutting` tinyint(1) DEFAULT 0 COMMENT 'Whether this bill cuts from a course',
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bill_items`
--

CREATE TABLE `bill_items` (
  `id` int(11) NOT NULL,
  `bill_id` int(11) NOT NULL,
  `service_id` int(11) DEFAULT NULL,
  `service_name` varchar(200) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(10,2) NOT NULL,
  `discount` decimal(10,2) DEFAULT 0.00,
  `total_price` decimal(10,2) NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `certificate_settings`
--

CREATE TABLE `certificate_settings` (
  `id` int(11) NOT NULL,
  `clinic_id` int(11) DEFAULT NULL COMMENT 'NULL = default for all clinics',
  `clinic_logo_url` varchar(500) DEFAULT NULL,
  `clinic_name` varchar(255) DEFAULT NULL,
  `clinic_address` text DEFAULT NULL,
  `clinic_phone` varchar(50) DEFAULT NULL,
  `clinic_email` varchar(100) DEFAULT NULL,
  `header_text` text DEFAULT NULL,
  `footer_text` text DEFAULT NULL,
  `show_pt_diagnosis` tinyint(1) DEFAULT 1,
  `show_subjective` tinyint(1) DEFAULT 1,
  `show_treatment_period` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `clinics`
--

CREATE TABLE `clinics` (
  `id` int(11) NOT NULL,
  `code` varchar(20) NOT NULL,
  `name` varchar(200) NOT NULL,
  `address` text DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `contact_person` varchar(100) DEFAULT NULL,
  `active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `clinics`
--

INSERT INTO `clinics` (`id`, `code`, `name`, `address`, `phone`, `email`, `contact_person`, `active`, `created_at`, `updated_at`) VALUES
(1, 'CL001', 'LANTAVAFIX', '486/2 Moo.3 Saladan, Koh Lanta, Krabi 81150', '098-0946349', 'info@lantavafix.com', 'Suttida Chooluan', 1, '2025-10-30 13:06:38', '2025-11-01 08:02:47'),
(2, 'CL002', 'THONBURI LANTA CLINIC', '486/2 Moo.2 Saladan, Ko Lanta, Krabi 81150', '098-0946349', 'thonburilanta@gmail.com', 'CHAINAKORN.C', 1, '2025-10-30 13:06:38', '2025-11-01 08:03:58'),
(3, 'CL003', 'SOUTH LANTA CLINIC', 'Saladan, Klongthom, Krabi', '02-345-6789', 'partner.b@clinic.com', 'Dr. Williams', 1, '2025-10-30 13:06:38', '2025-11-01 08:04:36');

-- --------------------------------------------------------

--
-- Table structure for table `clinic_service_pricing`
--

CREATE TABLE `clinic_service_pricing` (
  `id` int(11) NOT NULL,
  `clinic_id` int(11) NOT NULL,
  `service_id` int(11) NOT NULL,
  `clinic_price` decimal(10,2) DEFAULT NULL COMMENT 'Clinic-specific price override',
  `is_enabled` tinyint(1) DEFAULT 1 COMMENT 'Service enabled for this clinic',
  `updated_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `courses`
--

CREATE TABLE `courses` (
  `id` int(11) NOT NULL,
  `course_code` varchar(50) NOT NULL,
  `course_name` varchar(200) NOT NULL,
  `course_description` text DEFAULT NULL,
  `patient_id` int(11) NOT NULL COMMENT 'Patient who purchased the course',
  `clinic_id` int(11) NOT NULL COMMENT 'Clinic where course was purchased',
  `total_sessions` int(11) NOT NULL DEFAULT 0,
  `used_sessions` int(11) NOT NULL DEFAULT 0,
  `remaining_sessions` int(11) NOT NULL DEFAULT 0,
  `course_price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `price_per_session` decimal(10,2) NOT NULL DEFAULT 0.00,
  `purchase_date` date NOT NULL,
  `expiry_date` date DEFAULT NULL COMMENT 'Course expiry date (optional)',
  `status` enum('ACTIVE','COMPLETED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  `bill_id` int(11) DEFAULT NULL COMMENT 'Link to billing record',
  `notes` text DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Course packages purchased by patients for physiotherapy sessions';

-- --------------------------------------------------------

--
-- Table structure for table `course_templates`
--

CREATE TABLE `course_templates` (
  `id` int(11) NOT NULL,
  `template_name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `total_sessions` int(11) NOT NULL,
  `default_price` decimal(10,2) NOT NULL,
  `validity_days` int(11) DEFAULT NULL COMMENT 'Number of days course is valid',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Templates for creating course packages';

-- --------------------------------------------------------

--
-- Table structure for table `course_usage_history`
--

CREATE TABLE `course_usage_history` (
  `id` int(11) NOT NULL,
  `course_id` int(11) NOT NULL,
  `bill_id` int(11) DEFAULT NULL COMMENT 'Related bill if from billing',
  `pn_id` int(11) DEFAULT NULL COMMENT 'Related PN case if used for PN',
  `sessions_used` int(11) NOT NULL DEFAULT 1,
  `usage_date` date NOT NULL,
  `action_type` enum('USE','RETURN','ADJUST') NOT NULL DEFAULT 'USE' COMMENT 'USE=deduct, RETURN=refund, ADJUST=manual adjustment',
  `notes` text DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='History of course session usage, returns, and adjustments';

-- --------------------------------------------------------

--
-- Table structure for table `gift_cards`
--

CREATE TABLE `gift_cards` (
  `id` int(11) NOT NULL,
  `gift_card_code` varchar(50) NOT NULL,
  `member_id` int(11) NOT NULL,
  `points_redeemed` int(11) NOT NULL,
  `gift_card_value` decimal(10,2) NOT NULL,
  `status` enum('ACTIVE','REDEEMED','EXPIRED','CANCELLED') DEFAULT 'ACTIVE',
  `issued_date` datetime DEFAULT current_timestamp(),
  `expiry_date` date DEFAULT NULL,
  `redeemed_date` datetime DEFAULT NULL,
  `redeemed_by_user` int(11) DEFAULT NULL,
  `bill_id_used` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `gift_card_catalog`
--

CREATE TABLE `gift_card_catalog` (
  `id` int(11) NOT NULL,
  `name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `points_required` int(11) NOT NULL,
  `gift_card_value` decimal(10,2) NOT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `stock_quantity` int(11) DEFAULT -1 COMMENT '-1 means unlimited',
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `loyalty_members`
--

CREATE TABLE `loyalty_members` (
  `id` int(11) NOT NULL,
  `patient_id` int(11) NOT NULL,
  `membership_tier` enum('BRONZE','SILVER','GOLD','PLATINUM') DEFAULT 'BRONZE',
  `total_points` int(11) DEFAULT 0,
  `available_points` int(11) DEFAULT 0,
  `lifetime_spending` decimal(10,2) DEFAULT 0.00,
  `current_year_spending` decimal(10,2) DEFAULT 0.00,
  `member_since` date NOT NULL,
  `last_activity` datetime DEFAULT NULL,
  `status` enum('ACTIVE','INACTIVE','SUSPENDED') DEFAULT 'ACTIVE',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `loyalty_tier_rules`
--

CREATE TABLE `loyalty_tier_rules` (
  `id` int(11) NOT NULL,
  `tier` enum('BRONZE','SILVER','GOLD','PLATINUM') NOT NULL,
  `min_spending` decimal(10,2) NOT NULL,
  `points_per_100_baht` int(11) DEFAULT 1,
  `discount_percentage` decimal(5,2) DEFAULT 0.00,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `loyalty_transactions`
--

CREATE TABLE `loyalty_transactions` (
  `id` int(11) NOT NULL,
  `member_id` int(11) NOT NULL,
  `transaction_type` enum('EARN','REDEEM','EXPIRE','ADJUST') NOT NULL,
  `points` int(11) NOT NULL,
  `bill_id` int(11) DEFAULT NULL,
  `gift_card_id` int(11) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `performed_by` int(11) DEFAULT NULL,
  `transaction_date` datetime DEFAULT current_timestamp(),
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notification_settings`
--

CREATE TABLE `notification_settings` (
  `id` int(11) NOT NULL,
  `setting_type` varchar(50) NOT NULL COMMENT 'Type: smtp, line',
  `setting_value` text NOT NULL COMMENT 'JSON encoded settings',
  `updated_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `patients`
--

CREATE TABLE `patients` (
  `id` int(11) NOT NULL,
  `hn` varchar(50) NOT NULL,
  `pt_number` varchar(50) NOT NULL,
  `pid` varchar(13) DEFAULT NULL,
  `passport_no` varchar(50) DEFAULT NULL,
  `title` varchar(20) DEFAULT NULL,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `dob` date NOT NULL,
  `gender` enum('M','F','O') DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `emergency_contact` varchar(100) DEFAULT NULL,
  `emergency_phone` varchar(50) DEFAULT NULL,
  `diagnosis` text NOT NULL,
  `rehab_goal` text DEFAULT NULL,
  `rehab_goal_other` text DEFAULT NULL,
  `body_area` varchar(200) DEFAULT NULL,
  `frequency` varchar(100) DEFAULT NULL,
  `expected_duration` varchar(100) DEFAULT NULL,
  `doctor_note` text DEFAULT NULL,
  `precaution` text DEFAULT NULL,
  `contraindication` text DEFAULT NULL,
  `medical_history` text DEFAULT NULL,
  `clinic_id` int(11) NOT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `patients`
--

INSERT INTO `patients` (`id`, `hn`, `pt_number`, `pid`, `passport_no`, `title`, `first_name`, `last_name`, `dob`, `gender`, `phone`, `email`, `address`, `emergency_contact`, `emergency_phone`, `diagnosis`, `rehab_goal`, `rehab_goal_other`, `body_area`, `frequency`, `expected_duration`, `doctor_note`, `precaution`, `contraindication`, `medical_history`, `clinic_id`, `created_by`, `created_at`, `updated_at`) VALUES
(4, 'PT25001', 'PT20251107151516329', '1810400167167', NULL, 'Mr.', 'ณัฐนัย', 'ไชยบุตร', '0000-00-00', '', '0980946349', 'info@lantavafix', 'ศาลาด่าน เกาะลันตา กระบี่', '0980946349', '0980946349', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '1 time/week', '4 weeks', NULL, 'None', NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(5, 'PT25002', 'PT20251107151516430', '1909802316423', NULL, 'Mrs.', 'สุทธิดา', 'ชูเลื่อน', '0000-00-00', '', '0980946350', 'info@lantavafix', NULL, '0980946350', '0980946350', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '2 time/week', '5 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(6, 'PT25003', 'PT20251107151516840', '3910100302293', NULL, 'Mr.', 'อภิสฤษฎ์', 'อาคาสุวรรณ', '0000-00-00', '', '0980946351', 'info@lantavafix', NULL, '0980946351', '0980946351', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '3 time/week', '6 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(7, 'PT25004', 'PT20251107151516298', 'C4KNGJ22K', NULL, 'Mr.', 'Toni', 'Seeman', '0000-00-00', '', '0980946352', 'info@lantavafix', NULL, '0980946352', '0980946352', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '4 time/week', '7 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(8, 'PT25005', 'PT20251107151516875', '642659092', NULL, 'Mrs.', 'CARTER-SCOTT', 'POMIJE', '0000-00-00', '', '0980946353', 'info@lantavafix', NULL, '0980946353', '0980946353', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '5 time/week', '8 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(9, 'PT25006', 'PT20251107151516542', '6426590736', NULL, 'Mr.', 'Michael Anthony', 'Pomije', '0000-00-00', '', '0980946354', 'info@lantavafix', NULL, '0980946354', '0980946354', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '6 time/week', '9 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(10, 'PT25007', 'PT20251107151516568', 'NPBPD2201', NULL, 'Mr.', 'DANNY', 'KOPPERS', '0000-00-00', '', '0980946355', 'info@lantavafix', NULL, '0980946355', '0980946355', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '7 time/week', '10 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(11, 'PT25008', 'PT20251107151516460', '3740100163066', NULL, 'Mrs.', 'ภริตพร', 'อินสว่าง', '0000-00-00', '', '0980946356', 'info@lantavafix', NULL, '0980946356', '0980946356', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '8 time/week', '11 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(12, 'PT25009', 'PT20251107151516284', '1349900578355', NULL, 'Mr.', 'อนุชา', 'แก้วหิน', '0000-00-00', '', '0980946357', 'info@lantavafix', NULL, '0980946357', '0980946357', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '9 time/week', '12 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(13, 'PT25010', 'PT20251107151516572', '1810300050128', NULL, 'Mr.', 'สถาพร', 'ไทรบุรี', '0000-00-00', '', '0980946358', 'info@lantavafix', NULL, '0980946358', '0980946358', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '10 time/week', '13 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(14, 'PT25011', 'PT20251107151516765', '3110300902496', NULL, 'Mrs.', 'เหมือนฝัน', 'ศิริสัมพันธ์', '0000-00-00', '', '0980946359', 'info@lantavafix', NULL, '0980946359', '0980946359', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '11 time/week', '14 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(15, 'PT25012', 'PT20251107151516408', '17FV18341', NULL, 'Mr.', 'Pages', 'Olivier', '0000-00-00', '', '0980946360', 'info@lantavafix', NULL, '0980946360', '0980946360', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '12 time/week', '15 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(16, 'PT25013', 'PT20251107151516586', '22H150986', NULL, 'Mr.', 'Kane', 'Tidiane', '0000-00-00', '', '0980946361', 'info@lantavafix', NULL, '0980946361', '0980946361', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '13 time/week', '16 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(17, 'PT25014', 'PT20251107151516382', '3930200001601', NULL, 'Mr.', 'เสวก', 'เหล็มปาน', '0000-00-00', '', '0980946362', 'info@lantavafix', NULL, '0980946362', '0980946362', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '14 time/week', '17 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(18, 'PT25015', 'PT20251107151516063', '3809900547745', NULL, 'Mrs.', 'โสภิดา', 'นาคทองทิพย์', '0000-00-00', '', '0980946363', 'info@lantavafix', NULL, '0980946363', '0980946363', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '15 time/week', '18 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(19, 'PT25016', 'PT20251107151516085', 'LT7988792', NULL, 'Mrs.', 'Maeve', 'Henry', '0000-00-00', '', '0980946364', 'info@lantavafix', NULL, '0980946364', '0980946364', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '16 time/week', '19 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(20, 'PT25017', 'PT20251107151516261', '3810400085108', NULL, 'Mrs.', 'สุวรรณา', 'หลานอา', '0000-00-00', '', '0980946365', 'info@lantavafix', NULL, '0980946365', '0980946365', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '17 time/week', '20 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(21, 'PT25018', 'PT20251107151516585', '1810300054891', NULL, 'Mr.', 'ฤทธา', 'ก๊กใหญ่', '0000-00-00', '', '0980946366', 'info@lantavafix', NULL, '0980946366', '0980946366', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '18 time/week', '21 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(22, 'PT25019', 'PT20251107151516202', 'AA2778445', NULL, 'Mr.', 'FURQAN', 'SHAYK', '0000-00-00', '', '0980946367', 'info@lantavafix', NULL, '0980946367', '0980946367', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '19 time/week', '22 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(23, 'PT25020', 'PT20251107151516165', '3841300160117', NULL, 'Mrs.', 'วิสรา', 'ทองน้อย', '0000-00-00', '', '0980946368', 'info@lantavafix', NULL, '0980946368', '0980946368', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '20 time/week', '23 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(24, 'PT25021', 'PT20251107151516685', 'AC4571886', NULL, 'Mrs.', 'Alesha', 'Leslie', '0000-00-00', '', '0980946369', 'info@lantavafix', NULL, '0980946369', '0980946369', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '21 time/week', '24 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(25, 'PT25023', 'PT20251107151516992', 'Unknow2', NULL, 'Mrs.', 'Oksana', 'Koliyk', '0000-00-00', '', '0980946371', 'info@lantavafix', NULL, '0980946371', '0980946371', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '23 time/week', '26 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(26, 'PT25024', 'PT20251107151516527', '1810300002085', NULL, 'Mr.', 'สุวิทย์', 'กสิคุณ', '0000-00-00', '', '0980946372', 'info@lantavafix', NULL, '0980946372', '0980946372', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '24 time/week', '27 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(27, 'PT25026', 'PT20251107151516900', '1959900554353', NULL, 'Mr.', 'ณัฐวัฒน์', 'ทองหนูนุ้ย', '0000-00-00', '', '0980946374', 'info@lantavafix', NULL, '0980946374', '0980946374', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '26 time/week', '29 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(28, 'PT25027', 'PT20251107151516838', 'RA8340672', NULL, 'Mr.', 'PATRICK', 'BONHAM', '0000-00-00', '', '0980946375', 'info@lantavafix', NULL, '0980946375', '0980946375', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '27 time/week', '30 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(29, 'PT25028', 'PT20251107151516180', '1819900413785', NULL, 'Mrs.', 'ชนัษฎา', 'ก๊กใหม่', '0000-00-00', '', '0980946376', 'info@lantavafix', NULL, '0980946376', '0980946376', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '28 time/week', '31 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(30, 'PT25029', 'PT20251107151516869', '3930100073791', NULL, 'Mr.', 'ปราโมทย์', 'สุขสุวรรณ์', '0000-00-00', '', '0980946377', 'info@lantavafix', NULL, '0980946377', '0980946377', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '29 time/week', '32 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(31, 'PT25030', 'PT20251107151516449', 'Unknow3', NULL, 'Mrs.', 'วิภาวดี', 'ศรีทอง', '0000-00-00', '', '0980946378', 'info@lantavafix', NULL, '0980946378', '0980946378', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '30 time/week', '33 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(32, 'PT25031', 'PT20251107151516110', 'AAI306535', NULL, 'Mrs.', 'Cintia', 'Artola', '0000-00-00', '', '0980946379', 'info@lantavafix', NULL, '0980946379', '0980946379', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '31 time/week', '34 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(33, 'PT25032', 'PT20251107151516061', '381030041061', NULL, 'Mr.', 'กุศล', 'จะเดดัง', '0000-00-00', '', '0980946380', 'info@lantavafix', NULL, '0980946380', '0980946380', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '32 time/week', '35 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(34, 'PT25033', 'PT20251107151516879', 'Unknow4', NULL, 'Mr.', 'Borin', 'Brice', '0000-00-00', '', '0980946381', 'info@lantavafix', NULL, '0980946381', '0980946381', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '33 time/week', '36 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(35, 'PT25034', 'PT20251107151516086', '16AL12562', NULL, 'Mrs.', 'Nanorillion', 'Chloe', '0000-00-00', '', '0980946382', 'info@lantavafix', NULL, '0980946382', '0980946382', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '34 time/week', '37 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(36, 'PT25035', 'PT20251107151516176', '17AT73981', NULL, 'Mrs.', 'Elhaimour', 'Shainez', '0000-00-00', '', '0980946383', 'info@lantavafix', NULL, '0980946383', '0980946383', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '35 time/week', '38 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(37, 'PT25036', 'PT20251107151516213', 'Unknow5', NULL, 'Mr.', 'ARTUR', 'KRUEGER', '0000-00-00', '', '0980946384', 'info@lantavafix', NULL, '0980946384', '0980946384', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '36 time/week', '39 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(38, 'PT25037', 'PT20251107151516844', '1810300062304', NULL, 'Mrs.', 'ทัศวรรณ', 'กุลสถาพร', '0000-00-00', '', '0980946385', 'info@lantavafix', NULL, '0980946385', '0980946385', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '37 time/week', '40 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(39, 'PT25038', 'PT20251107151516567', '3101900348067', NULL, 'Mr.', 'วิสุทธิ์', 'เจียวก๊ก', '0000-00-00', '', '0980946386', 'info@lantavafix', NULL, '0980946386', '0980946386', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '38 time/week', '41 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(40, 'PT25039', 'PT20251107151516312', '151495187', NULL, 'Mrs.', 'Audreea', 'Papillon', '0000-00-00', '', '0980946387', 'info@lantavafix', NULL, '0980946387', '0980946387', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '39 time/week', '42 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(41, 'PT25040', 'PT20251107151516876', '3801100438723', NULL, 'Mr.', 'สิทธิพร', 'บุญชู', '0000-00-00', '', '0980946388', 'info@lantavafix', NULL, '0980946388', '0980946388', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '40 time/week', '43 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(42, 'PT25041', 'PT20251107151516706', '3909900115071', NULL, 'Mr.', 'โกเมน', 'คงเจียมศิริ', '0000-00-00', '', '0980946389', 'info@lantavafix', NULL, '0980946389', '0980946389', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '41 time/week', '44 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(43, 'PT25042', 'PT20251107151516282', '1869900160763', NULL, 'Mrs.', 'ณัฐณิชา', 'เอื้ออารีศักดา', '0000-00-00', '', '0980946390', 'info@lantavafix', NULL, '0980946390', '0980946390', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '42 time/week', '45 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(44, 'PT25043', 'PT20251107151516143', '1800800006829', NULL, 'Mrs.', 'วิชฎา', 'ก๊กใหญ่', '0000-00-00', '', '0980946391', 'info@lantavafix', NULL, '0980946391', '0980946391', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '43 time/week', '46 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(45, 'PT25044', 'PT20251107151516839', '1103701431601', NULL, 'Mrs.', 'น้ำทิพย์', 'สิทธิ', '0000-00-00', '', '0980946392', 'info@lantavafix', NULL, '0980946392', '0980946392', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '44 time/week', '47 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(46, 'PT25045', 'PT20251107151516759', '3810300058567', NULL, 'Mr.', 'ทัศพล', 'กสิคุณ', '0000-00-00', '', '0980946393', 'info@lantavafix', NULL, '0980946393', '0980946393', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '45 time/week', '48 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(47, 'PT25046', 'PT20251107151516604', 'C26609625', NULL, 'Mr.', 'FERGAL', 'O SHEA', '1987-08-12', 'M', '0980946394', 'info@lantavafix', NULL, '0980946394', '0980946394', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '46 time/week', '49 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', '2025-11-08 11:45:11'),
(48, 'PT25047', 'PT20251107151516466', 'Unknow6', NULL, 'Mrs.', 'นิลัทธนา', 'ก๊กใหญ่', '0000-00-00', '', '0980946395', 'info@lantavafix', NULL, '0980946395', '0980946395', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '47 time/week', '50 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(49, 'PT25048', 'PT20251107151516459', '3810300042539', NULL, 'Mrs.', 'สุชาตา', 'ก๊กใหญ่', '0000-00-00', '', '0980946396', 'info@lantavafix', NULL, '0980946396', '0980946396', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '48 time/week', '51 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(50, 'PT25049', 'PT20251107151516124', 'Unknow7', NULL, 'Mr.', 'หมาดนะ', 'จำเริศราญ', '0000-00-00', '', '0980946397', 'info@lantavafix', NULL, '0980946397', '0980946397', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '49 time/week', '52 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(51, 'PT25050', 'PT20251107151516591', '565894684', NULL, 'Mrs.', 'Marilyn', 'Ryan', '0000-00-00', '', '0980946398', 'info@lantavafix', NULL, '0980946398', '0980946398', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '50 time/week', '53 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(52, 'PT25051', 'PT20251107151516548', 'CF44TNNTP', NULL, 'Mrs.', 'Kathasina', 'Goj', '0000-00-00', '', '0980946399', 'info@lantavafix', NULL, '0980946399', '0980946399', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '51 time/week', '54 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(53, 'PT25052', 'PT20251107151516828', 'Unknow8', NULL, 'Mr.', 'อาทิตย์', 'และตี', '0000-00-00', '', '0980946400', 'info@lantavafix', NULL, '0980946400', '0980946400', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '52 time/week', '55 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(54, 'PT25053', 'PT20251107151516413', 'Unknow9', NULL, 'Mrs.', 'สุดา', 'ก๊กใหญ่', '0000-00-00', '', '0980946401', 'info@lantavafix', NULL, '0980946401', '0980946401', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '53 time/week', '56 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(55, 'PT25054', 'PT20251107151516521', '4849900004006', NULL, 'Mrs.', 'สุทิศา', 'นันต์ธนะ', '0000-00-00', '', '0980946402', 'info@lantavafix', NULL, '0980946402', '0980946402', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '54 time/week', '57 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(56, 'PT25055', 'PT20251107151516903', '1102001910123', NULL, 'Mrs.', 'ธนัญญา', 'เพรียวพานิช', '0000-00-00', '', '0980946403', 'info@lantavafix', NULL, '0980946403', '0980946403', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '55 time/week', '58 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(57, 'PT25057', 'PT20251107151516394', 'Unknow 10', NULL, 'Mr.', 'Nils', 'Finge', '0000-00-00', '', '0980946405', 'info@lantavafix', NULL, '0980946405', '0980946405', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '57 time/week', '60 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(58, 'PT25058', 'PT20251107151516192', '1820390002217', NULL, 'Mr.', 'นฤพนธ์', 'อินทร์กำเนิด', '0000-00-00', '', '0980946406', 'info@lantavafix', NULL, '0980946406', '0980946406', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '58 time/week', '61 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(59, 'PT25059', 'PT20251107151516363', '20AD24621', NULL, 'Mr.', 'Sanuel', 'Doualle', '0000-00-00', '', '0980946407', 'info@lantavafix', NULL, '0980946407', '0980946407', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '59 time/week', '62 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(60, 'PT25060', 'PT20251107151516718', 'XOP93M28', NULL, 'Mrs.', 'Lelia', 'Elpidine', '0000-00-00', '', '0980946408', 'info@lantavafix', NULL, '0980946408', '0980946408', 'Pain relief', 'Relief pain', NULL, 'Multipoints', '60 time/week', '63 weeks', NULL, NULL, NULL, NULL, 1, 1, '2025-11-07 08:15:16', NULL),
(61, 'PT25061', 'PT20251107154339840', '', 'BB819946227', '', 'Jurai', 'Dorosenko', '1998-08-31', 'M', '-', 'tobiasfunke250@gmail.com', 'Slovakia', '-', '-', 'Lt.lower back pain', 'Pain reduction, Improve ROM', '', 'Lower Back', 'As needed', '1-2 weeks', '', '', '', '-', 1, 1, '2025-11-07 08:43:39', NULL),
(62, 'PT25062', 'PT20251108121841791', '1910500044903', '', 'Mrs.', 'อามีเราะฮ์', 'สาลีมีน', '1984-01-01', 'F', '0624861183', 'ameeroh6047@gmail.com', 'เกาะลันตา กระบี่', '0624861183', '0624861183', 'มีอาการชาปวดร้าวไปถึงปลาย ขาทั้ง 2 ข้าง ในท่าหดกล้ามเนื้อ', 'Pain reduction, Improve ROM', '', 'Hip', '2 times/week', '2-4 weeks', '', '', '', 'เคยคลอดลูกด้วยการบล้อกหลัง 3 ครั้ง ', 1, 1, '2025-11-08 05:18:41', NULL),
(63, 'PT25063', 'PT20251108154324520', '3800101233661', '', 'Mr.', 'สุภกิจ ', 'นาคทิพย์', '1972-05-26', 'M', '0651155548', '', 'เกาะลันตา Yellow bistro', '', '', 'Rt.SI joint dysfuction', 'Pain reduction, Improve ROM', '', 'Lower Back', 'Daily', '1-2 weeks', '', '', '', 'pt.มีอาการปวดหลังขวา มา 2 วัน', 1, 1, '2025-11-08 08:43:24', NULL),
(64, 'PT25064', 'PT20251110093508798', 'Foreginer01', '', 'Mr.', 'Alexander', 'Svanberg', '1987-01-01', 'M', '+46709983894', '', '', '', '', 'Hip stiffness', 'Pain reduction, Improve ROM', '', 'Hip', '2 times/week', '1-2 weeks', '', '', '', 'Testicle opration', 1, 1, '2025-11-10 02:35:08', NULL),
(65, 'PT25065', 'PT20251110112823216', 'Foreginer02', '', 'Mr.', 'VAN NIEUWISUG ', 'WILLIAM', '1975-01-01', 'M', '0937819684', 'WANN777@gmail.com', 'krabi', '', '', 'neck stiffness', 'Improve ROM', '', 'Neck', 'As needed', '1-2 weeks', '', '', '', 'rising on the bed feel neck stiffness', 1, 1, '2025-11-10 04:28:23', NULL),
(66, 'PT25066', 'PT20251110180232781', 'Foreginer03', '', 'Ms.', 'ARZUM', 'KUZAY', '1973-01-28', 'F', '0650350911', 'akuzay@hotmail.com', 'Koh lanta, Krabi ', '+90 532 5496269', '', 'Heel', 'Pain reduction, Improve ROM', '', 'Ankle/Foot', '2 times/week', '2-4 weeks', '', '', '', 'Thyroid operation ', 1, 1, '2025-11-10 11:02:32', NULL),
(67, 'ทดสอบ', 'PT20251111190011532', 'ทดสอบ1', ' ', 'Mr.', 'ณัฐนัย', 'ทดสอบ', '2025-11-11', 'M', '0954385392', 'natthanai2341@gmail.com', '', '', '', 'ทดสอบ', 'Pain reduction', '', '', '', '', '', '', '', '', 1, 1, '2025-11-11 12:00:11', NULL),
(68, 'PT25067', 'PT20251112105157715', 'Thai01', '', 'Mr.', 'ทศพล', 'กุลสถาพร', '1897-09-09', 'M', '801438858', 'info@lantavafix.com', 'เกาะลันตาใหญ่', '', '', 'Hip pain', 'Pain reduction, Improve ROM, Strengthen muscles', '', 'Lower Back', '2 times/week', '1-2 weeks', '', '', '', 'Thyroid toxicosis', 1, 1, '2025-11-12 03:51:57', NULL),
(69, 'PT25067', 'PT20251112151840376', '191990279522', '', 'Mr.', 'ธีรศักดิ์', 'ฮะยีตำมะลัง', '2000-10-24', 'M', '0822474284', '', '', '', '', 'Knee accident', 'Pain reduction, Improve ROM', '', 'Knee', '2 times/week', '2-4 weeks', '', '', '', 'no', 1, 1, '2025-11-12 08:18:40', NULL),
(70, 'PT25068', 'PT20251113102739276', '21CK94280', '', 'Mr.', 'FORCUE', 'PABLO', '1999-01-01', 'M', '-', 'pablo.f6531@gmail.com', 'Koh Lanta', '-', '', 'Muay thai elbow pain', 'Pain reduction, Improve ROM', '', 'Elbow', 'As needed', '1-2 weeks', '', '', '', '-', 1, 1, '2025-11-13 03:27:39', NULL),
(71, 'ทดสอบ2', 'PT20251113112946820', '8888', '', '', 'ทดสอบ', ' กหหห', '2025-11-13', 'M', '', '', '', '', '', 'ทดสวอบ', 'Pain reduction', '', '', '', '', '', '', '', '', 1, 1, '2025-11-13 04:29:46', NULL);

--
-- Triggers `patients`
--
DELIMITER $$
CREATE TRIGGER `before_patient_delete` BEFORE DELETE ON `patients` FOR EACH ROW BEGIN
    -- Log the deletion (if audit_logs table exists)
    DECLARE audit_table_exists INT;

    SELECT COUNT(*) INTO audit_table_exists
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs';

    IF audit_table_exists > 0 THEN
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, created_at)
        VALUES (
            @current_user_id,
            'DELETE',
            'patient',
            OLD.id,
            JSON_OBJECT(
                'hn', OLD.hn,
                'pt_number', OLD.pt_number,
                'name', CONCAT(OLD.first_name, ' ', OLD.last_name),
                'clinic_id', OLD.clinic_id
            ),
            NOW()
        );
    END IF;
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `pn_attachments`
--

CREATE TABLE `pn_attachments` (
  `id` int(11) NOT NULL,
  `pn_id` int(11) NOT NULL COMMENT 'Foreign key to pn_cases',
  `file_name` varchar(255) NOT NULL COMMENT 'Original file name',
  `file_path` varchar(500) NOT NULL COMMENT 'Storage path',
  `file_type` varchar(100) DEFAULT NULL COMMENT 'MIME type',
  `file_size` int(11) DEFAULT NULL COMMENT 'File size in bytes',
  `description` text DEFAULT NULL COMMENT 'File description',
  `uploaded_by` int(11) NOT NULL COMMENT 'User who uploaded',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Attachments for PN cases';

-- --------------------------------------------------------

--
-- Table structure for table `pn_cases`
--

CREATE TABLE `pn_cases` (
  `id` int(11) NOT NULL,
  `pn_code` varchar(50) NOT NULL,
  `patient_id` int(11) NOT NULL,
  `diagnosis` text NOT NULL,
  `purpose` text NOT NULL,
  `status` enum('PENDING','ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `source_clinic_id` int(11) NOT NULL,
  `target_clinic_id` int(11) NOT NULL,
  `referring_doctor` varchar(200) DEFAULT NULL,
  `assigned_pt_id` int(11) DEFAULT NULL,
  `course_id` int(11) DEFAULT NULL COMMENT 'Links to course for course cutting',
  `notes` text DEFAULT NULL,
  `current_medications` text DEFAULT NULL,
  `allergies` text DEFAULT NULL,
  `pn_precautions` text DEFAULT NULL,
  `pn_contraindications` text DEFAULT NULL,
  `treatment_goals` text DEFAULT NULL,
  `expected_outcomes` text DEFAULT NULL,
  `medical_notes` text DEFAULT NULL,
  `vital_signs` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`vital_signs`)),
  `pain_scale` int(11) DEFAULT NULL,
  `functional_status` text DEFAULT NULL,
  `physio_diagnosis` text DEFAULT NULL,
  `chief_complaint` text DEFAULT NULL,
  `present_history` text DEFAULT NULL,
  `initial_pain_scale` int(11) DEFAULT NULL,
  `assessed_by` int(11) DEFAULT NULL,
  `assessed_at` timestamp NULL DEFAULT NULL,
  `reversal_reason` text DEFAULT NULL,
  `accepted_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `cancelled_at` timestamp NULL DEFAULT NULL,
  `cancellation_reason` text DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `pt_diagnosis` text DEFAULT NULL COMMENT 'Physiotherapy diagnosis for non-CL001 cases',
  `pt_chief_complaint` text DEFAULT NULL COMMENT 'Chief complaint for non-CL001 cases',
  `pt_present_history` text DEFAULT NULL COMMENT 'Present history for non-CL001 cases',
  `pt_pain_score` int(11) DEFAULT NULL COMMENT 'Pain score 0-10 for non-CL001 cases',
  `is_reversed` tinyint(1) DEFAULT 0,
  `last_reversal_reason` text DEFAULT NULL,
  `last_reversed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `pn_cases`
--

INSERT INTO `pn_cases` (`id`, `pn_code`, `patient_id`, `diagnosis`, `purpose`, `status`, `source_clinic_id`, `target_clinic_id`, `referring_doctor`, `assigned_pt_id`, `course_id`, `notes`, `current_medications`, `allergies`, `pn_precautions`, `pn_contraindications`, `treatment_goals`, `expected_outcomes`, `medical_notes`, `vital_signs`, `pain_scale`, `functional_status`, `physio_diagnosis`, `chief_complaint`, `present_history`, `initial_pain_scale`, `assessed_by`, `assessed_at`, `reversal_reason`, `accepted_at`, `completed_at`, `cancelled_at`, `cancellation_reason`, `created_by`, `created_at`, `updated_at`, `pt_diagnosis`, `pt_chief_complaint`, `pt_present_history`, `pt_pain_score`, `is_reversed`, `last_reversal_reason`, `last_reversed_at`) VALUES
(59, 'PN-20251107154412-2743', 61, 'Lt.lower back pain', 'Reduce pain and increase ROM', 'COMPLETED', 1, 1, NULL, NULL, NULL, '-', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-07 08:45:05', '2025-11-07 09:00:40', NULL, NULL, 1, '2025-11-07 08:44:12', '2025-11-07 09:00:40', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(60, 'PN-20251107160245-6282', 47, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-11', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-08 05:29:54', 'cancle', 1, '2025-11-07 09:02:45', '2025-11-08 05:29:54', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(61, 'PN-20251108121854-0111', 62, 'มีอาการชาปวดร้าวไปถึงปลาย ขาทั้ง 2 ข้าง ในท่าหดกล้ามเนื้อ', 'ลดอาการร้าวขาทั้ง 2 ข้าว', 'COMPLETED', 1, 1, NULL, NULL, NULL, NULL, '', '', '', '', 'Reduce pain and numbness', '', '', NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-08 05:28:12', '2025-11-08 10:58:19', NULL, NULL, 1, '2025-11-08 05:18:54', '2025-11-08 10:58:19', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(62, 'PN-20251108123031-2143', 47, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-11', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-08 11:40:21', 'Cancle', 1, '2025-11-08 05:30:31', '2025-11-08 11:40:21', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(63, 'PN-20251108125945-3496', 18, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-08', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-08 08:39:58', NULL, '2025-11-08 08:44:47', 'Change person ', 1, '2025-11-08 05:59:45', '2025-11-08 08:44:47', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(64, 'PN-20251108130620-5940', 57, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-08', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-08 06:08:02', 'wrong', 1, '2025-11-08 06:06:20', '2025-11-08 06:08:02', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(65, 'PN-20251108130842-4763', 57, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-08', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-08 06:42:28', 'Wrong person', 1, '2025-11-08 06:08:42', '2025-11-08 06:42:28', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(66, 'PN-20251108134253-4492', 59, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-08', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-08 07:43:50', 'Wrong person', 1, '2025-11-08 06:42:53', '2025-11-08 07:43:50', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(67, 'PN-20251108154341-8820', 63, 'Rt.SI joint dysfuction', 'reduce pain', 'COMPLETED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-08 08:45:17', '2025-11-08 10:56:44', NULL, NULL, 1, '2025-11-08 08:43:41', '2025-11-08 10:56:44', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(68, 'PN-20251108223325-6585', 47, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-11', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 06:09:35', '2025-11-11 13:03:30', NULL, NULL, 1, '2025-11-08 15:33:25', '2025-11-11 13:03:30', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(69, 'PN-20251110090856-1380', 47, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-12', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 06:38:03', '2025-11-12 08:32:07', NULL, NULL, 1, '2025-11-10 02:08:56', '2025-11-12 08:32:07', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(70, 'PN-20251110093532-7708', 64, 'Hip stiffness', 'Improve eange of motion and reduce pain', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-10 02:39:13', 'ca', 1, '2025-11-10 02:35:32', '2025-11-10 02:39:13', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(71, 'PN-20251110094017-3751', 64, 'Hip stiffness', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-10', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-10 04:17:20', '2025-11-10 08:29:09', NULL, NULL, 1, '2025-11-10 02:40:17', '2025-11-10 08:29:09', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(72, 'PN-20251110112834-7085', 65, 'neck stiffness', 'improve range of motion', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-10 04:29:15', 'ca', 1, '2025-11-10 04:28:34', '2025-11-10 04:29:15', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(73, 'PN-20251110112947-6170', 65, 'neck stiffness', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-10', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-10 08:29:26', '2025-11-10 08:35:30', NULL, NULL, 1, '2025-11-10 04:29:47', '2025-11-10 08:35:30', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(74, 'PN-20251110135608-8429', 11, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-10', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-10 08:53:00', '2025-11-10 09:39:38', NULL, NULL, 1, '2025-11-10 06:56:08', '2025-11-10 09:39:38', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(75, 'PN-20251110160648-6726', 44, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-11', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 12:58:52', '2025-11-11 13:38:34', NULL, NULL, 1, '2025-11-10 09:06:48', '2025-11-11 13:38:34', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(76, 'PN-20251110180254-7715', 66, 'Heel', 'Reduce pain', 'COMPLETED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-10 11:03:43', '2025-11-11 02:41:47', NULL, NULL, 1, '2025-11-10 11:02:54', '2025-11-11 02:41:47', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(77, 'PN-20251111132534-3838', 64, 'Hip stiffness', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-11', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 08:29:40', '2025-11-11 13:07:55', NULL, NULL, 1, '2025-11-11 06:25:34', '2025-11-11 13:07:55', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(78, 'PN-20251111151730-7906', 4, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 08:18:57', 'ก', 1, '2025-11-11 08:17:30', '2025-11-11 08:18:57', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(79, 'PN-20251111151933-8308', 4, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 08:19:58', 'ก', 1, '2025-11-11 08:19:33', '2025-11-11 08:19:58', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(80, 'PN-20251111172749-0802', 66, 'Heel', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-12', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 07:47:22', 'ca', 1, '2025-11-11 10:27:49', '2025-11-12 07:47:22', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(81, 'PN-20251111185556-9485', 4, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 12:00:25', 'ทดสอบ', 1, '2025-11-11 11:55:56', '2025-11-11 12:00:25', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(82, 'PN-20251111190052-2991', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 12:02:01', 'ทดสอย', 1, '2025-11-11 12:00:52', '2025-11-11 12:02:01', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(83, 'PN-20251111190241-9780', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-15', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 12:09:16', 'ds', 1, '2025-11-11 12:02:41', '2025-11-11 12:09:16', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(84, 'PN-20251111190959-0155', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 12:16:00', 'ทดสอบ ', 1, '2025-11-11 12:09:59', '2025-11-11 12:16:00', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(85, 'PN-20251111191636-0313', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 12:17:19', 'Cancelled from appointment', 1, '2025-11-11 12:16:36', '2025-11-11 12:17:19', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(86, 'PN-20251111191820-0858', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 12:26:18', 'กแ', 1, '2025-11-11 12:18:20', '2025-11-11 12:26:18', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(87, 'PN-20251111192637-3094', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 12:35:16', 'ca', 1, '2025-11-11 12:26:37', '2025-11-11 12:35:16', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(88, 'PN-20251111193541-1629', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-15', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 13:11:21', 'CA', 1, '2025-11-11 12:35:41', '2025-11-11 13:11:21', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(89, 'PN-20251111203153-9482', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 13:38:17', 'ca', 1, '2025-11-11 13:31:53', '2025-11-11 13:38:17', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(90, 'PN-20251111203956-1696', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-15', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 13:56:20', 'ca', 1, '2025-11-11 13:39:56', '2025-11-11 13:56:20', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(91, 'PN-20251111205659-4157', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-16', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 14:04:51', 'ca', 1, '2025-11-11 13:56:59', '2025-11-11 14:04:51', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(92, 'PN-20251111210518-7035', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 16:05:53', 'ca', 1, '2025-11-11 14:05:18', '2025-11-11 16:05:53', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(93, 'PN-20251111220135-0910', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-15', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 16:05:49', 'c', 1, '2025-11-11 15:01:35', '2025-11-11 16:05:49', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(94, 'PN-20251111225218-2653', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-19', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 03:39:44', 'ca', 1, '2025-11-11 15:52:18', '2025-11-12 03:39:44', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(95, 'PN-20251111225708-3691', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-19', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 03:39:39', 'ca', 1, '2025-11-11 15:57:08', '2025-11-12 03:39:39', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(96, 'PN-20251111230631-1693', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 16:07:55', 'แฟ', 1, '2025-11-11 16:06:31', '2025-11-11 16:07:55', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(97, 'PN-20251111230815-9272', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 16:28:10', 'Cancelled from appointment', 1, '2025-11-11 16:08:15', '2025-11-11 16:28:10', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(98, 'PN-20251111231949-0245', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 16:28:14', 'Cancelled from appointment', 1, '2025-11-11 16:19:49', '2025-11-11 16:28:14', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(99, 'PN-20251111232833-0538', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-12', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 16:34:29', 'ca', 1, '2025-11-11 16:28:33', '2025-11-11 16:34:29', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(100, 'PN-20251111233448-5986', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 16:42:55', 'Cancelled from appointment', 1, '2025-11-11 16:34:48', '2025-11-11 16:42:55', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(101, 'PN-20251111234327-6928', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-11 16:50:52', 'ca', 1, '2025-11-11 16:43:27', '2025-11-11 16:50:52', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(102, 'PN-20251111235110-1464', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-18', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 03:39:36', 'ca', 1, '2025-11-11 16:51:10', '2025-11-12 03:39:36', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(103, 'PN-20251112084523-7888', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 01:46:40', 'CA', 1, '2025-11-12 01:45:23', '2025-11-12 01:46:40', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(104, 'PN-20251112104012-1149', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-12', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 03:44:32', 'ca', 1, '2025-11-12 03:40:12', '2025-11-12 03:44:32', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(105, 'PN-20251112105209-2625', 68, 'Hip pain', 'Pain reduce', 'COMPLETED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 03:52:47', '2025-11-12 08:47:33', NULL, NULL, 1, '2025-11-12 03:52:09', '2025-11-12 08:47:33', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(106, 'PN-20251112143451-5205', 66, 'Heel', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-12', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 12:32:20', '2025-11-12 12:37:47', NULL, NULL, 1, '2025-11-12 07:34:51', '2025-11-12 12:37:47', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(107, 'PN-20251112143617-2655', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-12', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 07:42:24', 'ca', 1, '2025-11-12 07:36:17', '2025-11-12 07:42:24', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(108, 'PN-20251112150844-4854', 47, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 08:23:07', 'ca', 1, '2025-11-12 08:08:44', '2025-11-12 08:23:07', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(109, 'PN-20251112151854-8666', 69, 'Knee accident', 'Reduce pain', 'COMPLETED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 08:19:44', '2025-11-12 08:45:30', NULL, NULL, 1, '2025-11-12 08:18:54', '2025-11-12 08:45:30', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(110, 'PN-20251112152330-9617', 47, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'PENDING', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-14', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2025-11-12 08:23:30', '2025-11-12 09:00:17', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(111, 'PN-20251112154621-5531', 47, 'Pain relief', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-12', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-12 08:47:11', NULL, '2025-11-12 08:47:21', 'ca', 1, '2025-11-12 08:46:21', '2025-11-12 08:47:21', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(112, 'PN-20251112175227-9357', 69, 'Knee accident', 'Physiotherapy treatment from appointment booking', 'PENDING', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-15', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2025-11-12 10:52:27', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL),
(113, 'PN-20251113101428-6213', 65, 'neck stiffness', 'Physiotherapy treatment from appointment booking', 'COMPLETED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 06:03:10', '2025-11-13 08:24:42', NULL, NULL, 1, '2025-11-13 03:14:28', '2025-11-13 08:24:42', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(114, 'PN-20251113102754-0557', 70, 'Muay thai elbow pain', 'Improve range of motion , relief pain', 'COMPLETED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 03:28:33', '2025-11-13 05:45:32', NULL, NULL, 1, '2025-11-13 03:27:54', '2025-11-13 05:45:32', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(115, 'PN-20251113112953-1273', 71, 'ทดสวอบ', 'ก', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 04:30:56', 'ca', 1, '2025-11-13 04:29:53', '2025-11-13 04:30:56', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(116, 'PN-20251113113259-5016', 71, 'ทดสวอบ', 'ทดสอบ', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 04:34:22', 'ca', 1, '2025-11-13 04:32:59', '2025-11-13 04:34:22', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(117, 'PN-20251113114629-6745', 71, 'ทดสวอบ', 'Popupcheck ', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 04:53:20', 'ca', 1, '2025-11-13 04:46:29', '2025-11-13 04:53:20', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(118, 'PN-20251113115341-4662', 71, 'ทดสวอบ', 'ทดสอบ', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 04:56:17', 'ca', 1, '2025-11-13 04:53:41', '2025-11-13 04:56:17', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(119, 'PN-20251113115644-9509', 71, 'ทดสวอบ', 'ทดสอบ', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 04:57:05', NULL, '2025-11-13 05:05:11', 'ca', 1, '2025-11-13 04:56:44', '2025-11-13 05:05:11', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(120, 'PN-20251113121057-0863', 71, 'ทดสวอบ', 'ทดสอบ', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 05:12:22', 'แฟ', 1, '2025-11-13 05:10:57', '2025-11-13 05:12:22', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(121, 'PN-20251113122402-0175', 71, 'ทดสวอบ', 'ทด', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 05:28:58', 'ca', 1, '2025-11-13 05:24:02', '2025-11-13 05:28:58', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(122, 'PN-20251113122801-7793', 67, 'ทดสอบ', 'Physiotherapy treatment from appointment booking', 'CANCELLED', 1, 1, NULL, NULL, NULL, 'Auto-created from appointment on 2025-11-13', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 05:28:25', NULL, '2025-11-13 05:28:39', 'แฟ', 1, '2025-11-13 05:28:01', '2025-11-13 05:28:39', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(123, 'PN-20251113123701-9364', 71, 'ทดสวอบ', 'ทดสอบ', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 05:37:55', NULL, '2025-11-13 05:38:12', 'ca', 1, '2025-11-13 05:37:01', '2025-11-13 05:38:12', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(124, 'PN-20251113124606-9258', 71, 'ทดสวอบ', 'ทสดอบ', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 05:58:48', 'ca', 1, '2025-11-13 05:46:06', '2025-11-13 05:58:48', NULL, NULL, NULL, NULL, 0, NULL, NULL),
(125, 'PN-20251113125921-4775', 71, 'ทดสวอบ', 'c', 'CANCELLED', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-13 05:59:52', NULL, '2025-11-13 06:00:04', 'ca', 1, '2025-11-13 05:59:21', '2025-11-13 06:00:04', NULL, NULL, NULL, NULL, 0, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `pn_reports`
--

CREATE TABLE `pn_reports` (
  `id` int(11) NOT NULL,
  `visit_id` int(11) NOT NULL,
  `report_type` enum('INITIAL','PROGRESS','DISCHARGE','SUMMARY') NOT NULL DEFAULT 'PROGRESS',
  `file_path` varchar(500) DEFAULT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `qr_code` text DEFAULT NULL,
  `report_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`report_data`)),
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `pn_soap_notes`
--

CREATE TABLE `pn_soap_notes` (
  `id` int(11) NOT NULL,
  `pn_id` int(11) NOT NULL COMMENT 'Foreign key to pn_cases',
  `subjective` text DEFAULT NULL COMMENT 'Subjective - Patient complaints, symptoms',
  `objective` text DEFAULT NULL COMMENT 'Objective - Observations, measurements',
  `assessment` text DEFAULT NULL COMMENT 'Assessment - Clinical impression, diagnosis',
  `plan` text DEFAULT NULL COMMENT 'Plan - Treatment plan, goals',
  `timestamp` datetime NOT NULL DEFAULT current_timestamp() COMMENT 'When SOAP note was created',
  `notes` text DEFAULT NULL COMMENT 'Additional notes',
  `created_by` int(11) NOT NULL COMMENT 'User who created SOAP note',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SOAP notes for PN cases';

-- --------------------------------------------------------

--
-- Table structure for table `pn_status_history`
--

CREATE TABLE `pn_status_history` (
  `id` int(11) NOT NULL,
  `pn_id` int(11) NOT NULL,
  `old_status` enum('PENDING','ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL,
  `new_status` enum('PENDING','ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL,
  `changed_by` int(11) NOT NULL,
  `change_reason` text DEFAULT NULL,
  `is_reversal` tinyint(1) DEFAULT 0 COMMENT 'TRUE if this was a status reversal',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='History of PN case status changes';

-- --------------------------------------------------------

--
-- Table structure for table `pn_visits`
--

CREATE TABLE `pn_visits` (
  `id` int(11) NOT NULL,
  `pn_id` int(11) NOT NULL,
  `visit_no` int(11) NOT NULL,
  `visit_date` date NOT NULL,
  `visit_time` time DEFAULT NULL,
  `status` enum('SCHEDULED','COMPLETED','CANCELLED','NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
  `chief_complaint` text DEFAULT NULL,
  `subjective` text DEFAULT NULL,
  `objective` text DEFAULT NULL,
  `assessment` text DEFAULT NULL,
  `plan` text DEFAULT NULL,
  `treatment_provided` text DEFAULT NULL,
  `therapist_id` int(11) DEFAULT NULL,
  `duration_minutes` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `pt_certificates`
--

CREATE TABLE `pt_certificates` (
  `id` int(11) NOT NULL,
  `pn_id` int(11) NOT NULL,
  `certificate_type` enum('thai','english') NOT NULL DEFAULT 'thai',
  `certificate_data` text NOT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `public_booking_settings`
--

CREATE TABLE `public_booking_settings` (
  `id` int(11) NOT NULL,
  `clinic_id` int(11) NOT NULL,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `setting_type` enum('TEXT','JSON','BOOLEAN','NUMBER') NOT NULL DEFAULT 'TEXT',
  `updated_by` int(11) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `public_promotions`
--

CREATE TABLE `public_promotions` (
  `id` int(11) NOT NULL,
  `promo_code` varchar(50) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `discount_type` enum('PERCENTAGE','FIXED_AMOUNT') NOT NULL DEFAULT 'PERCENTAGE',
  `discount_value` decimal(10,2) NOT NULL,
  `min_purchase` decimal(10,2) DEFAULT NULL,
  `max_discount` decimal(10,2) DEFAULT NULL,
  `valid_from` date NOT NULL,
  `valid_until` date NOT NULL,
  `usage_limit` int(11) DEFAULT NULL COMMENT 'Total usage limit',
  `usage_count` int(11) DEFAULT 0,
  `active` tinyint(1) DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `public_service_packages`
--

CREATE TABLE `public_service_packages` (
  `id` int(11) NOT NULL,
  `service_id` int(11) DEFAULT NULL COMMENT 'Link to services table, NULL for custom packages',
  `package_name` varchar(200) NOT NULL,
  `package_code` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `duration_minutes` int(11) NOT NULL DEFAULT 60,
  `benefits` text DEFAULT NULL COMMENT 'JSON array of benefits',
  `pain_zones` varchar(500) DEFAULT NULL COMMENT 'Comma-separated pain zones this helps',
  `is_featured` tinyint(1) DEFAULT 0 COMMENT 'Show as "Most Popular"',
  `is_best_value` tinyint(1) DEFAULT 0 COMMENT 'Show as "Best Value"',
  `image_url` varchar(500) DEFAULT NULL,
  `display_order` int(11) DEFAULT 0,
  `active` tinyint(1) DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `public_testimonials`
--

CREATE TABLE `public_testimonials` (
  `id` int(11) NOT NULL,
  `patient_name` varchar(200) NOT NULL,
  `service_package_id` int(11) DEFAULT NULL,
  `rating` int(1) NOT NULL DEFAULT 5 COMMENT '1-5 stars',
  `testimonial_text` text NOT NULL,
  `display_on_public` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `services`
--

CREATE TABLE `services` (
  `id` int(11) NOT NULL,
  `service_code` varchar(50) NOT NULL,
  `service_name` varchar(200) NOT NULL,
  `service_description` text DEFAULT NULL,
  `default_price` decimal(10,2) NOT NULL,
  `service_type` varchar(100) DEFAULT 'PHYSIOTHERAPY',
  `active` tinyint(1) DEFAULT 1 COMMENT 'Global service active status',
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `system_settings`
--

CREATE TABLE `system_settings` (
  `id` int(11) NOT NULL,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `settings` text DEFAULT NULL COMMENT 'For JSON settings storage',
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `updated_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='System-wide settings including document customization';

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('ADMIN','CLINIC','PT') NOT NULL DEFAULT 'PT',
  `clinic_id` int(11) DEFAULT NULL,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `license_number` varchar(50) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `active` tinyint(1) DEFAULT 1,
  `last_login` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `email`, `password_hash`, `role`, `clinic_id`, `first_name`, `last_name`, `license_number`, `phone`, `active`, `last_login`, `created_at`, `updated_at`) VALUES
(1, 'admin@lantavafix.com', '$2a$10$1CnAowBeg3HR0BhEqQAzzuOlCP/6679p/dmprIQjYlBazlQcrRWSi', 'ADMIN', 1, 'System', 'Administrator', NULL, '099-999-9999', 1, '2025-11-13 14:55:43', '2025-10-30 13:06:38', '2025-11-13 14:55:43'),
(2, 'clinic1@pn-app.com', '$2b$10$YourHashedPasswordHere', 'CLINIC', 1, 'Clinic', 'Manager 1', NULL, '099-111-1111', 1, NULL, '2025-10-30 13:06:38', NULL),
(3, 'clinic2@pn-app.com', '$2b$10$ZrCsju4DE/2srmEwjnwHPOjylmTjm3osySJRM7Tj0lULc1BKd2Xvq', 'CLINIC', 2, 'Clinic', 'Manager 2', '', '099-222-2222', 1, '2025-11-03 07:29:07', '2025-10-30 13:06:38', '2025-11-03 07:29:07'),
(4, 'suttida.cho@gmail.com', '$2b$10$UpHWK2vwojl34p7spGgnDORbgolORusHl1FFihLlhyt.U7TkRFZWC', 'PT', 1, 'Suttida', 'Chooluan', 'PT14418', '0954385392', 1, '2025-11-08 05:52:10', '2025-10-30 13:06:38', '2025-11-08 05:52:10'),
(5, 'pt2@pn-app.com', '$2b$10$Vg5UV2HuJdMCFDliHDwoxOIxY8W5CIYnKT0tGjY5c/D9LNi22XpMO', 'PT', 1, 'Jane', 'Senior PT', 'PT54321', '099-444-4444', 1, '2025-11-08 03:41:08', '2025-10-30 13:06:38', '2025-11-08 03:41:08'),
(6, 'natthanai2341@gmail.com', '$2b$10$is0QY0J/Q7MUMqAPzXIUCONJV5aZIVaz0Ba2En6YVrMZYoPElUdOK', 'CLINIC', 3, 'John', 'Doe', '', '', 1, '2025-11-08 03:50:54', '2025-10-31 07:52:02', '2025-11-08 03:50:54');

-- --------------------------------------------------------

--
-- Table structure for table `user_clinic_grants`
--

CREATE TABLE `user_clinic_grants` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `clinic_id` int(11) NOT NULL,
  `granted_by` int(11) NOT NULL,
  `granted_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `user_clinic_grants`
--

INSERT INTO `user_clinic_grants` (`id`, `user_id`, `clinic_id`, `granted_by`, `granted_at`) VALUES
(1, 4, 2, 1, '2025-10-30 13:06:38'),
(2, 4, 3, 1, '2025-10-30 13:06:38'),
(3, 5, 2, 1, '2025-10-30 13:06:38'),
(4, 4, 1, 1, '2025-11-08 02:49:42');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `appointments`
--
ALTER TABLE `appointments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_appointment_patient` (`patient_id`),
  ADD KEY `idx_appointment_clinic` (`clinic_id`),
  ADD KEY `idx_appointment_pt` (`pt_id`),
  ADD KEY `idx_appointment_date` (`appointment_date`),
  ADD KEY `idx_appointment_status` (`status`),
  ADD KEY `idx_appointment_pn` (`pn_case_id`),
  ADD KEY `idx_appointment_course` (`course_id`),
  ADD KEY `cancelled_by` (`cancelled_by`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `idx_appointment_datetime` (`appointment_date`,`start_time`),
  ADD KEY `idx_appointment_pn_id` (`pn_id`),
  ADD KEY `idx_appointments_client_ip` (`client_ip_address`),
  ADD KEY `idx_calendar_event_id` (`calendar_event_id`);

--
-- Indexes for table `audit_logs`
--
ALTER TABLE `audit_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audit_user` (`user_id`),
  ADD KEY `idx_audit_entity` (`entity_type`,`entity_id`),
  ADD KEY `idx_audit_action` (`action`),
  ADD KEY `idx_audit_created` (`created_at`);

--
-- Indexes for table `bills`
--
ALTER TABLE `bills`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `bill_code` (`bill_code`),
  ADD KEY `idx_bill_patient` (`patient_id`),
  ADD KEY `idx_bill_clinic` (`clinic_id`),
  ADD KEY `idx_bill_date` (`bill_date`),
  ADD KEY `idx_bill_status` (`payment_status`),
  ADD KEY `idx_bill_appointment` (`appointment_id`),
  ADD KEY `idx_bill_course` (`course_id`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `idx_bills_pn_case_id` (`pn_case_id`);

--
-- Indexes for table `bill_items`
--
ALTER TABLE `bill_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_bill_item_bill` (`bill_id`),
  ADD KEY `idx_bill_item_service` (`service_id`);

--
-- Indexes for table `certificate_settings`
--
ALTER TABLE `certificate_settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_clinic` (`clinic_id`);

--
-- Indexes for table `clinics`
--
ALTER TABLE `clinics`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`),
  ADD KEY `idx_clinic_active` (`active`),
  ADD KEY `idx_clinic_code` (`code`);

--
-- Indexes for table `clinic_service_pricing`
--
ALTER TABLE `clinic_service_pricing`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_clinic_service` (`clinic_id`,`service_id`),
  ADD KEY `idx_clinic_service` (`clinic_id`),
  ADD KEY `idx_service_clinic` (`service_id`),
  ADD KEY `updated_by` (`updated_by`);

--
-- Indexes for table `courses`
--
ALTER TABLE `courses`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `course_code` (`course_code`),
  ADD KEY `idx_course_patient` (`patient_id`),
  ADD KEY `idx_course_clinic` (`clinic_id`),
  ADD KEY `idx_course_status` (`status`),
  ADD KEY `idx_course_code` (`course_code`),
  ADD KEY `fk_course_creator` (`created_by`);

--
-- Indexes for table `course_templates`
--
ALTER TABLE `course_templates`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_template_active` (`active`),
  ADD KEY `fk_template_creator` (`created_by`);

--
-- Indexes for table `course_usage_history`
--
ALTER TABLE `course_usage_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_usage_course` (`course_id`),
  ADD KEY `idx_usage_pn` (`pn_id`),
  ADD KEY `idx_usage_date` (`usage_date`),
  ADD KEY `fk_usage_creator` (`created_by`);

--
-- Indexes for table `gift_cards`
--
ALTER TABLE `gift_cards`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `gift_card_code` (`gift_card_code`),
  ADD KEY `member_id` (`member_id`),
  ADD KEY `redeemed_by_user` (`redeemed_by_user`),
  ADD KEY `bill_id_used` (`bill_id_used`),
  ADD KEY `idx_code` (`gift_card_code`),
  ADD KEY `idx_status` (`status`);

--
-- Indexes for table `gift_card_catalog`
--
ALTER TABLE `gift_card_catalog`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `loyalty_members`
--
ALTER TABLE `loyalty_members`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `patient_id` (`patient_id`);

--
-- Indexes for table `loyalty_tier_rules`
--
ALTER TABLE `loyalty_tier_rules`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `tier` (`tier`);

--
-- Indexes for table `loyalty_transactions`
--
ALTER TABLE `loyalty_transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `bill_id` (`bill_id`),
  ADD KEY `performed_by` (`performed_by`),
  ADD KEY `idx_member_date` (`member_id`,`transaction_date`);

--
-- Indexes for table `notification_settings`
--
ALTER TABLE `notification_settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_setting_type` (`setting_type`),
  ADD KEY `idx_setting_type` (`setting_type`);

--
-- Indexes for table `patients`
--
ALTER TABLE `patients`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `pt_number` (`pt_number`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `idx_patient_hn` (`hn`),
  ADD KEY `idx_patient_pt_number` (`pt_number`),
  ADD KEY `idx_patient_pid` (`pid`),
  ADD KEY `idx_patient_name` (`first_name`,`last_name`),
  ADD KEY `idx_patient_clinic` (`clinic_id`);

--
-- Indexes for table `pn_attachments`
--
ALTER TABLE `pn_attachments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_attachment_pn` (`pn_id`),
  ADD KEY `uploaded_by` (`uploaded_by`);

--
-- Indexes for table `pn_cases`
--
ALTER TABLE `pn_cases`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `pn_code` (`pn_code`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `idx_pn_code` (`pn_code`),
  ADD KEY `idx_pn_patient` (`patient_id`),
  ADD KEY `idx_pn_status` (`status`),
  ADD KEY `idx_pn_source_clinic` (`source_clinic_id`),
  ADD KEY `idx_pn_target_clinic` (`target_clinic_id`),
  ADD KEY `idx_pn_created_at` (`created_at`),
  ADD KEY `idx_pn_assigned_pt` (`assigned_pt_id`),
  ADD KEY `idx_pn_assessed_by` (`assessed_by`),
  ADD KEY `idx_pn_assessed_at` (`assessed_at`),
  ADD KEY `idx_pn_course` (`course_id`);

--
-- Indexes for table `pn_reports`
--
ALTER TABLE `pn_reports`
  ADD PRIMARY KEY (`id`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `idx_report_visit` (`visit_id`),
  ADD KEY `idx_report_type` (`report_type`),
  ADD KEY `idx_report_created_at` (`created_at`);

--
-- Indexes for table `pn_soap_notes`
--
ALTER TABLE `pn_soap_notes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_soap_pn` (`pn_id`),
  ADD KEY `idx_soap_timestamp` (`timestamp`),
  ADD KEY `created_by` (`created_by`);

--
-- Indexes for table `pn_status_history`
--
ALTER TABLE `pn_status_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_status_history_pn` (`pn_id`),
  ADD KEY `changed_by` (`changed_by`);

--
-- Indexes for table `pn_visits`
--
ALTER TABLE `pn_visits`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_pn_visit_no` (`pn_id`,`visit_no`),
  ADD KEY `therapist_id` (`therapist_id`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `idx_visit_pn` (`pn_id`),
  ADD KEY `idx_visit_date` (`visit_date`),
  ADD KEY `idx_visit_status` (`status`);

--
-- Indexes for table `pt_certificates`
--
ALTER TABLE `pt_certificates`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_pn_id` (`pn_id`),
  ADD KEY `idx_created_by` (`created_by`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Indexes for table `public_booking_settings`
--
ALTER TABLE `public_booking_settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `clinic_setting` (`clinic_id`,`setting_key`),
  ADD KEY `fk_booking_settings_updater` (`updated_by`);

--
-- Indexes for table `public_promotions`
--
ALTER TABLE `public_promotions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `promo_code` (`promo_code`),
  ADD KEY `active` (`active`),
  ADD KEY `fk_promotion_creator` (`created_by`);

--
-- Indexes for table `public_service_packages`
--
ALTER TABLE `public_service_packages`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `package_code` (`package_code`),
  ADD KEY `service_id` (`service_id`),
  ADD KEY `active` (`active`),
  ADD KEY `fk_public_package_creator` (`created_by`);

--
-- Indexes for table `public_testimonials`
--
ALTER TABLE `public_testimonials`
  ADD PRIMARY KEY (`id`),
  ADD KEY `service_package_id` (`service_package_id`),
  ADD KEY `display_on_public` (`display_on_public`),
  ADD KEY `fk_testimonial_creator` (`created_by`);

--
-- Indexes for table `services`
--
ALTER TABLE `services`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `service_code` (`service_code`),
  ADD KEY `idx_service_type` (`service_type`),
  ADD KEY `idx_service_active` (`active`),
  ADD KEY `created_by` (`created_by`);

--
-- Indexes for table `system_settings`
--
ALTER TABLE `system_settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_setting_key` (`setting_key`),
  ADD KEY `idx_updated_by` (`updated_by`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `idx_user_email` (`email`),
  ADD KEY `idx_user_role` (`role`),
  ADD KEY `idx_user_clinic` (`clinic_id`);

--
-- Indexes for table `user_clinic_grants`
--
ALTER TABLE `user_clinic_grants`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_user_clinic` (`user_id`,`clinic_id`),
  ADD KEY `granted_by` (`granted_by`),
  ADD KEY `idx_grant_user` (`user_id`),
  ADD KEY `idx_grant_clinic` (`clinic_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `appointments`
--
ALTER TABLE `appointments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `audit_logs`
--
ALTER TABLE `audit_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bills`
--
ALTER TABLE `bills`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bill_items`
--
ALTER TABLE `bill_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `certificate_settings`
--
ALTER TABLE `certificate_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `clinics`
--
ALTER TABLE `clinics`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `clinic_service_pricing`
--
ALTER TABLE `clinic_service_pricing`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `courses`
--
ALTER TABLE `courses`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `course_templates`
--
ALTER TABLE `course_templates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `course_usage_history`
--
ALTER TABLE `course_usage_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `gift_cards`
--
ALTER TABLE `gift_cards`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `gift_card_catalog`
--
ALTER TABLE `gift_card_catalog`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `loyalty_members`
--
ALTER TABLE `loyalty_members`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `loyalty_tier_rules`
--
ALTER TABLE `loyalty_tier_rules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `loyalty_transactions`
--
ALTER TABLE `loyalty_transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `notification_settings`
--
ALTER TABLE `notification_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `patients`
--
ALTER TABLE `patients`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=72;

--
-- AUTO_INCREMENT for table `pn_attachments`
--
ALTER TABLE `pn_attachments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pn_cases`
--
ALTER TABLE `pn_cases`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=126;

--
-- AUTO_INCREMENT for table `pn_reports`
--
ALTER TABLE `pn_reports`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pn_soap_notes`
--
ALTER TABLE `pn_soap_notes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pn_status_history`
--
ALTER TABLE `pn_status_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pn_visits`
--
ALTER TABLE `pn_visits`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pt_certificates`
--
ALTER TABLE `pt_certificates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `public_booking_settings`
--
ALTER TABLE `public_booking_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `public_promotions`
--
ALTER TABLE `public_promotions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `public_service_packages`
--
ALTER TABLE `public_service_packages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `public_testimonials`
--
ALTER TABLE `public_testimonials`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `services`
--
ALTER TABLE `services`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `system_settings`
--
ALTER TABLE `system_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `user_clinic_grants`
--
ALTER TABLE `user_clinic_grants`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `appointments`
--
ALTER TABLE `appointments`
  ADD CONSTRAINT `fk_appointment_canceller` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_appointment_clinic` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_appointment_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_appointment_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_appointment_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_appointment_pn` FOREIGN KEY (`pn_case_id`) REFERENCES `pn_cases` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_appointment_pt` FOREIGN KEY (`pt_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `bills`
--
ALTER TABLE `bills`
  ADD CONSTRAINT `fk_bill_appointment` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_bill_clinic` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_bill_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_bill_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_bill_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_bills_pn_case` FOREIGN KEY (`pn_case_id`) REFERENCES `pn_cases` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `bill_items`
--
ALTER TABLE `bill_items`
  ADD CONSTRAINT `fk_bill_item_bill` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_bill_item_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `certificate_settings`
--
ALTER TABLE `certificate_settings`
  ADD CONSTRAINT `certificate_settings_ibfk_1` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `clinic_service_pricing`
--
ALTER TABLE `clinic_service_pricing`
  ADD CONSTRAINT `fk_clinic_pricing_clinic` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_clinic_pricing_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_clinic_pricing_updater` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `courses`
--
ALTER TABLE `courses`
  ADD CONSTRAINT `fk_course_clinic` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_course_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_course_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `course_templates`
--
ALTER TABLE `course_templates`
  ADD CONSTRAINT `fk_template_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `course_usage_history`
--
ALTER TABLE `course_usage_history`
  ADD CONSTRAINT `fk_usage_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_usage_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_usage_pn` FOREIGN KEY (`pn_id`) REFERENCES `pn_cases` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `gift_cards`
--
ALTER TABLE `gift_cards`
  ADD CONSTRAINT `gift_cards_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `loyalty_members` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `gift_cards_ibfk_2` FOREIGN KEY (`redeemed_by_user`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `gift_cards_ibfk_3` FOREIGN KEY (`bill_id_used`) REFERENCES `bills` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `loyalty_members`
--
ALTER TABLE `loyalty_members`
  ADD CONSTRAINT `loyalty_members_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `loyalty_transactions`
--
ALTER TABLE `loyalty_transactions`
  ADD CONSTRAINT `loyalty_transactions_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `loyalty_members` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `loyalty_transactions_ibfk_2` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `loyalty_transactions_ibfk_3` FOREIGN KEY (`performed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `patients`
--
ALTER TABLE `patients`
  ADD CONSTRAINT `patients_ibfk_1` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `patients_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `pn_attachments`
--
ALTER TABLE `pn_attachments`
  ADD CONSTRAINT `fk_attachment_pn` FOREIGN KEY (`pn_id`) REFERENCES `pn_cases` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_attachment_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `pn_cases`
--
ALTER TABLE `pn_cases`
  ADD CONSTRAINT `fk_pn_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `pn_soap_notes`
--
ALTER TABLE `pn_soap_notes`
  ADD CONSTRAINT `fk_soap_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_soap_pn` FOREIGN KEY (`pn_id`) REFERENCES `pn_cases` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `pn_status_history`
--
ALTER TABLE `pn_status_history`
  ADD CONSTRAINT `fk_status_history_changed_by` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_status_history_pn` FOREIGN KEY (`pn_id`) REFERENCES `pn_cases` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `pt_certificates`
--
ALTER TABLE `pt_certificates`
  ADD CONSTRAINT `pt_certificates_ibfk_1` FOREIGN KEY (`pn_id`) REFERENCES `pn_cases` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `pt_certificates_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `public_booking_settings`
--
ALTER TABLE `public_booking_settings`
  ADD CONSTRAINT `fk_booking_settings_clinic` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_booking_settings_updater` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `public_promotions`
--
ALTER TABLE `public_promotions`
  ADD CONSTRAINT `fk_promotion_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `public_service_packages`
--
ALTER TABLE `public_service_packages`
  ADD CONSTRAINT `fk_public_package_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_public_package_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `public_testimonials`
--
ALTER TABLE `public_testimonials`
  ADD CONSTRAINT `fk_testimonial_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_testimonial_package` FOREIGN KEY (`service_package_id`) REFERENCES `public_service_packages` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `services`
--
ALTER TABLE `services`
  ADD CONSTRAINT `fk_service_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `system_settings`
--
ALTER TABLE `system_settings`
  ADD CONSTRAINT `fk_system_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

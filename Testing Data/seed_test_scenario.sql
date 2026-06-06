-- Seed script to populate PHARMA-CORE V3.2 with testing scenario data.
-- Run this script in your MySQL client to load mock records.

USE pharmacyManagement;

-- Disable MySQL Safe Updates Mode to clean tables
SET SQL_SAFE_UPDATES = 0;

-- 1. Clean existing records to avoid duplicate conflicts
DELETE FROM supplier_orders;
DELETE FROM orders;
DELETE FROM supplier_stock;
DELETE FROM pharmacy_medicines;
DELETE FROM pharmacies;
DELETE FROM patients;
DELETE FROM pharmacists;
DELETE FROM medicines;
DELETE FROM users WHERE userID > 2;

-- Re-enable Safe Updates Mode
SET SQL_SAFE_UPDATES = 1;

-- 2. Insert global medicine catalog with custom categories and expiry dates (Relative to May 2026)
INSERT INTO medicines (medicineID, name, used_for, general_expiry_date) VALUES
(1, 'Amoxicillin', 'Antibiotics', '2026-04-10'),      -- EXPIRED
(2, 'Ibuprofen', 'Pain Relief', '2026-06-12'),        -- EXPIRING SOON
(3, 'Paracetamol', 'Pain Relief', '2027-03-15'),      -- VALID
(4, 'Loratadine', 'Allergy Relief', '2026-06-05'),    -- EXPIRING SOON
(5, 'Metformin', 'Diabetes Control', '2028-11-20');   -- VALID

-- 3. Insert mock users (Password for all is '123': $2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK)
INSERT INTO users (userID, username, password, role, email, status) VALUES
(3, 'MegaPharma', '$2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK', 'supplier', 'mega@pharma.com', 'pending'),
(4, 'DrRx', '$2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK', 'pharmacist', 'drrx@clinic.com', 'pending'),
(5, 'PatientAlice', '$2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK', 'patient', 'alice@wonderland.com', 'approved'),
(6, 'GlobalMeds', '$2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK', 'supplier', 'global@meds.com', 'approved');

-- 4. Profiles
INSERT INTO pharmacists (userID, degree_path, cv_path) VALUES
(4, 'uploads/mock-degree.png', 'uploads/mock-cv.pdf');

INSERT INTO patients (patientID, userID, first_name, last_name, dateOfBirth, disease, location) VALUES
(1, 5, 'Alice', 'Smith', '1995-08-12', 'Asthma', 'Gaza');

-- 5. Pharmacies
-- Bahfos Wellness is an approved pharmacy managed by pharmacist Bahfos (userID=2)
INSERT INTO pharmacies (pharmacyID, ownerID, name, location, supplier_company, status, photo_path) VALUES
(1, 2, 'Bahfos Wellness', 'Gaza Main St.', 'Allied Distribution', 'approved', 'uploads/mock-pharmacy.png'),
-- Mega Cure is a pending pharmacy suggested by pharmacist DrRx (userID=4), awaiting admin approval
(2, 4, 'Mega Cure Pharmacy', 'Ramallah', 'MegaPharma', 'pending', 'uploads/mock-pharmacy.png');

-- 6. Pharmacy inventory (local stock in Bahfos Wellness)
INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity, price_per_unit) VALUES
(1, 1, 15, 12.50),   -- Amoxicillin (Expired in catalog)
(1, 2, 45, 8.00),    -- Ibuprofen (Expiring soon)
(1, 3, 300, 5.00),   -- Paracetamol (Valid)
(1, 4, 8, 15.00);    -- Loratadine (Expiring soon)

-- 7. Supplier stock levels (GlobalMeds approved supplier stock)
INSERT INTO supplier_stock (supplierID, medicineID, quantity) VALUES
(6, 1, 1200),
(6, 2, 800),
(6, 3, 4000);

-- 8. Pending patient requests
INSERT INTO orders (orderID, patientID, medicineID, pharmacyID, cost, status) VALUES
(1, 1, 1, NULL, 0.00, 'pending'); -- Alice requested Amoxicillin

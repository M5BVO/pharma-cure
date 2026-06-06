-- PHARMA-CORE V3.2 Database Schema
DROP DATABASE IF EXISTS pharmacyManagement;
CREATE DATABASE pharmacyManagement;
USE pharmacyManagement;

-- Authentication & Authorization Table
CREATE TABLE users (
    userID INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'pharmacist', 'patient', 'supplier') NOT NULL,
    email VARCHAR(100),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved'
);

-- Pharmacist Profiles
CREATE TABLE pharmacists (
    pharmacistID INT AUTO_INCREMENT PRIMARY KEY,
    userID INT UNIQUE,
    degree_path VARCHAR(255),
    cv_path VARCHAR(255),
    FOREIGN KEY (userID) REFERENCES users(userID) ON DELETE CASCADE
);

-- Patient Profiles
CREATE TABLE patients (
    patientID INT AUTO_INCREMENT PRIMARY KEY,
    userID INT UNIQUE,
    first_name VARCHAR(25) NOT NULL,
    last_name VARCHAR(25) NOT NULL,
    dateOfBirth DATE, 
    disease VARCHAR(60),
    location VARCHAR(40),
    latitude DECIMAL(10,8),
    longitude DECIMAL(10,8),
    FOREIGN KEY (userID) REFERENCES users(userID) ON DELETE CASCADE
);

-- Medicines Catalog
CREATE TABLE medicines (
    medicineID INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    used_for TEXT,
    general_expiry_date DATE
);
    
-- Pharmacies Registry
CREATE TABLE pharmacies (
    pharmacyID INT AUTO_INCREMENT PRIMARY KEY,
    ownerID INT,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(40),
    latitude DECIMAL(10,8),
    longitude DECIMAL(10,8),
    supplier_company VARCHAR(100),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    photo_path VARCHAR(255),
    FOREIGN KEY (ownerID) REFERENCES users(userID) ON DELETE SET NULL
);
    
-- Local Inventory for each Pharmacy
CREATE TABLE pharmacy_medicines (
    pharmacyID INT,
    medicineID INT,
    quantity INT NOT NULL DEFAULT 0,
    price_per_unit DECIMAL(12,2) DEFAULT 0.00,
    PRIMARY KEY(pharmacyID, medicineID),
    FOREIGN KEY (pharmacyID) REFERENCES pharmacies(pharmacyID) ON DELETE CASCADE,
    FOREIGN KEY (medicineID) REFERENCES medicines(medicineID) ON DELETE CASCADE
);

-- Supplier Stock Table
CREATE TABLE supplier_stock (
    supplierID INT,
    medicineID INT,
    quantity INT NOT NULL DEFAULT 0,
    PRIMARY KEY(supplierID, medicineID),
    FOREIGN KEY (supplierID) REFERENCES users(userID) ON DELETE CASCADE,
    FOREIGN KEY (medicineID) REFERENCES medicines(medicineID) ON DELETE CASCADE
);

-- Unified Proposals Table (Uber-like Economy)
CREATE TABLE proposals (
    proposalID INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('patient_to_pharma', 'pharma_to_supplier') NOT NULL,
    initiatorID INT NOT NULL, -- patientID or pharmacyID
    responderID INT NOT NULL, -- pharmacyID or supplierUserID
    medicineID INT NOT NULL,
    quantity INT NOT NULL,
    proposed_price DECIMAL(12,2) NOT NULL,
    status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
    system_rating ENUM('poor', 'fair', 'good', 'excellent') DEFAULT 'fair', -- AI suggestion
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (medicineID) REFERENCES medicines(medicineID) ON DELETE CASCADE
);

-- Orders Tracking (Finalized Transactions)
CREATE TABLE orders (
    orderID INT AUTO_INCREMENT PRIMARY KEY,
    proposalID INT UNIQUE,
    patientID INT,
    medicineID INT,
    pharmacyID INT,
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    final_cost DECIMAL(12,2) DEFAULT 0.00,
    status ENUM('completed', 'cancelled') DEFAULT 'completed',
    rating INT DEFAULT NULL,
    FOREIGN KEY (proposalID) REFERENCES proposals(proposalID) ON DELETE SET NULL,
    FOREIGN KEY (patientID) REFERENCES patients(patientID) ON DELETE CASCADE,
    FOREIGN KEY (medicineID) REFERENCES medicines(medicineID) ON DELETE CASCADE,
    FOREIGN KEY (pharmacyID) REFERENCES pharmacies(pharmacyID) ON DELETE SET NULL
);

-- Supplier Orders (Finalized restocks)
CREATE TABLE supplier_orders (
    sOrderID INT AUTO_INCREMENT PRIMARY KEY,
    proposalID INT UNIQUE,
    pharmacyID INT,
    medicineID INT,
    quantity INT NOT NULL,
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('delivered', 'cancelled') DEFAULT 'delivered',
    supplierID INT NULL,
    FOREIGN KEY (proposalID) REFERENCES proposals(proposalID) ON DELETE SET NULL,
    FOREIGN KEY (pharmacyID) REFERENCES pharmacies(pharmacyID) ON DELETE CASCADE,
    FOREIGN KEY (medicineID) REFERENCES medicines(medicineID) ON DELETE CASCADE,
    FOREIGN KEY (supplierID) REFERENCES users(userID) ON DELETE SET NULL
);

-- Complaints System
CREATE TABLE complaints (
    complaintID INT AUTO_INCREMENT PRIMARY KEY,
    patientID INT,
    pharmacyID INT,
    orderID INT,
    subject VARCHAR(255) NOT NULL,
    details TEXT NOT NULL,
    status ENUM('pending', 'resolved') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientID) REFERENCES patients(patientID) ON DELETE CASCADE,
    FOREIGN KEY (pharmacyID) REFERENCES pharmacies(pharmacyID) ON DELETE SET NULL,
    FOREIGN KEY (orderID) REFERENCES orders(orderID) ON DELETE SET NULL
);

-- Default Admin (Password: Admin@123)
INSERT INTO users (username, password, role, status) VALUES ('admin', '$2a$10$NLeSCb8mJfAJAyf7K87T.eKDHflqB.xmrnC4HYWcrpMMIeHcOM8dq', 'admin', 'approved');

-- Default Pharmacist Bahfos (Password: 123)
INSERT INTO users (username, password, role, status) VALUES ('Bahfos', '$2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK', 'pharmacist', 'approved');
INSERT INTO pharmacists (userID) VALUES (2);

-- Default Patient Alice (Password: 123)
INSERT INTO users (username, password, role, status) VALUES ('PatientAlice', '$2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK', 'patient', 'approved');
INSERT INTO patients (userID, first_name, last_name, latitude, longitude) VALUES (3, 'Alice', 'Clinical', 33.5138, 36.2765);

-- Default Supplier GlobalMeds (Password: 123)
INSERT INTO users (username, password, role, status) VALUES ('GlobalMeds', '$2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK', 'supplier', 'approved');

-- Sample Pharmacy with Coordinates
INSERT INTO pharmacies (ownerID, name, location, latitude, longitude, status) VALUES (2, 'Central Clinical Pharmacy', 'Damascus Center', 33.5100, 36.2700, 'approved');

-- Sample Medicine
INSERT INTO medicines (name, used_for) VALUES ('Amoxicillin', 'Infection Control');

-- Sample Proposal
INSERT INTO proposals (type, initiatorID, responderID, medicineID, quantity, proposed_price, status, system_rating) 
VALUES ('patient_to_pharma', 1, 1, 1, 2, 15.50, 'pending', 'good');

const mysql = require('/home/mask/Desktop/dataBaseProject/node_modules/mysql2/promise');
require('/home/mask/Desktop/dataBaseProject/node_modules/dotenv').config({ path: '/home/mask/Desktop/dataBaseProject/.env' });

const HASHED_PASSWORD_123 = '$2a$10$f79KNR3vhbZUxQ98.otEWOTPOtlhJlyV6cKO05dFOyIaoyJ6wkNaK';

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true
    });

    console.log('Starting massive database seeding...');

    try {
        // 1. Clean up existing tables
        console.log('Cleaning up tables...');
        await pool.query('SET FOREIGN_KEY_CHECKS = 0');
        await pool.query('TRUNCATE TABLE supplier_orders');
        await pool.query('TRUNCATE TABLE orders');
        await pool.query('TRUNCATE TABLE supplier_stock');
        await pool.query('TRUNCATE TABLE pharmacy_medicines');
        await pool.query('TRUNCATE TABLE pharmacies');
        await pool.query('TRUNCATE TABLE patients');
        await pool.query('TRUNCATE TABLE pharmacists');
        await pool.query('TRUNCATE TABLE medicines');
        // Delete users but preserve default admin (userID=1) and Bahfos (userID=2)
        await pool.query('DELETE FROM users WHERE userID > 2');
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');

        // 2. Insert 25 medicines with realistic names and categories
        console.log('Inserting 25 medicines...');
        const medicinesData = [
            [1, 'Amoxicillin', 'Antibiotics', '2026-04-10'], // Expired
            [2, 'Ciprofloxacin', 'Antibiotics', '2027-08-15'],
            [3, 'Azithromycin', 'Antibiotics', '2026-06-10'], // Expiring soon
            [4, 'Ibuprofen 400mg', 'Pain Relief', '2026-06-25'], // Expiring soon
            [5, 'Paracetamol 500mg', 'Pain Relief', '2027-12-01'],
            [6, 'Aspirin 81mg', 'Pain Relief', '2027-03-14'],
            [7, 'Loratadine 10mg', 'Allergy Relief', '2026-06-02'], // Expiring soon
            [8, 'Cetirizine 10mg', 'Allergy Relief', '2027-10-18'],
            [9, 'Fexofenadine 180mg', 'Allergy Relief', '2028-01-05'],
            [10, 'Metformin 500mg', 'Diabetes Control', '2028-11-20'],
            [11, 'Glipizide 5mg', 'Diabetes Control', '2027-05-15'],
            [12, 'Jardiance 10mg', 'Diabetes Control', '2028-09-30'],
            [13, 'Atorvastatin 20mg', 'Cholesterol', '2027-12-25'],
            [14, 'Simvastatin 10mg', 'Cholesterol', '2026-06-08'], // Expiring soon
            [15, 'Lisinopril 10mg', 'Blood Pressure', '2027-11-12'],
            [16, 'Amlodipine 5mg', 'Blood Pressure', '2028-02-28'],
            [17, 'Losartan 50mg', 'Blood Pressure', '2027-06-15'],
            [18, 'Omeprazole 20mg', 'Acid Reflux', '2027-04-20'],
            [19, 'Pantoprazole 40mg', 'Acid Reflux', '2028-05-10'],
            [20, 'Albuterol Inhaler', 'Asthma Control', '2026-04-30'], // Expired
            [21, 'Montelukast 10mg', 'Asthma Control', '2027-09-12'],
            [22, 'Sertraline 50mg', 'Antidepressant', '2027-10-01'],
            [23, 'Escitalopram 10mg', 'Antidepressant', '2028-03-15'],
            [24, 'Vitamin D3 5000IU', 'Vitamins', '2029-01-01'],
            [25, 'Vitamin C 1000mg', 'Vitamins', '2028-06-30']
        ];
        await pool.query(
            'INSERT INTO medicines (medicineID, name, used_for, general_expiry_date) VALUES ?',
            [medicinesData]
        );

        // 3. Insert users: 3 pharmacists, 4 suppliers, 10 patients
        console.log('Inserting 17 new users...');
        const usersData = [
            // Pharmacists (userID 3, 4, 5)
            [3, 'DrRx', HASHED_PASSWORD_123, 'pharmacist', 'drrx@clinic.com', 'approved'],
            [4, 'Apothecary', HASHED_PASSWORD_123, 'pharmacist', 'apothecary@wellness.com', 'approved'],
            [5, 'MedExpert', HASHED_PASSWORD_123, 'pharmacist', 'expert@med.com', 'pending'],
            // Suppliers (userID 6, 7, 8, 9)
            [6, 'MegaPharma', HASHED_PASSWORD_123, 'supplier', 'mega@pharma.com', 'approved'],
            [7, 'GlobalMeds', HASHED_PASSWORD_123, 'supplier', 'global@meds.com', 'approved'],
            [8, 'BioSupply', HASHED_PASSWORD_123, 'supplier', 'bio@supply.com', 'approved'],
            [9, 'AlphaDistrib', HASHED_PASSWORD_123, 'supplier', 'alpha@dist.com', 'pending'],
            // Patients (userID 10 to 19)
            [10, 'PatientAlice', HASHED_PASSWORD_123, 'patient', 'alice@wonderland.com', 'approved'],
            [11, 'PatientBob', HASHED_PASSWORD_123, 'patient', 'bob@builder.com', 'approved'],
            [12, 'PatientCharlie', HASHED_PASSWORD_123, 'patient', 'charlie@chocolate.com', 'approved'],
            [13, 'PatientDavid', HASHED_PASSWORD_123, 'patient', 'david@goliath.com', 'approved'],
            [14, 'PatientEve', HASHED_PASSWORD_123, 'patient', 'eve@eden.com', 'approved'],
            [15, 'PatientFrank', HASHED_PASSWORD_123, 'patient', 'frank@castle.com', 'approved'],
            [16, 'PatientGrace', HASHED_PASSWORD_123, 'patient', 'grace@hopper.com', 'approved'],
            [17, 'PatientHenry', HASHED_PASSWORD_123, 'patient', 'henry@tudor.com', 'approved'],
            [18, 'PatientIvy', HASHED_PASSWORD_123, 'patient', 'ivy@league.com', 'approved'],
            [19, 'PatientJack', HASHED_PASSWORD_123, 'patient', 'jack@beanstalk.com', 'approved']
        ];
        await pool.query(
            'INSERT INTO users (userID, username, password, role, email, status) VALUES ?',
            [usersData]
        );

        // 4. Profiles
        console.log('Inserting profiles...');
        const pharmacistsData = [
            [3, 'uploads/mock-degree.png', 'uploads/mock-cv.pdf'],
            [4, 'uploads/mock-degree.png', 'uploads/mock-cv.pdf'],
            [5, 'uploads/mock-degree.png', 'uploads/mock-cv.pdf']
        ];
        await pool.query('INSERT INTO pharmacists (userID, degree_path, cv_path) VALUES ?', [pharmacistsData]);

        const patientsData = [
            [1, 10, 'Alice', 'Smith', '1995-08-12', 'Asthma', 'Gaza'],
            [2, 11, 'Bob', 'Builder', '1988-03-24', 'Hypertension', 'Ramallah'],
            [3, 12, 'Charlie', 'Bucket', '2005-12-05', 'Diabetes', 'Nablus'],
            [4, 13, 'David', 'Miller', '1975-06-15', 'High Cholesterol', 'Hebron'],
            [5, 14, 'Eve', 'Adams', '1990-11-30', 'Depression', 'Bethlehem'],
            [6, 15, 'Frank', 'Castle', '1982-04-18', 'None', 'Jericho'],
            [7, 16, 'Grace', 'Hopper', '1965-09-09', 'Asthma', 'Jenin'],
            [8, 17, 'Henry', 'Tudor', '1970-01-01', 'Hypertension', 'Tulkarm'],
            [9, 18, 'Ivy', 'Green', '1998-07-22', 'Allergies', 'Qalqilya'],
            [10, 19, 'Jack', 'Frost', '2001-02-14', 'None', 'Salfit']
        ];
        await pool.query(
            'INSERT INTO patients (patientID, userID, first_name, last_name, dateOfBirth, disease, location) VALUES ?',
            [patientsData]
        );

        // 5. Pharmacies: 1 owned by Bahfos, 1 by DrRx, 1 by Apothecary, 1 pending by MedExpert
        console.log('Inserting pharmacies...');
        const pharmaciesData = [
            [1, 2, 'Bahfos Wellness', 'Gaza Main St.', 'Allied Distribution', 'approved', 'uploads/mock-pharmacy.png'],
            [2, 3, 'Mega Cure Pharmacy', 'Ramallah Downtown', 'MegaPharma', 'approved', 'uploads/mock-pharmacy.png'],
            [3, 4, 'Apothecary Wellness', 'Nablus Center', 'BioSupply', 'approved', 'uploads/mock-pharmacy.png'],
            [4, 5, 'MedExpert Pharmacy', 'Hebron Plaza', 'AlphaDistrib', 'pending', 'uploads/mock-pharmacy.png']
        ];
        await pool.query(
            'INSERT INTO pharmacies (pharmacyID, ownerID, name, location, supplier_company, status, photo_path) VALUES ?',
            [pharmaciesData]
        );

        // 6. Pharmacy Inventory: 35+ items mapped to approved pharmacies (IDs 1, 2, 3)
        console.log('Inserting pharmacy inventories...');
        const pmData = [];
        // Pharmacy 1 (Bahfos Wellness) inventory
        const p1Meds = [
            [1, 15, 12.50],  // Amoxicillin
            [2, 45, 8.00],   // Ciprofloxacin
            [3, 10, 18.00],  // Azithromycin
            [4, 50, 7.50],   // Ibuprofen
            [5, 300, 4.00],  // Paracetamol
            [7, 8, 15.00],   // Loratadine
            [8, 100, 10.00], // Cetirizine
            [10, 60, 22.00], // Metformin
            [13, 120, 35.00],// Atorvastatin
            [15, 80, 28.00], // Lisinopril
            [18, 40, 19.50], // Omeprazole
            [22, 30, 45.00], // Sertraline
            [24, 200, 14.00] // Vitamin D3
        ];
        p1Meds.forEach(item => pmData.push([1, item[0], item[1], item[2]]));

        // Pharmacy 2 (Mega Cure Pharmacy) inventory
        const p2Meds = [
            [1, 30, 11.90],
            [2, 20, 8.50],
            [4, 100, 6.90],
            [5, 400, 3.50],
            [6, 150, 5.00],
            [8, 80, 9.50],
            [10, 100, 20.00],
            [11, 50, 15.00],
            [14, 40, 18.00],
            [16, 90, 22.00],
            [18, 60, 18.00],
            [20, 2, 35.00],
            [25, 150, 12.00]
        ];
        p2Meds.forEach(item => pmData.push([2, item[0], item[1], item[2]]));

        // Pharmacy 3 (Apothecary Wellness) inventory
        const p3Meds = [
            [2, 15, 9.00],
            [3, 25, 17.50],
            [5, 200, 3.99],
            [6, 80, 5.50],
            [7, 30, 14.00],
            [9, 45, 28.00],
            [10, 80, 21.00],
            [12, 30, 85.00],
            [13, 90, 32.50],
            [17, 50, 34.00],
            [19, 40, 42.00],
            [21, 20, 29.00],
            [23, 35, 38.00],
            [24, 100, 15.00]
        ];
        p3Meds.forEach(item => pmData.push([3, item[0], item[1], item[2]]));

        await pool.query(
            'INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity, price_per_unit) VALUES ?',
            [pmData]
        );

        // 7. Supplier Catalog Stock: 40+ items for suppliers 6, 7, 8
        console.log('Inserting supplier stocks...');
        const ssData = [];
        // Supplier 6 (MegaPharma) stock
        const s6Meds = [[1, 5000], [2, 3000], [3, 2000], [4, 4000], [5, 10000], [10, 2500], [11, 2000]];
        s6Meds.forEach(item => ssData.push([6, item[0], item[1]]));

        // Supplier 7 (GlobalMeds) stock
        const s7Meds = [[1, 2000], [2, 1500], [3, 1000], [5, 8000], [7, 3000], [8, 4000], [13, 1500], [15, 2000]];
        s7Meds.forEach(item => ssData.push([7, item[0], item[1]]));

        // Supplier 8 (BioSupply) stock
        const s8Meds = [[12, 1000], [13, 2000], [14, 1500], [16, 2500], [18, 3000], [19, 2000], [22, 1200], [24, 5000], [25, 4000]];
        s8Meds.forEach(item => ssData.push([8, item[0], item[1]]));

        await pool.query(
            'INSERT INTO supplier_stock (supplierID, medicineID, quantity) VALUES ?',
            [ssData]
        );

        // 8. Order History: 40+ completed/pending orders with ratings
        console.log('Inserting 40+ patient orders...');
        const ordersData = [];
        // Let's generate 40 orders spanning different patients, medicines, and pharmacies
        // Format: [orderID, patientID, medicineID, pharmacyID, order_date, cost, status, rating, auto_buy]
        for (let i = 1; i <= 40; i++) {
            const patID = (i % 10) + 1; // patientID 1 to 10
            const medID = (i % 25) + 1; // medicineID 1 to 25
            const pharmID = (i % 3) + 1; // pharmacyID 1 to 3
            
            let status = 'completed';
            let rating = null;
            let cost = (10 + (i * 2.25)).toFixed(2);
            let autoBuy = i % 2; // alternates 0 and 1

            if (i > 32) {
                // Last 8 orders are pending
                status = 'pending';
                cost = (8 + (i * 1.5)).toFixed(2);
                autoBuy = 0;
            } else if (i % 3 === 0) {
                rating = 5;
            } else if (i % 5 === 0) {
                rating = 4;
            } else if (i % 7 === 0) {
                rating = 3;
            }

            const daysAgo = 40 - i;
            const orderDateStr = new Date(Date.now() - (daysAgo * 24 * 60 * 60 * 1000)).toISOString().slice(0, 19).replace('T', ' ');

            ordersData.push([i, patID, medID, pharmID, orderDateStr, cost, status, rating, autoBuy]);
        }

        await pool.query(
            'INSERT INTO orders (orderID, patientID, medicineID, pharmacyID, order_date, cost, status, rating, auto_buy) VALUES ?',
            [ordersData]
        );

        console.log('Database seeded with massive realistic data successfully!');
    } catch (e) {
        console.error('Seeding Error:', e);
        throw e;
    } finally {
        await pool.end();
    }
}

main();

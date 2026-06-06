require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Custom Request Logger Middleware
app.use((req, res, next) => {
    const start = Date.now();
    const timestamp = new Date().toISOString();
    
    // Log on request start
    console.log(`[${timestamp}] Incoming: ${req.method} ${req.url}`);

    // Log on response end
    res.on('finish', () => {
        const duration = Date.now() - start;
        const color = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m'; // Red for errors, Green for success
        const reset = '\x1b[0m';
        console.log(`[${timestamp}] Handled: ${req.method} ${req.url} -> ${color}${res.statusCode}${reset} (${duration}ms)`);
    });
    
    next();
});

const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// --- AUTOMATIC DATABASE INITIALIZATION & MIGRATION ---
(async () => {
    try {
        // 1. Check if the database is initialized
        const [tables] = await pool.query("SHOW TABLES LIKE 'users'");
        
        if (tables.length === 0) {
            console.log('\x1b[35m[INIT] Database is empty. Bootstrapping Pharma-Cure V4 Schema...\x1b[0m');
            const sqlInit = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
            
            // Split by semicolon but handle the multi-line inserts/creates
            const statements = sqlInit.split(/;(?=\n|$)/).filter(s => s.trim());
            
            for (let statement of statements) {
                if (statement.trim()) {
                    await pool.query(statement);
                }
            }
            console.log('\x1b[32m[INIT] Database successfully bootstrapped with V4 schema and Default Admin.\x1b[0m');
        } else {
            console.log('\x1b[36m[MIGRATION] Tables detected. Verifying structural integrity...\x1b[0m');
            
            // Verify newer V4 columns
            const [columns] = await pool.query("SHOW COLUMNS FROM supplier_stock LIKE 'price_per_unit'");
            if (columns.length === 0) {
                await pool.query('ALTER TABLE supplier_stock ADD COLUMN price_per_unit DECIMAL(12,2) DEFAULT 0.00');
                console.log('[MIGRATION] Added price_per_unit to supplier_stock.');
            }
        }
    } catch (err) {
        console.error('\x1b[31m[DATABASE ERROR] Critical failure during startup:\x1b[0m', err.message);
        console.log('\x1b[33m[HINT] Ensure MySQL is running and the user has CREATE permissions.\x1b[0m');
    }
})();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --- ERROR HANDLING WRAPPER ---
const handleDBError = (err, res) => {
    console.error(`[SECURE LOG] Error details:`, err);
    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'This record already exists in our secure system.' });
    }
    res.status(500).json({ error: 'A secure system error occurred. Access restricted.' });
};

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

const authorizeRoles = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Permission denied' });
    next();
};

// --- AUTH ENDPOINTS ---
app.post('/api/auth/register', upload.fields([{ name: 'degree', maxCount: 1 }, { name: 'cv', maxCount: 1 }]), async (req, res) => {
    const { username, password, role, email, first_name, last_name } = req.body;
    if (role === 'admin') return res.status(403).json({ error: 'Cannot register as admin' });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const status = (role === 'pharmacist' || role === 'supplier') ? 'pending' : 'approved';
        const [userResult] = await pool.execute(
            'INSERT INTO users (username, password, role, email, status) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, role, email || null, status]
        );
        
        if (role === 'pharmacist') {
            const degree_path = req.files && req.files['degree'] ? req.files['degree'][0].path : null;
            const cv_path = req.files && req.files['cv'] ? req.files['cv'][0].path : null;
            await pool.execute('INSERT INTO pharmacists (userID, degree_path, cv_path) VALUES (?, ?, ?)', [userResult.insertId, degree_path, cv_path]);
        } else if (role === 'patient') {
            await pool.execute('INSERT INTO patients (userID, first_name, last_name) VALUES (?, ?, ?)', [userResult.insertId, first_name || null, last_name || null]);
        }
        res.status(201).json({ message: 'Registration successful.' });
    } catch (err) { handleDBError(err, res); }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0 || !await bcrypt.compare(password, users[0].password)) return res.status(400).json({ error: 'Invalid credentials' });
        if (users[0].status !== 'approved') return res.status(403).json({ error: `Account status: ${users[0].status}` });
        const token = jwt.sign({ userID: users[0].userID, role: users[0].role }, process.env.JWT_SECRET, { expiresIn: '2h' });
        res.json({ token, role: users[0].role, username: users[0].username });
    } catch (err) { handleDBError(err, res); }
});

// --- PATIENT PROFILE ENDPOINTS ---
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM patients WHERE userID = ?', [req.user.userID]);
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.put('/api/patients', authenticateToken, async (req, res) => {
    const { first_name, last_name, dateOfBirth, disease, location } = req.body;
    try {
        await pool.execute(`
            INSERT INTO patients (userID, first_name, last_name, dateOfBirth, disease, location)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE first_name = ?, last_name = ?, dateOfBirth = ?, disease = ?, location = ?
        `, [
            req.user.userID,
            first_name || null, last_name || null, dateOfBirth || null, disease || null, location || null,
            first_name || null, last_name || null, dateOfBirth || null, disease || null, location || null
        ]);
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/patient/stats', authenticateToken, authorizeRoles('patient'), async (req, res) => {
    try {
        const [patientRecord] = await pool.execute('SELECT patientID FROM patients WHERE userID = ?', [req.user.userID]);
        if (patientRecord.length === 0) {
            return res.json({
                totalRequests: 0,
                completedRequests: 0,
                pendingRequests: 0,
                totalSpent: 0,
                spendingHistory: [],
                categoryBreakdown: [],
                topMeds: []
            });
        }
        const pid = patientRecord[0].patientID;

        const [[{ totalRequests }]] = await pool.execute('SELECT COUNT(*) as totalRequests FROM orders WHERE patientID = ?', [pid]);
        const [[{ completedRequests }]] = await pool.execute('SELECT COUNT(*) as completedRequests FROM orders WHERE patientID = ? AND status = "completed"', [pid]);
        const [[{ pendingRequests }]] = await pool.execute('SELECT COUNT(*) as pendingRequests FROM orders WHERE patientID = ? AND status = "pending"', [pid]);
        const [[{ totalSpent }]] = await pool.execute('SELECT SUM(cost) as totalSpent FROM orders WHERE patientID = ? AND status = "completed"', [pid]);

        const [spendingHistory] = await pool.execute(`
            SELECT DATE_FORMAT(order_date, '%Y-%m-%d') as date, SUM(cost) as spent, COUNT(*) as count
            FROM orders
            WHERE patientID = ? AND status = 'completed' AND order_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            GROUP BY DATE_FORMAT(order_date, '%Y-%m-%d')
            ORDER BY date ASC
        `, [pid]);

        const [categoryBreakdown] = await pool.execute(`
            SELECT COALESCE(m.used_for, 'General') as category, SUM(o.cost) as spent, COUNT(*) as count
            FROM orders o
            JOIN medicines m ON o.medicineID = m.medicineID
            WHERE o.patientID = ? AND o.status = 'completed'
            GROUP BY m.used_for
        `, [pid]);

        const [topMeds] = await pool.execute(`
            SELECT m.name, COUNT(*) as requests, SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completed
            FROM orders o
            JOIN medicines m ON o.medicineID = m.medicineID
            WHERE o.patientID = ?
            GROUP BY o.medicineID, m.name
            ORDER BY requests DESC
            LIMIT 5
        `, [pid]);

        res.json({
            totalRequests: Number(totalRequests) || 0,
            completedRequests: Number(completedRequests) || 0,
            pendingRequests: Number(pendingRequests) || 0,
            totalSpent: Number(totalSpent) || 0,
            spendingHistory: spendingHistory.map(s => ({
                date: s.date,
                spent: Number(s.spent) || 0,
                count: Number(s.count) || 0
            })),
            categoryBreakdown: categoryBreakdown.map(c => ({
                category: c.category,
                spent: Number(c.spent) || 0,
                count: Number(c.count) || 0
            })),
            topMeds: topMeds.map(m => ({
                name: m.name,
                requests: Number(m.requests) || 0,
                completed: Number(m.completed) || 0
            }))
        });
    } catch (err) { handleDBError(err, res); }
});

// --- PHARMACIST OPERATIONS ---
app.get('/api/pharmacist/my-pharmacies', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM pharmacies WHERE ownerID = ?', [req.user.userID]);
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.delete('/api/pharmacies/:id', authenticateToken, authorizeRoles('pharmacist', 'admin'), async (req, res) => {
    try {
        const [pharmacy] = await pool.execute('SELECT ownerID FROM pharmacies WHERE pharmacyID = ?', [req.params.id]);
        if (pharmacy.length === 0) return res.status(404).json({ error: 'Pharmacy not found' });
        if (req.user.role !== 'admin' && pharmacy[0].ownerID !== req.user.userID) {
            return res.status(403).json({ error: 'Violation: You do not own this entity.' });
        }
        await pool.execute('DELETE FROM pharmacies WHERE pharmacyID = ?', [req.params.id]);
        res.json({ message: 'Pharmacy and all related stock deleted.' });
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/pharmacist/stats/:pharmacyID', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    const { pharmacyID } = req.params;
    console.log(`[STATS DEBUG] req.url: ${req.url}, req.params:`, req.params, `pharmacyID:`, pharmacyID);
    
    const parsedPharmacyID = parseInt(pharmacyID, 10);
    if (isNaN(parsedPharmacyID)) {
        console.warn(`[STATS DEBUG] Invalid pharmacyID: ${pharmacyID}`);
        return res.status(400).json({ error: 'Invalid pharmacyID parameter' });
    }
    
    try {
        const [[{ totalGains }]] = await pool.execute('SELECT SUM(final_cost) as totalGains FROM orders WHERE pharmacyID = ? AND status = "completed"', [parsedPharmacyID]);
        const [[{ totalSalesCount }]] = await pool.execute('SELECT COUNT(*) as totalSalesCount FROM orders WHERE pharmacyID = ? AND status = "completed"', [parsedPharmacyID]);
        const [[{ avgOrderValue }]] = await pool.execute('SELECT AVG(final_cost) as avgOrderValue FROM orders WHERE pharmacyID = ? AND status = "completed"', [parsedPharmacyID]);
        const [[{ lowStockCount }]] = await pool.execute('SELECT COUNT(*) as lowStockCount FROM pharmacy_medicines WHERE pharmacyID = ? AND quantity <= 10 AND quantity > 0', [parsedPharmacyID]);
        const [[{ outOfStockCount }]] = await pool.execute('SELECT COUNT(*) as outOfStockCount FROM pharmacy_medicines WHERE pharmacyID = ? AND quantity = 0', [parsedPharmacyID]);
        const [[{ totalInventoryValue }]] = await pool.execute('SELECT SUM(quantity * price_per_unit) as totalInventoryValue FROM pharmacy_medicines WHERE pharmacyID = ?', [parsedPharmacyID]);
        
        const [[{ expiredCount }]] = await pool.execute(`
            SELECT COUNT(*) as expiredCount 
            FROM pharmacy_medicines pm 
            JOIN medicines m ON pm.medicineID = m.medicineID 
            WHERE pm.pharmacyID = ? AND m.general_expiry_date < CURDATE() AND pm.quantity > 0
        `, [parsedPharmacyID]);
        
        const [[{ expiringSoonCount }]] = await pool.execute(`
            SELECT COUNT(*) as expiringSoonCount 
            FROM pharmacy_medicines pm 
            JOIN medicines m ON pm.medicineID = m.medicineID 
            WHERE pm.pharmacyID = ? AND m.general_expiry_date >= CURDATE() AND m.general_expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND pm.quantity > 0
        `, [parsedPharmacyID]);

        // Rich stats
        const [salesHistory] = await pool.execute(`
            SELECT DATE_FORMAT(order_date, '%Y-%m-%d') as date, SUM(final_cost) as revenue, COUNT(*) as count 
            FROM orders 
            WHERE pharmacyID = ? AND status = 'completed' AND order_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            GROUP BY DATE_FORMAT(order_date, '%Y-%m-%d') 
            ORDER BY date ASC
        `, [parsedPharmacyID]);

        const [categoryBreakdown] = await pool.execute(`
            SELECT COALESCE(m.used_for, 'General') as category, SUM(o.final_cost) as revenue, COUNT(*) as count
            FROM orders o
            JOIN medicines m ON o.medicineID = m.medicineID
            WHERE o.pharmacyID = ? AND o.status = 'completed'
            GROUP BY m.used_for
        `, [parsedPharmacyID]);

        const [topProfitableMeds] = await pool.execute(`
            SELECT m.name, SUM(o.final_cost) as revenue, COUNT(*) as sales
            FROM orders o
            JOIN medicines m ON o.medicineID = m.medicineID
            WHERE o.pharmacyID = ? AND o.status = 'completed'
            GROUP BY o.medicineID, m.name
            ORDER BY revenue DESC
            LIMIT 5
        `, [parsedPharmacyID]);

        const [expiringList] = await pool.execute(`
            SELECT pm.medicineID, m.name, pm.quantity, DATE_FORMAT(m.general_expiry_date, '%Y-%m-%d') as expiry_date, DATEDIFF(m.general_expiry_date, CURDATE()) as days_left
            FROM pharmacy_medicines pm
            JOIN medicines m ON pm.medicineID = m.medicineID
            WHERE pm.pharmacyID = ? AND m.general_expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND pm.quantity > 0
            ORDER BY days_left ASC
        `, [parsedPharmacyID]);

        const [lowStockList] = await pool.execute(`
            SELECT m.name, pm.quantity
            FROM pharmacy_medicines pm
            JOIN medicines m ON pm.medicineID = m.medicineID
            WHERE pm.pharmacyID = ? AND pm.quantity <= 10
            ORDER BY pm.quantity ASC
        `, [parsedPharmacyID]);

        res.json({ 
            totalGains: Number(totalGains) || 0, 
            totalSalesCount: Number(totalSalesCount) || 0,
            avgOrderValue: Number(avgOrderValue) || 0,
            lowStockCount: Number(lowStockCount) || 0,
            outOfStockCount: Number(outOfStockCount) || 0,
            totalInventoryValue: Number(totalInventoryValue) || 0,
            expiredCount: Number(expiredCount) || 0,
            expiringSoonCount: Number(expiringSoonCount) || 0,
            salesHistory: salesHistory.map(s => ({
                date: s.date,
                revenue: Number(s.revenue) || 0,
                count: Number(s.count) || 0
            })),
            categoryBreakdown: categoryBreakdown.map(c => ({
                category: c.category,
                revenue: Number(c.revenue) || 0,
                count: Number(c.count) || 0
            })),
            topMeds: topProfitableMeds.map(m => ({
                name: m.name,
                revenue: Number(m.revenue) || 0,
                sales: Number(m.sales) || 0
            })),
            expiringList,
            lowStockList
        });
    } catch (err) { 
        console.error(`[STATS ERROR] Error details:`, err);
        handleDBError(err, res); 
    }
});

app.get('/api/pharmacist/inventory/:pharmacyID', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    try {
        const [inventory] = await pool.execute(`
            SELECT pm.*, m.name, m.general_expiry_date FROM pharmacy_medicines pm 
            JOIN medicines m ON pm.medicineID = m.medicineID 
            WHERE pm.pharmacyID = ?
            ORDER BY m.name ASC, m.general_expiry_date ASC
        `, [req.params.pharmacyID]);
        res.json(inventory);
    } catch (err) { handleDBError(err, res); }
});

app.patch('/api/pharmacist/inventory', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    const { pharmacyID, medicineID, quantity, price } = req.body;
    try {
        if (price !== undefined && price !== '') {
            const parsedPrice = Number(price);
            await pool.execute(`
                INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity, price_per_unit) 
                VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = ?, price_per_unit = ?
            `, [pharmacyID, medicineID, quantity, parsedPrice, quantity, parsedPrice]);
        } else {
            await pool.execute(`
                INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity) 
                VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = ?
            `, [pharmacyID, medicineID, quantity, quantity]);
        }
        res.json({ message: 'Stock level & price manually updated.' });
    } catch (err) { handleDBError(err, res); }
});

app.post('/api/pharmacist/add-medicine', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    const { name, used_for, general_expiry_date, quantity, price_per_unit, pharmacyID } = req.body;
    try {
        if (!name || !general_expiry_date || !pharmacyID) {
            return res.status(400).json({ error: 'Medicine name, expiry date, and pharmacy are required.' });
        }
        const qty = parseInt(quantity) || 0;
        const price = parseFloat(price_per_unit) || 0.0;

        // Check if medicine with this name and expiry date exists in catalog
        let [meds] = await pool.execute(
            'SELECT medicineID FROM medicines WHERE name = ? AND general_expiry_date = ?',
            [name.trim(), general_expiry_date]
        );

        let medicineID;
        if (meds.length > 0) {
            medicineID = meds[0].medicineID;
        } else {
            // Create a new medicine entry
            const [result] = await pool.execute(
                'INSERT INTO medicines (name, used_for, general_expiry_date) VALUES (?, ?, ?)',
                [name.trim(), used_for || 'General', general_expiry_date]
            );
            medicineID = result.insertId;
        }

        // Now link/add to pharmacy_medicines
        const [existingStock] = await pool.execute(
            'SELECT quantity FROM pharmacy_medicines WHERE pharmacyID = ? AND medicineID = ?',
            [pharmacyID, medicineID]
        );

        if (existingStock.length > 0) {
            await pool.execute(
                'UPDATE pharmacy_medicines SET quantity = quantity + ?, price_per_unit = ? WHERE pharmacyID = ? AND medicineID = ?',
                [qty, price, pharmacyID, medicineID]
            );
        } else {
            await pool.execute(
                'INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity, price_per_unit) VALUES (?, ?, ?, ?)',
                [pharmacyID, medicineID, qty, price]
            );
        }

        res.status(201).json({ message: 'Medicine batch added/updated in stock.' });
    } catch (err) {
        handleDBError(err, res);
    }
});

// Inter-Pharmacy Available Supplies
app.get('/api/pharmacist/available-supplies', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    try {
        const [myPharmacies] = await pool.execute('SELECT pharmacyID FROM pharmacies WHERE ownerID = ?', [req.user.userID]);
        const myPharmaIDs = myPharmacies.map(p => p.pharmacyID);

        let pharmaStockQuery = `
            SELECT pm.pharmacyID as sourceID, p.name as supplier_name, m.medicineID, m.name as medicine_name, m.general_expiry_date, pm.quantity, pm.price_per_unit, 'pharmacy' as supplier_type
            FROM pharmacy_medicines pm
            JOIN pharmacies p ON pm.pharmacyID = p.pharmacyID
            JOIN medicines m ON pm.medicineID = m.medicineID
            WHERE p.status = 'approved'
        `;
        let params = [];
        if (myPharmaIDs.length > 0) {
            pharmaStockQuery += ` AND pm.pharmacyID NOT IN (${myPharmaIDs.map(() => '?').join(',')})`;
            params = [...myPharmaIDs];
        }
        const [pharmaRows] = await pool.query(pharmaStockQuery, params);

        const [supplierRows] = await pool.query(`
            SELECT ss.supplierID as sourceID, u.username as supplier_name, m.medicineID, m.name as medicine_name, m.general_expiry_date, ss.quantity, ss.price_per_unit, 'supplier' as supplier_type
            FROM supplier_stock ss
            JOIN users u ON ss.supplierID = u.userID
            JOIN medicines m ON ss.medicineID = m.medicineID
            WHERE u.status = 'approved'
        `);

        res.json([...pharmaRows, ...supplierRows]);
    } catch (err) { handleDBError(err, res); }
});

// Inter-Pharmacy & Supplier Restocking logic
app.post('/api/pharmacist/restock', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    const { pharmacyID, medicineID, quantity, sourceType, sourceID } = req.body;
    console.log(`[RESTOCK DEBUG] Received restock request. pharmacyID: ${pharmacyID}, medicineID: ${medicineID}, quantity: ${quantity}, sourceType: ${sourceType}, sourceID: ${sourceID}`);
    const qty = parseInt(quantity, 10);
    if (!pharmacyID || !medicineID || isNaN(qty) || qty <= 0) {
        console.log(`[RESTOCK DEBUG] Validation failed: pharmacyID: ${pharmacyID}, medicineID: ${medicineID}, qty: ${qty}`);
        return res.status(400).json({ error: 'Invalid parameters' });
    }
    try {
        console.log(`[RESTOCK DEBUG] Checking pharmacy owner for pharmacyID: ${pharmacyID}...`);
        const [pharmaCheck] = await pool.execute('SELECT ownerID FROM pharmacies WHERE pharmacyID = ?', [pharmacyID]);
        console.log(`[RESTOCK DEBUG] Pharmacy owner query result:`, pharmaCheck);
        if (pharmaCheck.length === 0 || pharmaCheck[0].ownerID !== req.user.userID) {
            console.log(`[RESTOCK DEBUG] Authorization violation. Owner ID: ${pharmaCheck[0]?.ownerID}, User ID: ${req.user.userID}`);
            return res.status(403).json({ error: 'Violation: You do not own this destination pharmacy.' });
        }

        if (sourceType === 'pharmacy') {
            const srcID = parseInt(sourceID, 10);
            console.log(`[RESTOCK DEBUG] Source type is pharmacy. srcID: ${srcID}`);
            if (srcID === parseInt(pharmacyID, 10)) {
                return res.status(400).json({ error: 'System restriction: Pharmacies cannot order from themselves.' });
            }
            console.log(`[RESTOCK DEBUG] Checking stock at source pharmacy...`);
            const [stockCheck] = await pool.execute('SELECT quantity FROM pharmacy_medicines WHERE pharmacyID = ? AND medicineID = ?', [srcID, medicineID]);
            if (stockCheck.length === 0 || stockCheck[0].quantity < qty) {
                return res.status(400).json({ error: 'Insufficient stock at supplier pharmacy.' });
            }
            console.log(`[RESTOCK DEBUG] Updating stock at source pharmacy...`);
            await pool.execute('UPDATE pharmacy_medicines SET quantity = quantity - ? WHERE pharmacyID = ? AND medicineID = ?', [qty, srcID, medicineID]);
            console.log(`[RESTOCK DEBUG] Inserting/updating stock at destination pharmacy...`);
            await pool.execute(`
                INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity) 
                VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?
            `, [pharmacyID, medicineID, qty, qty]);
            console.log(`[RESTOCK DEBUG] Logging order to supplier_orders...`);
            const [result] = await pool.execute('INSERT INTO supplier_orders (pharmacyID, medicineID, quantity, supplierPharmacyID, status) VALUES (?, ?, ?, ?, "delivered")', [pharmacyID, medicineID, qty, srcID]);
            console.log(`[RESTOCK DEBUG] Restock complete.`);
            res.json({ message: 'Stock successfully transferred from supplier pharmacy.', orderID: result.insertId });

        } else if (sourceType === 'supplier') {
            const srcID = parseInt(sourceID, 10);
            console.log(`[RESTOCK DEBUG] Source type is supplier. srcID: ${srcID}`);
            const [stockCheck] = await pool.execute('SELECT quantity FROM supplier_stock WHERE supplierID = ? AND medicineID = ?', [srcID, medicineID]);
            console.log(`[RESTOCK DEBUG] Stock check result:`, stockCheck);
            if (stockCheck.length === 0 || stockCheck[0].quantity < qty) {
                return res.status(400).json({ error: 'Insufficient stock at supplier.' });
            }
            console.log(`[RESTOCK DEBUG] Updating supplier stock...`);
            await pool.execute('UPDATE supplier_stock SET quantity = quantity - ? WHERE supplierID = ? AND medicineID = ?', [qty, srcID, medicineID]);
            console.log(`[RESTOCK DEBUG] Inserting/updating pharmacy stock...`);
            await pool.execute(`
                INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity) 
                VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?
            `, [pharmacyID, medicineID, qty, qty]);
            console.log(`[RESTOCK DEBUG] Inserting into supplier_orders...`);
            const [result] = await pool.execute('INSERT INTO supplier_orders (pharmacyID, medicineID, quantity, supplierID, status) VALUES (?, ?, ?, ?, "delivered")', [pharmacyID, medicineID, qty, srcID]);
            console.log(`[RESTOCK DEBUG] Restock from supplier complete.`);
            res.json({ message: 'Stock successfully restocked from supplier.', orderID: result.insertId });

        } else {
            console.log(`[RESTOCK DEBUG] Source type is other (backup supplier).`);
            // Infinite direct supplier order backup
            await pool.execute(`
                INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity) 
                VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?
            `, [pharmacyID, medicineID, qty, qty]);
            await pool.execute('INSERT INTO supplier_orders (pharmacyID, medicineID, quantity, status) VALUES (?, ?, ?, "delivered")', [pharmacyID, medicineID, qty]);
            console.log(`[RESTOCK DEBUG] Restock backup complete.`);
            res.json({ message: 'Stock increased via direct supplier order.' });
        }
    } catch (err) {
        console.error(`[RESTOCK DEBUG] Error encountered:`, err);
        handleDBError(err, res);
    }
});

// --- SUPPLIER DASHBOARD ENDPOINTS ---
app.post('/api/supplier/upload-csv', authenticateToken, authorizeRoles('supplier'), upload.single('csv_file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
    try {
        const content = fs.readFileSync(req.file.path, 'utf8');
        const lines = content.split(/\r?\n/);
        let count = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            if (i === 0 && (line.toLowerCase().includes('name') || line.toLowerCase().includes('medicine'))) continue;
            const parts = line.split(',');
            if (parts.length < 2) continue;
            const medName = parts[0].trim();
            const qty = parseInt(parts[1].trim(), 10);
            if (!medName || isNaN(qty)) continue;
            
            const price = (parts.length >= 3) ? parseFloat(parts[2].trim()) : 0.00;
            const priceVal = isNaN(price) ? 0.00 : price;
            
            let [meds] = await pool.execute('SELECT medicineID FROM medicines WHERE name = ?', [medName]);
            let medID;
            if (meds.length === 0) {
                const [insertResult] = await pool.execute('INSERT INTO medicines (name, used_for) VALUES (?, ?)', [medName, 'General']);
                medID = insertResult.insertId;
            } else {
                medID = meds[0].medicineID;
            }
            
            await pool.execute(`
                INSERT INTO supplier_stock (supplierID, medicineID, quantity, price_per_unit) 
                VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = ?, price_per_unit = ?
            `, [req.user.userID, medID, qty, priceVal, qty, priceVal]);
            count++;
        }
        fs.unlinkSync(req.file.path);
        res.json({ message: `CSV processed successfully. Uploaded/Updated ${count} stock items.` });
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/supplier/stock', authenticateToken, authorizeRoles('supplier'), async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT ss.*, m.name FROM supplier_stock ss 
            JOIN medicines m ON ss.medicineID = m.medicineID 
            WHERE ss.supplierID = ?
        `, [req.user.userID]);
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.patch('/api/supplier/stock', authenticateToken, authorizeRoles('supplier'), async (req, res) => {
    const { medicineID, quantity, price } = req.body;
    const qty = parseInt(quantity, 10);
    const prc = parseFloat(price);
    if (!medicineID || isNaN(qty) || qty < 0 || isNaN(prc) || prc < 0) {
        return res.status(400).json({ error: 'Invalid parameters: quantity and price must be non-negative numbers.' });
    }
    try {
        await pool.execute(
            'UPDATE supplier_stock SET quantity = ?, price_per_unit = ? WHERE supplierID = ? AND medicineID = ?',
            [qty, prc, req.user.userID, medicineID]
        );
        res.json({ message: 'Stock quantity and price updated successfully.' });
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/supplier/orders', authenticateToken, authorizeRoles('supplier'), async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT so.*, m.name as medicine_name, p.name as pharmacy_name 
            FROM supplier_orders so 
            JOIN medicines m ON so.medicineID = m.medicineID 
            JOIN pharmacies p ON so.pharmacyID = p.pharmacyID 
            WHERE so.supplierID = ?
        `, [req.user.userID]);
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/supplier/stats', authenticateToken, authorizeRoles('supplier'), async (req, res) => {
    try {
        const [[{ totalUnits }]] = await pool.execute('SELECT SUM(quantity) as totalUnits FROM supplier_orders WHERE supplierID = ?', [req.user.userID]);
        const [[{ totalOrders }]] = await pool.execute('SELECT COUNT(*) as totalOrders FROM supplier_orders WHERE supplierID = ?', [req.user.userID]);
        const [[{ activeOrders }]] = await pool.execute('SELECT COUNT(*) as activeOrders FROM supplier_orders WHERE supplierID = ? AND status = "ordered"', [req.user.userID]);
        const [[{ lowStockCount }]] = await pool.execute('SELECT COUNT(*) as lowStockCount FROM supplier_stock WHERE supplierID = ? AND quantity <= 50', [req.user.userID]);
        
        const [lowStockList] = await pool.execute(`
            SELECT m.name, ss.quantity
            FROM supplier_stock ss
            JOIN medicines m ON ss.medicineID = m.medicineID
            WHERE ss.supplierID = ? AND ss.quantity <= 50
            ORDER BY ss.quantity ASC
        `, [req.user.userID]);

        const [topCustomers] = await pool.execute(`
            SELECT p.name as pharmacy_name, SUM(so.quantity) as totalUnits, COUNT(*) as orderCount
            FROM supplier_orders so
            JOIN pharmacies p ON so.pharmacyID = p.pharmacyID
            WHERE so.supplierID = ?
            GROUP BY so.pharmacyID, p.name
            ORDER BY totalUnits DESC
            LIMIT 5
        `, [req.user.userID]);

        const [dispatchHistory] = await pool.execute(`
            SELECT DATE_FORMAT(order_date, '%Y-%m-%d') as date, SUM(quantity) as units, COUNT(*) as count
            FROM supplier_orders
            WHERE supplierID = ? AND order_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            GROUP BY DATE_FORMAT(order_date, '%Y-%m-%d')
            ORDER BY date ASC
        `, [req.user.userID]);

        const [topMeds] = await pool.execute(`
            SELECT m.name, SUM(so.quantity) as totalQty 
            FROM supplier_orders so JOIN medicines m ON so.medicineID = m.medicineID 
            WHERE so.supplierID = ? 
            GROUP BY so.medicineID, m.name ORDER BY totalQty DESC LIMIT 5
        `, [req.user.userID]);

        res.json({
            totalUnits: Number(totalUnits) || 0,
            totalOrders: Number(totalOrders) || 0,
            activeOrders: Number(activeOrders) || 0,
            lowStockCount: Number(lowStockCount) || 0,
            lowStockList,
            topCustomers: topCustomers.map(c => ({
                pharmacy_name: c.pharmacy_name,
                totalUnits: Number(c.totalUnits) || 0,
                orderCount: Number(c.orderCount) || 0
            })),
            dispatchHistory: dispatchHistory.map(d => ({
                date: d.date,
                units: Number(d.units) || 0,
                count: Number(d.count) || 0
            })),
            topMeds: topMeds.map(m => ({
                name: m.name,
                totalQty: Number(m.totalQty) || 0
            }))
        });
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/pharmacies/approved', authenticateToken, async (req, res) => {
    const { lat, lng } = req.query;
    try {
        if (lat && lng) {
            // HA VERSINE DISTANCE CALCULATION
            // Formula: 6371 * acos(cos(radians(lat)) * cos(radians(latitude)) * cos(radians(longitude) - radians(lng)) + sin(radians(lat)) * sin(radians(latitude)))
            const [rows] = await pool.query(`
                SELECT *, 
                (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) AS distance 
                FROM pharmacies 
                WHERE status = "approved" 
                ORDER BY distance ASC
            `, [lat, lng, lat]);
            return res.json(rows);
        }
        const [rows] = await pool.query('SELECT pharmacyID, name, location, latitude, longitude FROM pharmacies WHERE status = "approved"');
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

// --- UNIFIED PROPOSAL SYSTEM (Uber-like Economy) ---

const calculateSystemRating = (price, medicineID) => {
    // Mock logic: In a real system, compare to average market prices
    // Higher price for patient = Excellent for Pharmacy, Poor for Patient
    // Lower price for pharmacist from supplier = Excellent for Pharmacist
    return 'good'; 
};

app.post('/api/proposals', authenticateToken, async (req, res) => {
    const { type, responderID, medicineID, quantity, proposed_price, initiatorID } = req.body;
    const qty = parseInt(quantity, 10);
    const price = parseFloat(proposed_price);
    
    if (!type || isNaN(qty) || isNaN(price) || !responderID || !medicineID) {
        return res.status(400).json({ error: 'Missing or invalid proposal data' });
    }

    try {
        let finalInitiatorID = initiatorID;
        
        if (type === 'patient_to_pharma') {
            const [patient] = await pool.execute('SELECT patientID FROM patients WHERE userID = ?', [req.user.userID]);
            if (patient.length === 0) return res.status(403).json({ error: 'Patient profile required' });
            finalInitiatorID = patient[0].patientID;
        } else if (type === 'pharma_to_supplier') {
            const [pharma] = await pool.execute('SELECT pharmacyID FROM pharmacies WHERE ownerID = ? AND pharmacyID = ?', [req.user.userID, initiatorID]);
            if (pharma.length === 0) return res.status(403).json({ error: 'Pharmacy ownership verification failed' });
        }

        const systemRating = calculateSystemRating(price, medicineID);

        const [result] = await pool.execute(`
            INSERT INTO proposals (type, initiatorID, responderID, medicineID, quantity, proposed_price, system_rating, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [type, finalInitiatorID, responderID, medicineID, qty, price, systemRating]);

        res.status(201).json({ message: 'Proposal transmitted successfully', proposalID: result.insertId, systemRating });
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/proposals/active', authenticateToken, async (req, res) => {
    try {
        let query = '';
        let params = [];

        if (req.user.role === 'patient') {
            query = `
                SELECT pr.*, m.name as medicine_name, p.name as pharmacy_name 
                FROM proposals pr
                JOIN medicines m ON pr.medicineID = m.medicineID
                JOIN pharmacies p ON pr.responderID = p.pharmacyID
                JOIN patients pat ON pr.initiatorID = pat.patientID
                WHERE pat.userID = ? AND pr.type = 'patient_to_pharma'
                ORDER BY pr.created_at DESC
            `;
            params = [req.user.userID];
        } else if (req.user.role === 'pharmacist') {
            query = `
                SELECT pr.*, m.name as medicine_name, 
                CASE 
                    WHEN pr.type = 'patient_to_pharma' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM patients WHERE patientID = pr.initiatorID)
                    WHEN pr.type = 'pharma_to_supplier' THEN (SELECT username FROM users WHERE userID = pr.responderID)
                END as party_name,
                p.name as pharmacy_name
                FROM proposals pr
                JOIN medicines m ON pr.medicineID = m.medicineID
                JOIN pharmacies p ON (pr.type = 'patient_to_pharma' AND pr.responderID = p.pharmacyID) OR (pr.type = 'pharma_to_supplier' AND pr.initiatorID = p.pharmacyID)
                WHERE p.ownerID = ?
                ORDER BY pr.created_at DESC
            `;
            params = [req.user.userID];
        } else if (req.user.role === 'supplier') {
            query = `
                SELECT pr.*, m.name as medicine_name, p.name as pharmacy_name
                FROM proposals pr
                JOIN medicines m ON pr.medicineID = m.medicineID
                JOIN pharmacies p ON pr.initiatorID = p.pharmacyID
                WHERE pr.responderID = ? AND pr.type = 'pharma_to_supplier'
                ORDER BY pr.created_at DESC
            `;
            params = [req.user.userID];
        }

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.patch('/api/proposals/:id/resolve', authenticateToken, async (req, res) => {
    const { action } = req.body; // 'accepted' or 'rejected'
    const proposalID = req.params.id;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [proposalRows] = await connection.execute('SELECT * FROM proposals WHERE proposalID = ? AND status = "pending"', [proposalID]);
        if (proposalRows.length === 0) throw new Error('Proposal not found or already resolved');
        const pr = proposalRows[0];

        // VERIFY RESPONDER PERMISSION
        if (pr.type === 'patient_to_pharma') {
            const [pharma] = await connection.execute('SELECT ownerID FROM pharmacies WHERE pharmacyID = ?', [pr.responderID]);
            if (pharma[0].ownerID !== req.user.userID) throw new Error('Unauthorized resolution');
        } else if (pr.type === 'pharma_to_supplier') {
            if (pr.responderID !== req.user.userID) throw new Error('Unauthorized resolution');
        }

        if (action === 'accepted') {
            if (pr.type === 'patient_to_pharma') {
                // Check pharmacy stock
                const [stock] = await connection.execute('SELECT quantity FROM pharmacy_medicines WHERE pharmacyID = ? AND medicineID = ?', [pr.responderID, pr.medicineID]);
                if (!stock.length || stock[0].quantity < pr.quantity) throw new Error('Insufficient stock for acceptance');
                
                await connection.execute('UPDATE pharmacy_medicines SET quantity = quantity - ? WHERE pharmacyID = ? AND medicineID = ?', [pr.quantity, pr.responderID, pr.medicineID]);
                await connection.execute('INSERT INTO orders (proposalID, patientID, medicineID, pharmacyID, final_cost) VALUES (?, ?, ?, ?, ?)', [proposalID, pr.initiatorID, pr.medicineID, pr.responderID, pr.proposed_price * pr.quantity]);
            } else {
                // Check supplier stock
                const [stock] = await connection.execute('SELECT quantity FROM supplier_stock WHERE supplierID = ? AND medicineID = ?', [pr.responderID, pr.medicineID]);
                if (!stock.length || stock[0].quantity < pr.quantity) throw new Error('Insufficient supply for acceptance');

                await connection.execute('UPDATE supplier_stock SET quantity = quantity - ? WHERE supplierID = ? AND medicineID = ?', [pr.quantity, pr.responderID, pr.medicineID]);
                await connection.execute('INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?', [pr.initiatorID, pr.medicineID, pr.quantity, pr.quantity]);
                await connection.execute('INSERT INTO supplier_orders (proposalID, pharmacyID, medicineID, quantity, supplierID) VALUES (?, ?, ?, ?, ?)', [proposalID, pr.initiatorID, pr.medicineID, pr.quantity, pr.responderID]);
            }
        }

        await connection.execute('UPDATE proposals SET status = ? WHERE proposalID = ?', [action, proposalID]);
        
        await connection.commit();
        res.json({ message: `Proposal ${action} successfully` });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.patch('/api/orders/:id/rate', authenticateToken, async (req, res) => {
    if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Forbidden: Only patient accounts can rate requests.' });
    }
    const { rating } = req.body;
    const parsedRating = parseInt(rating, 10);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
        return res.status(400).json({ error: 'Invalid rating. Must be between 1 and 5 stars.' });
    }
    try {
        const [patients] = await pool.execute('SELECT patientID FROM patients WHERE userID = ?', [req.user.userID]);
        if (patients.length === 0) return res.status(400).json({ error: 'Profile not found' });

        const [order] = await pool.execute('SELECT orderID, status FROM orders WHERE orderID = ? AND patientID = ?', [req.params.id, patients[0].patientID]);
        if (order.length === 0) return res.status(404).json({ error: 'Order not found or access denied.' });
        if (order[0].status !== 'completed') return res.status(400).json({ error: 'Cannot rate a pending request.' });

        await pool.execute('UPDATE orders SET rating = ? WHERE orderID = ?', [parsedRating, req.params.id]);
        res.json({ message: 'Rating submitted successfully.' });
    } catch (err) { handleDBError(err, res); }
});

// --- ADMIN SYSTEM CONTROLS ---
app.get('/api/admin/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT userID, username, email, role, status FROM users');
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.put('/api/admin/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const targetUserID = Number(req.params.id);
        const { username, email, role, status } = req.body;
        if (!username || !role || !status) {
            return res.status(400).json({ error: 'Missing required fields: username, role, status' });
        }
        if (targetUserID === req.user.userID) {
            if (role !== 'admin' || status !== 'approved') {
                return res.status(400).json({ error: 'System restriction: You cannot demote or suspend your own admin account.' });
            }
        }
        await pool.execute(
            'UPDATE users SET username = ?, email = ?, role = ?, status = ? WHERE userID = ?',
            [username, email || null, role, status, targetUserID]
        );
        res.json({ message: 'User details updated successfully' });
    } catch (err) { handleDBError(err, res); }
});

app.delete('/api/admin/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const targetUserID = Number(req.params.id);
        if (targetUserID === req.user.userID) {
            return res.status(400).json({ error: 'System restriction: Admin cannot delete their own account.' });
        }
        await pool.execute('DELETE FROM users WHERE userID = ?', [targetUserID]);
        res.json({ message: 'User deleted successfully' });
    } catch (err) { handleDBError(err, res); }
});


app.get('/api/admin/pending-users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT u.userID, u.username, u.email, u.role, p.degree_path, p.cv_path 
            FROM users u 
            JOIN pharmacists p ON u.userID = p.userID 
            WHERE u.status = "pending" AND u.role = "pharmacist"
        `);
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/admin/pending-suppliers', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT userID, username, email, role, status FROM users WHERE status = "pending" AND role = "supplier"');
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.post('/api/admin/verify-user', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const { userID, action } = req.body;
        await pool.execute('UPDATE users SET status = ? WHERE userID = ?', [action, userID]);
        res.json({ message: `User status updated: ${action}` });
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/admin/pending-pharmacies', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT p.*, u.username as owner_name FROM pharmacies p JOIN users u ON p.ownerID = u.userID WHERE p.status = "pending"');
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

app.post('/api/admin/verify-pharmacy', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const { pharmacyID, action } = req.body;
        await pool.execute('UPDATE pharmacies SET status = ? WHERE pharmacyID = ?', [action, pharmacyID]);
        res.json({ message: `Pharmacy ${action}` });
    } catch (err) { handleDBError(err, res); }
});

app.post('/api/pharmacies', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    try {
        const [allPharmacies] = await pool.execute('SELECT status FROM pharmacies WHERE ownerID = ?', [req.user.userID]);
        const pendingCount = allPharmacies.filter(p => p.status === 'pending').length;

        if (pendingCount >= 3) {
            return res.status(400).json({ error: 'System violation: You can only have up to 3 proposed pharmacies pending approval.' });
        }

        await pool.execute('INSERT INTO pharmacies (ownerID, name, location, supplier_company, status, photo_path) VALUES (?, ?, ?, ?, "pending", NULL)', 
            [req.user.userID, req.body.name || null, req.body.location || null, req.body.supplier_company || null]);
        res.status(201).json({ message: 'Pharmacy suggested' });
    } catch (err) { handleDBError(err, res); }
});

app.get('/api/medicines', authenticateToken, async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM medicines ORDER BY name ASC, general_expiry_date ASC');
    res.json(rows);
});

app.post('/api/medicines', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    const { name, used_for, general_expiry_date } = req.body;
    try {
        await pool.execute(
            'INSERT INTO medicines (name, used_for, general_expiry_date) VALUES (?, ?, ?)',
            [name || null, used_for || null, general_expiry_date || null]
        );
        res.status(201).json({ message: 'Medicine added to catalog.' });
    } catch (err) { handleDBError(err, res); }
});

// --- NOTIFICATIONS ---
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const notifications = [];
        
        if (req.user.role === 'admin') {
            const [[{ count: pendingUsers }]] = await pool.execute('SELECT COUNT(*) as count FROM users WHERE status = "pending"');
            if (pendingUsers > 0) {
                notifications.push({ message: `${pendingUsers} account(s) pending verification.`, link: 'admin_users' });
            }
            const [[{ count: pendingPharmacies }]] = await pool.execute('SELECT COUNT(*) as count FROM pharmacies WHERE status = "pending"');
            if (pendingPharmacies > 0) {
                notifications.push({ message: `${pendingPharmacies} pharmacy suggestion(s) pending verification.`, link: 'admin_pharma' });
            }
        }
        
        else if (req.user.role === 'pharmacist') {
            const [[{ count: pendingOrders }]] = await pool.execute('SELECT COUNT(*) as count FROM orders WHERE status = "pending"');
            if (pendingOrders > 0) {
                notifications.push({ message: `${pendingOrders} patient request(s) waiting for quotes.`, link: 'orders' });
            }
        }
        
        else if (req.user.role === 'patient') {
            const [patientRecord] = await pool.execute('SELECT patientID FROM patients WHERE userID = ?', [req.user.userID]);
            if (patientRecord.length > 0) {
                const [[{ count: completedOrders }]] = await pool.execute('SELECT COUNT(*) as count FROM orders WHERE patientID = ? AND status = "completed" AND order_date >= NOW() - INTERVAL 1 DAY', [patientRecord[0].patientID]);
                if (completedOrders > 0) {
                    notifications.push({ message: `${completedOrders} request(s) completed recently.`, link: 'myOrders' });
                }
            }
        }
        
        else if (req.user.role === 'supplier') {
            const [[{ count: supplierOrders }]] = await pool.execute('SELECT COUNT(*) as count FROM supplier_orders WHERE supplierID = ? AND status = "ordered"', [req.user.userID]);
            if (supplierOrders > 0) {
                notifications.push({ message: `${supplierOrders} pharmacy stock order(s) received.`, link: 'supplier_sales' });
            }
        }
        
        res.json(notifications);
    } catch (err) { handleDBError(err, res); }
});

// --- NEW ENDPOINTS FOR EXPIRED DISPOSAL, SUPPLIER-PHARMACIST PROPOSALS, AND COMPLAINTS ---

// 1. Disposal endpoint
app.post('/api/pharmacist/dispose', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    const { pharmacyID, medicineID } = req.body;
    if (!pharmacyID || !medicineID) {
        return res.status(400).json({ error: 'Missing pharmacyID or medicineID' });
    }
    try {
        const [pharmaCheck] = await pool.execute('SELECT ownerID FROM pharmacies WHERE pharmacyID = ?', [pharmacyID]);
        if (pharmaCheck.length === 0 || pharmaCheck[0].ownerID !== req.user.userID) {
            return res.status(403).json({ error: 'Violation: You do not own this pharmacy.' });
        }
        await pool.execute('DELETE FROM pharmacy_medicines WHERE pharmacyID = ? AND medicineID = ?', [pharmacyID, medicineID]);
        res.json({ message: 'Medicine disposed successfully' });
    } catch (err) { handleDBError(err, res); }
});

// 2. Approved suppliers listing
app.get('/api/suppliers/approved', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT userID as supplierID, username as name FROM users WHERE role = "supplier" AND status = "approved"');
        res.json(rows);
    } catch (err) { handleDBError(err, res); }
});

// 3. Proposal submission endpoint
app.post('/api/proposals', authenticateToken, async (req, res) => {
    const { pharmacyID, supplierID, medicineID, quantity, proposed_price } = req.body;
    const qty = parseInt(quantity, 10);
    const price = parseFloat(proposed_price);
    
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0 || !pharmacyID || !supplierID || !medicineID) {
        return res.status(400).json({ error: 'Invalid or missing fields' });
    }
    
    try {
        if (req.user.role === 'pharmacist') {
            const [pharmaCheck] = await pool.execute('SELECT ownerID FROM pharmacies WHERE pharmacyID = ?', [pharmacyID]);
            if (pharmaCheck.length === 0 || pharmaCheck[0].ownerID !== req.user.userID) {
                return res.status(403).json({ error: 'Forbidden: You do not own this pharmacy.' });
            }
            await pool.execute(`
                INSERT INTO supplier_proposals (pharmacyID, supplierID, medicineID, quantity, proposed_price, created_by, status)
                VALUES (?, ?, ?, ?, ?, 'pharmacist', 'pending')
            `, [pharmacyID, supplierID, medicineID, qty, price]);
            return res.status(201).json({ message: 'Restock proposal sent to supplier.' });
        } else if (req.user.role === 'supplier') {
            if (parseInt(supplierID, 10) !== req.user.userID) {
                return res.status(403).json({ error: 'Forbidden: Cannot propose on behalf of other suppliers.' });
            }
            await pool.execute(`
                INSERT INTO supplier_proposals (pharmacyID, supplierID, medicineID, quantity, proposed_price, created_by, status)
                VALUES (?, ?, ?, ?, ?, 'supplier', 'pending')
            `, [pharmacyID, supplierID, medicineID, qty, price]);
            return res.status(201).json({ message: 'Supply proposal sent to pharmacy.' });
        } else {
            return res.status(403).json({ error: 'Forbidden: Only pharmacists and suppliers can make proposals.' });
        }
    } catch (err) { handleDBError(err, res); }
});

// 4. Proposals retrieval
app.get('/api/proposals', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'pharmacist') {
            const [proposals] = await pool.execute(`
                SELECT sp.*, p.name as pharmacy_name, m.name as medicine_name, u.username as supplier_name
                FROM supplier_proposals sp
                JOIN pharmacies p ON sp.pharmacyID = p.pharmacyID
                JOIN medicines m ON sp.medicineID = m.medicineID
                JOIN users u ON sp.supplierID = u.userID
                WHERE p.ownerID = ?
                ORDER BY sp.created_at DESC
            `, [req.user.userID]);
            res.json(proposals);
        } else if (req.user.role === 'supplier') {
            const [proposals] = await pool.execute(`
                SELECT sp.*, p.name as pharmacy_name, m.name as medicine_name, u.username as supplier_name
                FROM supplier_proposals sp
                JOIN pharmacies p ON sp.pharmacyID = p.pharmacyID
                JOIN medicines m ON sp.medicineID = m.medicineID
                JOIN users u ON sp.supplierID = u.userID
                WHERE sp.supplierID = ?
                ORDER BY sp.created_at DESC
            `, [req.user.userID]);
            res.json(proposals);
        } else {
            return res.status(403).json({ error: 'Forbidden: Only pharmacists and suppliers have proposals.' });
        }
    } catch (err) { handleDBError(err, res); }
});

// 5. Update proposal status
app.patch('/api/proposals/:id/status', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (status !== 'approved' && status !== 'rejected') {
        return res.status(400).json({ error: 'Invalid status. Must be approved or rejected.' });
    }
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const [proposals] = await connection.execute('SELECT * FROM supplier_proposals WHERE proposalID = ?', [id]);
        if (proposals.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Proposal not found' });
        }
        
        const proposal = proposals[0];
        if (proposal.status !== 'pending') {
            await connection.rollback();
            return res.status(400).json({ error: 'Proposal is already resolved.' });
        }
        
        if (proposal.created_by === 'supplier') {
            const [pharmaCheck] = await connection.execute('SELECT ownerID FROM pharmacies WHERE pharmacyID = ?', [proposal.pharmacyID]);
            if (pharmaCheck.length === 0 || pharmaCheck[0].ownerID !== req.user.userID) {
                await connection.rollback();
                return res.status(403).json({ error: 'Forbidden: You do not own the destination pharmacy for this proposal.' });
            }
        } else {
            if (req.user.role !== 'supplier' || proposal.supplierID !== req.user.userID) {
                await connection.rollback();
                return res.status(403).json({ error: 'Forbidden: Only the targeted supplier can resolve this proposal.' });
            }
        }
        
        if (status === 'approved') {
            const [stockCheck] = await connection.execute(
                'SELECT quantity FROM supplier_stock WHERE supplierID = ? AND medicineID = ?',
                [proposal.supplierID, proposal.medicineID]
            );
            if (stockCheck.length === 0 || stockCheck[0].quantity < proposal.quantity) {
                await connection.rollback();
                return res.status(400).json({ error: 'Insufficient stock in supplier\'s inventory.' });
            }
            
            await connection.execute(
                'UPDATE supplier_stock SET quantity = quantity - ? WHERE supplierID = ? AND medicineID = ?',
                [proposal.quantity, proposal.supplierID, proposal.medicineID]
            );
            
            await connection.execute(`
                INSERT INTO pharmacy_medicines (pharmacyID, medicineID, quantity, price_per_unit) 
                VALUES (?, ?, ?, ?) 
                ON DUPLICATE KEY UPDATE quantity = quantity + ?
            `, [proposal.pharmacyID, proposal.medicineID, proposal.quantity, proposal.proposed_price, proposal.quantity]);
            
            await connection.execute(
                'INSERT INTO supplier_orders (pharmacyID, medicineID, quantity, supplierID, status) VALUES (?, ?, ?, ?, "delivered")',
                [proposal.pharmacyID, proposal.medicineID, proposal.quantity, proposal.supplierID]
            );
        }
        
        await connection.execute('UPDATE supplier_proposals SET status = ? WHERE proposalID = ?', [status, id]);
        
        await connection.commit();
        res.json({ message: `Proposal ${status} successfully.` });
    } catch (err) {
        await connection.rollback();
        handleDBError(err, res);
    } finally {
        connection.release();
    }
});

// 6. Submit patient complaint
app.post('/api/complaints', authenticateToken, async (req, res) => {
    if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Forbidden: Only patient accounts can file complaints.' });
    }
    const { pharmacyID, orderID, subject, details } = req.body;
    if (!subject || !details) {
        return res.status(400).json({ error: 'Subject and details are required' });
    }
    try {
        const [patients] = await pool.execute('SELECT patientID FROM patients WHERE userID = ?', [req.user.userID]);
        if (patients.length === 0) return res.status(400).json({ error: 'Profile not found' });
        const patientID = patients[0].patientID;
        
        let finalPharmacyID = pharmacyID || null;
        if (orderID && !finalPharmacyID) {
            const [orders] = await pool.execute('SELECT pharmacyID FROM orders WHERE orderID = ?', [orderID]);
            if (orders.length > 0) {
                finalPharmacyID = orders[0].pharmacyID;
            }
        }
        
        await pool.execute(
            'INSERT INTO complaints (patientID, pharmacyID, orderID, subject, details, status) VALUES (?, ?, ?, ?, ?, "pending")',
            [patientID, finalPharmacyID, orderID || null, subject, details]
        );
        res.status(201).json({ message: 'Complaint submitted successfully' });
    } catch (err) { handleDBError(err, res); }
});

// 7. Get complaints list
app.get('/api/complaints', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'patient') {
            const [patients] = await pool.execute('SELECT patientID FROM patients WHERE userID = ?', [req.user.userID]);
            if (patients.length === 0) return res.status(400).json({ error: 'Profile not found' });
            const patientID = patients[0].patientID;
            
            const [rows] = await pool.execute(`
                SELECT c.*, p.name as pharmacy_name, m.name as medicine_name, o.order_date
                FROM complaints c
                LEFT JOIN pharmacies p ON c.pharmacyID = p.pharmacyID
                LEFT JOIN orders o ON c.orderID = o.orderID
                LEFT JOIN medicines m ON o.medicineID = m.medicineID
                WHERE c.patientID = ?
                ORDER BY c.created_at DESC
            `, [patientID]);
            return res.json(rows);
        } else if (req.user.role === 'pharmacist') {
            const [rows] = await pool.execute(`
                SELECT c.*, p.name as pharmacy_name, m.name as medicine_name, o.order_date, u.username as patient_username
                FROM complaints c
                JOIN pharmacies p ON c.pharmacyID = p.pharmacyID
                LEFT JOIN orders o ON c.orderID = o.orderID
                LEFT JOIN medicines m ON o.medicineID = m.medicineID
                JOIN patients pat ON c.patientID = pat.patientID
                JOIN users u ON pat.userID = u.userID
                WHERE p.ownerID = ?
                ORDER BY c.created_at DESC
            `, [req.user.userID]);
            return res.json(rows);
        } else if (req.user.role === 'admin') {
            const [rows] = await pool.execute(`
                SELECT c.*, p.name as pharmacy_name, m.name as medicine_name, o.order_date, u.username as patient_username
                FROM complaints c
                LEFT JOIN pharmacies p ON c.pharmacyID = p.pharmacyID
                LEFT JOIN orders o ON c.orderID = o.orderID
                LEFT JOIN medicines m ON o.medicineID = m.medicineID
                JOIN patients pat ON c.patientID = pat.patientID
                JOIN users u ON pat.userID = u.userID
                ORDER BY c.created_at DESC
            `);
            return res.json(rows);
        } else {
            return res.status(403).json({ error: 'Forbidden' });
        }
    } catch (err) { handleDBError(err, res); }
});

// 8. Resolve complaint
app.patch('/api/complaints/:id/resolve', authenticateToken, async (req, res) => {
    const { id } = req.params;
    if (req.user.role !== 'pharmacist' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        if (req.user.role === 'pharmacist') {
            const [complaints] = await pool.execute(`
                SELECT c.pharmacyID FROM complaints c 
                JOIN pharmacies p ON c.pharmacyID = p.pharmacyID 
                WHERE c.complaintID = ? AND p.ownerID = ?
            `, [id, req.user.userID]);
            if (complaints.length === 0) {
                return res.status(403).json({ error: 'Forbidden: You do not own the pharmacy this complaint was filed against.' });
            }
        }
        await pool.execute('UPDATE complaints SET status = "resolved" WHERE complaintID = ?', [id]);
        res.json({ message: 'Complaint marked as resolved' });
    } catch (err) { handleDBError(err, res); }
});

app.post('/api/orders/:id/undo', authenticateToken, authorizeRoles('patient'), async (req, res) => {
    try {
        const orderID = req.params.id;
        const [orders] = await pool.execute('SELECT * FROM orders WHERE orderID = ?', [orderID]);
        if (orders.length === 0) return res.status(404).json({ error: 'Order not found' });
        const o = orders[0];
        
        const [patients] = await pool.execute('SELECT patientID FROM patients WHERE userID = ?', [req.user.userID]);
        if (patients.length === 0 || patients[0].patientID !== o.patientID) {
            return res.status(403).json({ error: 'Forbidden: You do not own this order.' });
        }

        if (o.status === 'completed' && o.pharmacyID) {
            await pool.execute('UPDATE pharmacy_medicines SET quantity = quantity + 1 WHERE pharmacyID = ? AND medicineID = ?', [o.pharmacyID, o.medicineID]);
        }
        await pool.execute('DELETE FROM orders WHERE orderID = ?', [orderID]);
        res.json({ message: 'Order undone successfully' });
    } catch (err) { handleDBError(err, res); }
});

app.post('/api/pharmacist/restock/:id/undo', authenticateToken, authorizeRoles('pharmacist'), async (req, res) => {
    try {
        const orderID = req.params.id;
        const [orders] = await pool.execute('SELECT * FROM supplier_orders WHERE sOrderID = ?', [orderID]);
        if (orders.length === 0) return res.status(404).json({ error: 'Restock order not found' });
        const o = orders[0];

        const [pharmacy] = await pool.execute('SELECT ownerID FROM pharmacies WHERE pharmacyID = ?', [o.pharmacyID]);
        if (pharmacy.length === 0 || pharmacy[0].ownerID !== req.user.userID) {
            return res.status(403).json({ error: 'Forbidden: You do not own this pharmacy.' });
        }

        if (o.supplierPharmacyID) {
            await pool.execute('UPDATE pharmacy_medicines SET quantity = quantity + ? WHERE pharmacyID = ? AND medicineID = ?', [o.quantity, o.supplierPharmacyID, o.medicineID]);
        } else if (o.supplierID) {
            await pool.execute('UPDATE supplier_stock SET quantity = quantity + ? WHERE supplierID = ? AND medicineID = ?', [o.quantity, o.supplierID, o.medicineID]);
        }

        await pool.execute('UPDATE pharmacy_medicines SET quantity = quantity - ? WHERE pharmacyID = ? AND medicineID = ?', [o.quantity, o.pharmacyID, o.medicineID]);
        await pool.execute('DELETE FROM supplier_orders WHERE sOrderID = ?', [orderID]);
        res.json({ message: 'Restock undone successfully' });
    } catch (err) { handleDBError(err, res); }
});

const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    // HTTPS MODE
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };
    https.createServer(httpsOptions, app).listen(PORT, () => {
        console.log(`\x1b[36m[SECURE] Pharma-Cure Clinical Network LIVE on https://localhost:${PORT}\x1b[0m`);
    });
} else {
    // HTTP FALLBACK MODE (For easier client deployment)
    http.createServer(app).listen(PORT, () => {
        console.log(`\x1b[33m[DEVELOPMENT] SSL Certificates not found. Pharma-Cure running on http://localhost:${PORT}\x1b[0m`);
        console.log(`\x1b[33m[HINT] For production security, mount key.pem and cert.pem to the container.\x1b[0m`);
    });
}


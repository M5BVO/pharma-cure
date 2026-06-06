# Testing Data Suite // PHARMA-CORE V3.2

This directory contains pre-configured dataset components designed to test the features introduced in PHARMA-CORE V3.2.

## Folder Contents

1. **`seed_test_scenario.sql`**: A complete SQL database seeding script. It creates:
   - Approved and pending users across all roles (Admin, Pharmacist, Patient, Supplier).
   - Mock medicines catalog with categories and varying expiry dates (expired, expiring soon, valid).
   - Approved pharmacies and pending pharmacist-suggested pharmacies awaiting admin verification.
   - Initial local stock configurations containing expired and warning-level quantities.
   - Open pending patient order requests.
2. **`supplier_stock.csv`**: A CSV stock file containing 6 medicine stock rows to test the drag-and-drop file upload feature in the Supplier Dashboard.

---

## Instructions for Execution

### Step 1: Run the Database Seeder
To load the testing database scenario, run the SQL script in your MySQL shell:
```bash
mysql -u mask -pMosaayyad1 pharmacyManagement < "Testing Data/seed_test_scenario.sql"
```

### Step 2: Accessing Accounts
Once seeded, you can test different interface elements using these default accounts:

| Username | Password | Role | Account Status | Use Case / Test Flow |
| :--- | :--- | :--- | :--- | :--- |
| `admin` | `Admin@123` | Admin | Approved | Approve pending suppliers (`MegaPharma`), pending pharmacist suggestions (`Mega Cure Pharmacy`), and view global logs. |
| `Bahfos` | `123` | Pharmacist | Approved | Access stock control, view color-coded expiration flags, purchase restocks, and complete patient orders. |
| `DrRx` | `123` | Pharmacist | Pending | Test the admin's approval queue for pharmacists. |
| `MegaPharma` | `123` | Supplier | Pending | Test the admin's approval queue for suppliers. |
| `GlobalMeds` | `123` | Supplier | Approved | Log in, view current stock, and drag-and-drop the `supplier_stock.csv` file to import stock levels. |
| `PatientAlice` | `123` | Patient | Approved | Update profile chronic details, submit new orders, and view delivery updates. |

### Step 3: Test CSV Stock Upload
1. Log in as approved supplier `GlobalMeds` (Password: `123`).
2. Go to **My Stock** tab.
3. Drag and drop the `Testing Data/supplier_stock.csv` file into the drag-drop zone (or click to browse).
4. Verify that stock counts update automatically on screen.

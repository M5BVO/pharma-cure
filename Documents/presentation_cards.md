# Pharma-Cure V4: Presentation Flash Cards

These cards are designed for your project defense. Each card focuses on a single core concept with a "TV Presenter" style: Title on the front, concise bullet points and a simple diagram on the back.

---

## CARD 1: DOCKER - THE "SOFTWARE SHIPPING CONTAINER"

**[FRONT: CONCEPT OVERVIEW]**
"Doctor, imagine trying to move a house by carrying every individual brick. Docker is the cargo ship that carries the whole house at once."

**[BACK: HOW IT WORKS]**
*   **Encapsulation:** We pack the Code, the Server, and the Database instructions into one "Container."
*   **Isolation:** The app runs in its own private world. It doesn't care if you have Windows, Mac, or Linux.
*   **Reproducibility:** "It works on my machine" is a thing of the past. If it runs in Docker, it runs everywhere.
*   **Automatic Bootstrapping:** Our Docker image automatically detects if the database is missing and sets up the entire V4 schema on its first breath.

**[DIAGRAM: THE DOCKER STACK]**
```
[ YOUR APP ]  <-- (The Code)
[ RUNTIME  ]  <-- (Node.js)
[ OS LAYER ]  <-- (Alpine Linux)
--------------------------------
[ DOCKER ENGINE ]
--------------------------------
[ YOUR COMPUTER ]
```

---

## CARD 2: THE ENTITY RELATIONSHIP MODEL (ERD)

**[FRONT: DATA INTEGRITY]**
"Pharma-Cure V4 is built on a Relational Core. We don't just store data; we map the connections between clinical actors."

**[BACK: THE CORE TABLES]**
*   **Users:** The security gatekeeper (Admin, Pharmacist, Patient, Supplier).
*   **Patients/Pharmacies:** The "Physical" entities. Linked by Geolocation (Lat/Lng).
*   **Medicines:** The global catalog shared by everyone.
*   **Proposals:** The "Brain" of the system. This replaces static orders with dynamic negotiations.

**[DIAGRAM: THE RELATIONSHIP MAP]**
```
[ PATIENT ] <---- (Proposes) ----> [ PHARMACY ]
    |                                 ^
    |                                 |
(Coordinates)                    (Proposes)
    |                                 |
    v                                 v
[ GEOLOCATION ]                 [ SUPPLIER ]
```

---

## CARD 3: THE PROPOSAL ECONOMY (THE "UBER" MODEL)

**[FRONT: ECONOMIC INNOVATION]**
"We have moved beyond the 'Price List.' In V4, every transaction is a handshake."

**[BACK: TRANSACTION FLOW]**
*   **Dynamic Bidding:** Instead of fixed prices, Patients offer a bid.
*   **Market Freedom:** Pharmacists can Accept or Decline based on their current stock and margin.
*   **Supply Chain Restock:** Pharmacists use the same model to bid for stock from Global Suppliers.
*   **System Rating:** The system analyzes the bid vs. market averages and tells the Pharmacist: "This is an [Excellent] deal."

---

## CARD 4: THE GEOLOCATION ENGINE

**[FRONT: SPATIAL INTELLIGENCE]**
"Pharma-Cure V4 doesn't just manage stock; it manages distance."

**[BACK: HOW IT WORKS]**
*   **Precision:** Every Patient and Pharmacy has a coordinate (8 decimal precision).
*   **Haversine Logic:** The system uses the Haversine formula (spherical trigonometry) to calculate "as-the-crow-flies" distance.
*   **Optimized Discovery:** When a patient needs medicine, the system automatically ranks pharmacies by **proximity**, not just price.

**[DIAGRAM: THE SEARCH RADIUS]**
```
( Patient ) --------> [ Pharmacy A (2km) ] <-- BEST MATCH
            --------> [ Pharmacy B (15km) ]
            --------> [ Pharmacy C (50km) ]
```

---

## HONORABLE MENTIONS (Technical Highlights)

*   **JWT Security:** Every clinical action is protected by JSON Web Tokens, ensuring stateless, secure communication between actors.
*   **Bcrypt Hashing:** Passwords are never stored in plain text. We utilize Salted Bcrypt Hashing, an industry-standard cryptographic safeguard.
*   **Vector Branding:** The entire system utilizes SVG-based architecture (including the Hermes staff logo), ensuring sharp, professional visuals on any display resolution without performance loss.
*   **Native Navigation:** A complete integration of the Browser History API, allowing clinical users to navigate the Single Page Application using standard browser controls.
*   **Automatic Bootstrapping:** The image features self-healing logic that automatically deploys the SQL schema if it detects an empty environment.

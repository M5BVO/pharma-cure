# Pharma-Cure // Clinical Network

[![Docker Support](https://img.shields.io/badge/Docker-Supported-blue.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg?logo=nodedotjs)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-GPL--3.0-yellow.svg)](LICENSE)

**Pharma-Cure** (formerly PharmaSync) is an advanced, geolocation-aware pharmacy management ecosystem. Designed for the modern clinical landscape, it implements a dynamic **Proposal-based Economy** where patients, pharmacists, and suppliers can negotiate prices and quantities in real-time.

---

## Developed By
- **Demma Al-kooz**
- **Mousa Ayyad**

---

## Features

- **Dynamic Inventory Management**: Real-time tracking of pharmaceutical stock.
- **Proposal-based Economy**: Negotiate prices and quantities efficiently.
- **Geolocation Awareness**: Map-based interactions between clinical actors.
- **Secure Authentication**: JWT-based clinical-grade security.
- **Automated Bootstrapping**: Self-healing database schema on startup.

---

## Docker Support

Pharma-Cure is fully containerized and ready for deployment.

### Quick Start with Docker Compose

1. **Clone the repository**:
   ```bash
   git clone git@github.com:M5BVO/pharma-cure.git
   cd pharma-cure
   ```

2. **Run with Docker Compose**:
   ```bash
   docker-compose up -d
   ```

The application will be available at `http://localhost:5000`.

### Manual Docker Build

```bash
docker build -t pharma-cure-app .
docker run -p 5000:5000 --env-file .env pharma-cure-app
```

---

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MySQL / MariaDB
- **Security**: JWT (JSON Web Tokens), Bcrypt.js
- **Deployment**: Docker, Nginx

---

## Setup and Installation

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables in `.env`:
   ```env
   PORT=5000
   DB_HOST=127.0.0.1
   DB_USER=root
   DB_PASSWORD=yourpassword
   DB_NAME=pharmacyManagement
   JWT_SECRET=your_secret_key
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

---

## License

This project is licensed under the GNU General Public License v3.0.

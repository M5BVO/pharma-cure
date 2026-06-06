# Use official lightweight Node.js base
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source (Includes server.js, public/, init.sql, assets/)
COPY . .

# Expose the application port
EXPOSE 5000

# DEFAULT CONFIGURATION
# These are used as fallbacks but can be overridden by docker-compose or -e flags
ENV DB_HOST=127.0.0.1
ENV DB_PORT=3306
ENV DB_USER=mask
ENV DB_PASSWORD=1984
ENV DB_NAME=pharmacyManagement
ENV PORT=5000
ENV JWT_SECRET=clinical_sync_secret_2026

# Start the server
# The server automatically bootstraps the database if it's empty
CMD [ "node", "server.js" ]

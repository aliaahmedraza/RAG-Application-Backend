# Corrected Dockerfile for Node.js API + Worker setup

# 1. Use lightweight Node.js
FROM node:18-alpine

# 2. Set working directory inside the container
WORKDIR /usr/src/app

# 3. Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --production

# 4. Copy application source code
COPY . .

# 5. Expose the port your API listens on
EXPOSE 3006

# 6. Default command: run both API + worker via your package.json scripts
CMD ["npm", "start"]

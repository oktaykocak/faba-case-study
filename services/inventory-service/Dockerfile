FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY services/inventory-service/package*.json ./

# Copy shared types
COPY shared/types /shared/types
WORKDIR /shared/types
RUN npm install && npm run build
WORKDIR /app

# Install dependencies
RUN npm install

# Link shared types
RUN npm link /shared/types

# Copy source code
COPY services/inventory-service/ .

# Build the application
RUN npm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Change ownership of the app directory
RUN chown -R nestjs:nodejs /app
USER nestjs

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

# Start the application
CMD ["node", "dist/main"]
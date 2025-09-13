#!/bin/bash

# Development setup script for e-commerce microservices
# This script helps set up the development environment without Docker

echo "🚀 Setting up E-commerce Microservices Development Environment"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

print_status "Node.js version: $(node -v) ✓"

# Install global dependencies
print_status "Installing global dependencies..."
npm install -g typescript ts-node nodemon

# Build shared types
print_status "Building shared types library..."
cd shared/types
npm install --no-package-lock
tsc || {
    print_warning "TypeScript compilation failed, creating manual dist"
    mkdir -p dist
    cp src/index.ts dist/index.js
}
cd ../..

# Install service dependencies
print_status "Installing Order Service dependencies..."
cd services/order-service
npm install --no-package-lock || print_warning "Order Service npm install had issues"
cd ../..

print_status "Installing Inventory Service dependencies..."
cd services/inventory-service
npm install --no-package-lock || print_warning "Inventory Service npm install had issues"
cd ../..

print_status "Installing Notification Service dependencies..."
cd services/notification-service
npm install --no-package-lock || print_warning "Notification Service npm install had issues"
cd ../..

# Create environment files
print_status "Creating environment files..."

# Order Service .env
cat > services/order-service/.env << EOF
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=password
DB_NAME=order_db
RABBITMQ_URL=amqp://localhost:5672
LOG_LEVEL=info
EOF

# Inventory Service .env
cat > services/inventory-service/.env << EOF
NODE_ENV=development
PORT=3002
DB_HOST=localhost
DB_PORT=5433
DB_USERNAME=postgres
DB_PASSWORD=password
DB_NAME=inventory_db
RABBITMQ_URL=amqp://localhost:5672
LOG_LEVEL=info
EOF

# Notification Service .env
cat > services/notification-service/.env << EOF
NODE_ENV=development
PORT=3003
DB_HOST=localhost
DB_PORT=5434
DB_USERNAME=postgres
DB_PASSWORD=password
DB_NAME=notification_db
RABBITMQ_URL=amqp://localhost:5672
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=noreply@ecommerce.com
LOG_LEVEL=info
EOF

print_status "Environment files created ✓"

# Check for Docker
if command -v docker &> /dev/null; then
    print_status "Docker found. Attempting to start infrastructure..."
    if docker info &> /dev/null; then
        print_status "Starting RabbitMQ and PostgreSQL with Docker..."
        docker-compose up -d rabbitmq postgres-order postgres-inventory postgres-notification
    else
        print_warning "Docker daemon is not running. Please start Docker manually."
        print_warning "Then run: docker-compose up -d rabbitmq postgres-order postgres-inventory postgres-notification"
    fi
else
    print_warning "Docker not found. You'll need to install and configure:"
    echo "  - RabbitMQ (port 5672, management UI on 15672)"
    echo "  - PostgreSQL instances:"
    echo "    * order_db on port 5432"
    echo "    * inventory_db on port 5433"
    echo "    * notification_db on port 5434"
fi

print_status "\n🎉 Development environment setup complete!"
print_status "\nNext steps:"
echo "  1. Ensure RabbitMQ is running on localhost:5672"
echo "  2. Ensure PostgreSQL databases are running"
echo "  3. Start services with: npm run start:dev"
echo "  4. Or start individual services:"
echo "     - npm run start:dev:order"
echo "     - npm run start:dev:inventory"
echo "     - npm run start:dev:notification"
echo "\n📚 Documentation: See README.md for detailed setup instructions"
echo "🌐 Service URLs:"
echo "  - Order Service: http://localhost:3001"
echo "  - Inventory Service: http://localhost:3002"
echo "  - Notification Service: http://localhost:3003"
echo "  - RabbitMQ Management: http://localhost:15672 (admin/password)"
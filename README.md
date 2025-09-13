# E-commerce Microservices System

A comprehensive e-commerce order processing system built with microservices architecture and event-driven communication using Node.js, NestJS, RabbitMQ, PostgreSQL, and TypeScript.

## 🏗️ Architecture Overview

### Core Services

1. **Order Service** (Port 3001)
   - Handles order lifecycle management
   - Manages order creation, updates, and cancellations
   - Publishes order events to message queue

2. **Inventory Service** (Port 3002)
   - Manages product availability and stock levels
   - Handles inventory reservations and confirmations
   - Processes inventory update events

3. **Notification Service** (Port 3003)
   - Processes and sends notifications (Email, SMS, Push)
   - Maintains notification logs and retry mechanisms
   - Handles failed notification retries

### Infrastructure Components

- **RabbitMQ**: Message broker for inter-service communication
- **PostgreSQL**: Database for each service (separate databases)
- **Docker**: Containerization for all services and infrastructure

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd faba-case-study
   ```

2. **Install dependencies**
   ```bash
   npm run install:all
   ```

3. **Start infrastructure services**
   ```bash
   docker-compose up -d rabbitmq postgres-order postgres-inventory postgres-notification
   ```

4. **Start microservices**
   ```bash
   # Development mode
   npm run start:dev
   
   # Or start individual services
   npm run start:dev:order
   npm run start:dev:inventory
   npm run start:dev:notification
   ```

5. **Access services**
   - Order Service: http://localhost:3001
   - Inventory Service: http://localhost:3002
   - Notification Service: http://localhost:3003
   - RabbitMQ Management: http://localhost:15672 (admin/password)

## 📋 Event Flows

### Order Creation Flow

1. **Order Created**
   - Client creates order via Order Service
   - Order Service publishes `order.created` event
   - Inventory Service receives event and attempts reservation

2. **Inventory Reservation**
   - If successful: Publishes `inventory.reserved` event
   - If failed: Publishes `inventory.reservation.failed` event

3. **Order Confirmation/Cancellation**
   - Order Service updates order status based on inventory response
   - Notification Service sends confirmation/cancellation notifications

### Order Cancellation Flow

1. **Order Cancelled**
   - Client cancels order via Order Service
   - Order Service publishes `order.cancelled` event
   - Inventory Service releases reserved inventory
   - Notification Service sends cancellation notification

### Inventory Update Flow

1. **Inventory Updated**
   - Admin updates inventory via Inventory Service
   - Inventory Service publishes `inventory.updated` event
   - Other services can react to inventory changes

## 🔧 Message Queue Configuration

### Event Types

- `order.created`: New order created
- `order.cancelled`: Order cancelled
- `order.delivered`: Order delivered
- `inventory.reserved`: Inventory successfully reserved
- `inventory.reservation.failed`: Inventory reservation failed
- `inventory.validate`: Inventory validation request
- `inventory.low_stock`: Low stock alert
- `inventory.back_in_stock`: Back in stock notification
- `order.notification`: General order notifications
- `order.cancelled.notification`: Order cancellation notifications
- `notification.sent`: Notification successfully sent
- `notification.failed`: Notification sending failed

### Manual Acknowledgment

All message handlers use manual acknowledgment for reliable message processing:

```typescript
@MessagePattern('event.name')
async handleEvent(@Payload() data: any, @Ctx() context: RmqContext) {
  const channel = context.getChannelRef();
  const originalMsg = context.getMessage();
  
  try {
    // Process event
    await processLogic();
    
    // Manual ACK on success
    channel.ack(originalMsg);
    this.logger.log('✅ [ACK] Message acknowledged successfully');
  } catch (error) {
    // Manual NACK on error (not requeued)
    channel.nack(originalMsg, false, false);
    this.logger.log('❌ [NACK] Message rejected (not requeued)');
    throw error;
  }
}
```

### Queue Configuration

- **Durability**: All queues are durable
- **Prefetch**: Limited to 1 message per consumer
- **Retry Logic**: 3 retry attempts with exponential backoff
- **Dead Letter Queue**: Failed messages after max retries

## 🛡️ Error Handling

### Retry Mechanisms

- **Message Processing**: 3 retry attempts with exponential backoff
- **Database Operations**: Transaction rollback on failures
- **External Services**: Circuit breaker pattern implementation

### Error Types

- `ValidationError`: Input validation failures
- `NotFoundError`: Resource not found
- `InsufficientInventoryError`: Stock availability issues
- `DomainError`: Business logic violations

## 🗄️ Database Schema

### Order Service Database

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  customer_id VARCHAR NOT NULL,
  items JSONB NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Inventory Service Database

```sql
CREATE TABLE inventory_items (
  product_id VARCHAR PRIMARY KEY,
  quantity INTEGER DEFAULT 0,
  reserved_quantity INTEGER DEFAULT 0,
  available_quantity INTEGER DEFAULT 0,
  price DECIMAL(10,2),
  product_name VARCHAR,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  last_updated TIMESTAMP DEFAULT NOW()
);
```

### Notification Service Database

```sql
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY,
  type VARCHAR NOT NULL,
  recipient VARCHAR NOT NULL,
  subject VARCHAR,
  message TEXT NOT NULL,
  metadata JSONB,
  sent BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP,
  error VARCHAR,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## 🔧 Recent Improvements

### Manual ACK Implementation
- All message handlers now use manual acknowledgment
- Proper error handling with NACK for failed messages
- Enhanced debugging with ACK/NACK logging
- Prevents message loss and ensures reliable processing

### Event Buffer Service Enhancements
- Improved sequence gap handling for out-of-order messages
- Better event ordering and processing logic
- Enhanced logging for debugging event flow
- Smart waiting and force processing for edge cases

### UUID Fixes
- Fixed notification service UUID format issues
- Proper database compatibility for PostgreSQL UUID fields
- Better error handling for invalid UUID formats
- Descriptive IDs moved to metadata for reference

### Performance Optimizations
- Manual acknowledgment prevents message reprocessing
- Proper error handling reduces system overhead
- Event buffer ensures correct message ordering
- Optimized database operations with UUID primary keys

## 🔍 Debugging Guide

### Log Levels
- **Production**: LOG, ERROR, WARN
- **Development**: LOG, ERROR, WARN, DEBUG
- **Test**: All levels including verbose output

### Key Log Patterns
- `✅ [ACK]`: Message successfully acknowledged
- `❌ [NACK]`: Message rejected (not requeued)
- `🔥 [EVENT_HANDLER]`: Event processing started
- `📊 [BUFFER]`: Event buffer operations
- `🔍 Processing buffer for entity`: Buffer state debugging
- `⏳ Waiting for sequence`: Sequence gap handling

### Message Tracking
- Correlation IDs for end-to-end message tracing
- Retry count tracking for failed operations
- Processing timestamps for performance monitoring
- Sequence numbers for ordered event processing

### Common Debug Scenarios

#### Silent Mode Issues
```bash
# Check if handlers are being called
docker-compose logs service-name --tail=50 | grep "EVENT_HANDLER"

# Check ACK/NACK status
docker-compose logs service-name --tail=50 | grep -E "\[ACK\]|\[NACK\]"

# Monitor message queue
curl -u admin:password http://localhost:15672/api/queues
```

#### Event Ordering Issues
```bash
# Check event buffer logs
docker-compose logs service-name --tail=50 | grep "BUFFER"

# Monitor sequence gaps
docker-compose logs service-name --tail=50 | grep "sequence"
```

## 🔍 API Documentation

### Order Service API

#### Create Order
```http
POST /orders
Content-Type: application/json

{
  "customerId": "customer-123",
  "items": [
    {
      "productId": "product-1",
      "quantity": 2,
      "price": 29.99
    }
  ]
}
```

#### Get Orders
```http
GET /orders
GET /orders/:id
GET /orders/customer/:customerId
```

#### Cancel Order
```http
POST /orders/:id/cancel
Content-Type: application/json

{
  "reason": "Customer requested cancellation"
}
```

### Inventory Service API

#### Create Inventory Item
```http
POST /inventory
Content-Type: application/json

{
  "productId": "product-1",
  "quantity": 100,
  "price": 29.99,
  "productName": "Sample Product",
  "description": "Product description"
}
```

#### Get Inventory
```http
GET /inventory
GET /inventory/:productId
```

#### Update Inventory
```http
PATCH /inventory/:productId
Content-Type: application/json

{
  "quantity": 150
}
```

### Notification Service API

#### Send Notification
```http
POST /notifications
Content-Type: application/json

{
  "type": "EMAIL",
  "recipient": "user@example.com",
  "subject": "Order Confirmation",
  "message": "Your order has been confirmed",
  "metadata": {
    "orderId": "order-123"
  }
}
```

#### Get Notifications
```http
GET /notifications
GET /notifications/:id
GET /notifications/recipient/:recipient
```

## 🐳 Docker Configuration

### Development
```bash
# Start all services
docker-compose up -d

# Start specific services
docker-compose up -d rabbitmq postgres-order

# View logs
docker-compose logs -f order-service
```

### Production
```bash
# Build and start all services
docker-compose -f docker-compose.prod.yml up -d
```

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:e2e
```

### Load Testing
```bash
# Example with curl
for i in {1..100}; do
  curl -X POST http://localhost:3001/orders \
    -H "Content-Type: application/json" \
    -d '{"customerId":"test-'$i'","items":[{"productId":"product-1","quantity":1,"price":29.99}]}'
done
```

## 📊 Monitoring and Health Checks

### Health Endpoints
- Order Service: `GET /health`
- Inventory Service: `GET /health`
- Notification Service: `GET /health`

### Metrics
- Message queue metrics via RabbitMQ Management UI
- Database connection status
- Service response times
- Error rates and retry counts

## 🔧 Configuration

### Environment Variables

#### Common Variables
```env
NODE_ENV=development
RABBITMQ_URL=amqp://admin:password@localhost:5672
```

#### Order Service
```env
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=order_db
DB_USERNAME=postgres
DB_PASSWORD=password
```

#### Inventory Service
```env
PORT=3002
DB_HOST=localhost
DB_PORT=5433
DB_NAME=inventory_db
DB_USERNAME=postgres
DB_PASSWORD=password
```

#### Notification Service
```env
PORT=3003
DB_HOST=localhost
DB_PORT=5434
DB_NAME=notification_db
DB_USERNAME=postgres
DB_PASSWORD=password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

## 🚀 Deployment

### Production Checklist

- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] SSL certificates installed
- [ ] Load balancer configured
- [ ] Monitoring and logging setup
- [ ] Backup strategy implemented
- [ ] Security scanning completed

### Scaling Considerations

- **Horizontal Scaling**: Multiple instances of each service
- **Database Sharding**: Partition data across multiple databases
- **Message Queue Clustering**: RabbitMQ cluster for high availability
- **Caching**: Redis for frequently accessed data
- **CDN**: Static asset delivery

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Troubleshooting

### Common Issues

1. **RabbitMQ Connection Failed**
   - Check if RabbitMQ is running: `docker-compose ps`
   - Verify connection URL in environment variables

2. **Database Connection Error**
   - Ensure PostgreSQL containers are running
   - Check database credentials and connection strings

3. **Service Not Starting**
   - Check logs: `docker-compose logs service-name`
   - Verify all dependencies are installed

4. **Message Not Processing**
   - Check RabbitMQ management UI for queue status
   - Verify message format and routing keys

### Support

For support and questions, please create an issue in the repository.
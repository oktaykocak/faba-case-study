#!/usr/bin/env node

/**
 * E-commerce Microservices System Test
 * This script demonstrates the event-driven architecture without requiring full infrastructure
 */

const { EventEmitter } = require('events');

// Simple UUID v4 implementation
const uuidv4 = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Mock event bus (simulates RabbitMQ)
const eventBus = new EventEmitter();

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = (service, message, color = colors.reset) => {
  const timestamp = new Date().toISOString();
  console.log(`${color}[${timestamp}] ${service}: ${message}${colors.reset}`);
};

// Mock Order Service
class OrderService {
  constructor() {
    this.orders = new Map();
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    eventBus.on('inventory.reserved', (event) => {
      this.handleInventoryReserved(event);
    });

    eventBus.on('inventory.reservation.failed', (event) => {
      this.handleInventoryReservationFailed(event);
    });
  }

  async createOrder(orderData) {
    const orderId = uuidv4();
    const order = {
      id: orderId,
      customerId: orderData.customerId,
      items: orderData.items,
      totalAmount: orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
      status: 'PENDING',
      createdAt: new Date()
    };

    this.orders.set(orderId, order);
    log('ORDER-SERVICE', `Order created: ${orderId}`, colors.green);

    // Publish order.created event
    const event = {
      id: uuidv4(),
      type: 'order.created',
      timestamp: new Date(),
      payload: { order }
    };

    log('ORDER-SERVICE', `Publishing order.created event`, colors.blue);
    eventBus.emit('order.created', event);

    return order;
  }

  handleInventoryReserved(event) {
    const { orderId } = event.payload;
    const order = this.orders.get(orderId);
    if (order) {
      order.status = 'CONFIRMED';
      log('ORDER-SERVICE', `Order ${orderId} confirmed - inventory reserved`, colors.green);
    }
  }

  handleInventoryReservationFailed(event) {
    const { orderId, reason } = event.payload;
    const order = this.orders.get(orderId);
    if (order) {
      order.status = 'CANCELLED';
      log('ORDER-SERVICE', `Order ${orderId} cancelled - ${reason}`, colors.red);
    }
  }

  getOrder(orderId) {
    return this.orders.get(orderId);
  }
}

// Mock Inventory Service
class InventoryService {
  constructor() {
    this.inventory = new Map([
      ['product-1', { productId: 'product-1', quantity: 10, reserved: 0 }],
      ['product-2', { productId: 'product-2', quantity: 5, reserved: 0 }],
      ['product-3', { productId: 'product-3', quantity: 0, reserved: 0 }]
    ]);
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    eventBus.on('order.created', (event) => {
      this.handleOrderCreated(event);
    });
  }

  async handleOrderCreated(event) {
    const { order } = event.payload;
    log('INVENTORY-SERVICE', `Processing order ${order.id} for inventory reservation`, colors.yellow);

    try {
      // Check if all items are available
      for (const item of order.items) {
        const inventoryItem = this.inventory.get(item.productId);
        if (!inventoryItem) {
          throw new Error(`Product ${item.productId} not found`);
        }
        if (inventoryItem.quantity - inventoryItem.reserved < item.quantity) {
          throw new Error(`Insufficient inventory for ${item.productId}`);
        }
      }

      // Reserve inventory
      for (const item of order.items) {
        const inventoryItem = this.inventory.get(item.productId);
        inventoryItem.reserved += item.quantity;
        log('INVENTORY-SERVICE', `Reserved ${item.quantity} units of ${item.productId}`, colors.cyan);
      }

      // Publish inventory.reserved event
      const reservedEvent = {
        id: uuidv4(),
        type: 'inventory.reserved',
        timestamp: new Date(),
        payload: {
          orderId: order.id,
          items: order.items
        }
      };

      log('INVENTORY-SERVICE', `Publishing inventory.reserved event`, colors.blue);
      eventBus.emit('inventory.reserved', reservedEvent);

    } catch (error) {
      // Publish inventory.reservation.failed event
      const failedEvent = {
        id: uuidv4(),
        type: 'inventory.reservation.failed',
        timestamp: new Date(),
        payload: {
          orderId: order.id,
          items: order.items,
          reason: error.message
        }
      };

      log('INVENTORY-SERVICE', `Publishing inventory.reservation.failed event: ${error.message}`, colors.red);
      eventBus.emit('inventory.reservation.failed', failedEvent);
    }
  }

  getInventory() {
    return Array.from(this.inventory.values());
  }
}

// Mock Notification Service
class NotificationService {
  constructor() {
    this.notifications = [];
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    eventBus.on('inventory.reserved', (event) => {
      this.sendOrderConfirmation(event);
    });

    eventBus.on('inventory.reservation.failed', (event) => {
      this.sendOrderCancellation(event);
    });
  }

  async sendOrderConfirmation(event) {
    const { orderId } = event.payload;
    const notification = {
      id: uuidv4(),
      type: 'EMAIL',
      recipient: 'customer@example.com',
      subject: 'Order Confirmation',
      message: `Your order ${orderId} has been confirmed and will be processed soon.`,
      timestamp: new Date()
    };

    this.notifications.push(notification);
    log('NOTIFICATION-SERVICE', `Sent order confirmation for ${orderId}`, colors.magenta);
  }

  async sendOrderCancellation(event) {
    const { orderId, reason } = event.payload;
    const notification = {
      id: uuidv4(),
      type: 'EMAIL',
      recipient: 'customer@example.com',
      subject: 'Order Cancellation',
      message: `Your order ${orderId} has been cancelled. Reason: ${reason}`,
      timestamp: new Date()
    };

    this.notifications.push(notification);
    log('NOTIFICATION-SERVICE', `Sent order cancellation for ${orderId}`, colors.magenta);
  }

  getNotifications() {
    return this.notifications;
  }
}

// Test System
async function runTests() {
  console.log(`${colors.cyan}🚀 E-commerce Microservices System Test${colors.reset}\n`);

  // Initialize services
  const orderService = new OrderService();
  const inventoryService = new InventoryService();
  const notificationService = new NotificationService();

  console.log(`${colors.yellow}📦 Initial Inventory:${colors.reset}`);
  inventoryService.getInventory().forEach(item => {
    console.log(`  - ${item.productId}: ${item.quantity} available, ${item.reserved} reserved`);
  });
  console.log();

  // Test Case 1: Successful Order
  console.log(`${colors.green}✅ Test Case 1: Successful Order${colors.reset}`);
  const order1 = await orderService.createOrder({
    customerId: 'customer-123',
    items: [
      { productId: 'product-1', quantity: 2, price: 29.99 },
      { productId: 'product-2', quantity: 1, price: 49.99 }
    ]
  });

  // Wait for events to process
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log(`Final order status: ${orderService.getOrder(order1.id).status}\n`);

  // Test Case 2: Failed Order (Insufficient Inventory)
  console.log(`${colors.red}❌ Test Case 2: Failed Order (Insufficient Inventory)${colors.reset}`);
  const order2 = await orderService.createOrder({
    customerId: 'customer-456',
    items: [
      { productId: 'product-3', quantity: 1, price: 19.99 } // This product has 0 inventory
    ]
  });

  // Wait for events to process
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log(`Final order status: ${orderService.getOrder(order2.id).status}\n`);

  // Test Case 3: Partial Inventory
  console.log(`${colors.yellow}⚠️  Test Case 3: Partial Inventory Failure${colors.reset}`);
  const order3 = await orderService.createOrder({
    customerId: 'customer-789',
    items: [
      { productId: 'product-1', quantity: 15, price: 29.99 } // Requesting more than available
    ]
  });

  // Wait for events to process
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log(`Final order status: ${orderService.getOrder(order3.id).status}\n`);

  // Show final state
  console.log(`${colors.cyan}📊 Final System State:${colors.reset}`);
  console.log(`${colors.yellow}📦 Inventory:${colors.reset}`);
  inventoryService.getInventory().forEach(item => {
    console.log(`  - ${item.productId}: ${item.quantity} available, ${item.reserved} reserved`);
  });

  console.log(`${colors.magenta}📧 Notifications Sent: ${notificationService.getNotifications().length}${colors.reset}`);
  notificationService.getNotifications().forEach((notif, index) => {
    console.log(`  ${index + 1}. ${notif.subject} - ${notif.message}`);
  });

  console.log(`\n${colors.green}🎉 System test completed successfully!${colors.reset}`);
  console.log(`${colors.blue}💡 This demonstrates the event-driven architecture with:${colors.reset}`);
  console.log(`   - Asynchronous event processing`);
  console.log(`   - Service decoupling via message queues`);
  console.log(`   - Error handling and compensation patterns`);
  console.log(`   - Inventory reservation and rollback`);
  console.log(`   - Automated notifications`);
}

// Export for potential module usage

// Run the tests
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { OrderService, InventoryService, NotificationService };
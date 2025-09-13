import { createConnection, Connection } from 'typeorm';
import { Order } from '../order/entities/order.entity';
import { OrderHistory } from '../order/entities/order-history.entity';
import { EventSequenceEntity } from '../events/sequence.service';

let connection: Connection;

export default async function globalSetup() {
  console.log('🧪 Setting up test environment...');

  try {
    // Create test database connection
    connection = await createConnection({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432'),
      username: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
      database: process.env.DATABASE_NAME || 'order_test_db',
      entities: [Order, OrderHistory, EventSequenceEntity],
      synchronize: true,
      dropSchema: true,
      logging: false,
    });

    console.log('✅ Test database connected and schema created');

    // Seed test data if needed
    await seedTestData();

    console.log('✅ Test environment setup complete');
  } catch (error) {
    console.error('❌ Failed to setup test environment:', error);
    throw error;
  }
}

async function seedTestData() {
  try {
    // Create initial sequence entities for testing
    const sequenceRepo = connection.getRepository(EventSequenceEntity);

    await sequenceRepo.save([
      {
        entityId: 'test-order-1',
        entityType: 'order',
        lastSequenceNumber: 0,
      },
      {
        entityId: 'test-product-1',
        entityType: 'inventory',
        lastSequenceNumber: 0,
      },
    ]);

    console.log('✅ Test data seeded');
  } catch (error) {
    console.warn('⚠️ Failed to seed test data:', error.message);
  }
}

// Export connection for use in tests
export { connection };

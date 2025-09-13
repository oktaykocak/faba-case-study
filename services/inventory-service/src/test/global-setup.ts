import { createConnection, Connection } from 'typeorm';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { InventoryHistory } from '../inventory/entities/inventory-history.entity';
import { EventSequenceEntity } from '../events/sequence.service';
import { InventoryStatus } from '../inventory/enums/inventory-status.enum';

let connection: Connection;

export default async function globalSetup() {
  console.log('🧪 Setting up inventory test environment...');

  try {
    // Create test database connection
    connection = await createConnection({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432'),
      username: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
      database: process.env.DATABASE_NAME || 'inventory_test_db',
      entities: [InventoryItem, InventoryHistory, EventSequenceEntity],
      synchronize: true,
      dropSchema: true,
      logging: false,
    });

    console.log('✅ Inventory test database connected and schema created');

    // Seed test data if needed
    await seedTestData();

    console.log('✅ Inventory test environment setup complete');
  } catch (error) {
    console.error('❌ Failed to setup inventory test environment:', error);
    throw error;
  }
}

async function seedTestData() {
  try {
    // Create initial sequence entities for testing
    const sequenceRepo = connection.getRepository(EventSequenceEntity);

    await sequenceRepo.save([
      {
        entityId: 'test-product-1',
        entityType: 'inventory',
        lastSequenceNumber: 0,
      },
      {
        entityId: 'test-product-2',
        entityType: 'inventory',
        lastSequenceNumber: 0,
      },
    ]);

    // Create test inventory items
    const inventoryRepo = connection.getRepository(InventoryItem);

    const testItems = [
      {
        productId: 'test-product-1',
        productName: 'Test Product 1',
        description: 'Test product for E2E testing',
        quantity: 100,
        reservedQuantity: 0,
        availableQuantity: 100,
        price: 29.99,
        status: InventoryStatus.ACTIVE,
      },
      {
        productId: 'test-product-2',
        productName: 'Test Product 2',
        description: 'Another test product',
        quantity: 50,
        reservedQuantity: 10,
        availableQuantity: 40,
        price: 49.99,
        status: InventoryStatus.ACTIVE,
      },
    ];

    for (const itemData of testItems) {
      const item = inventoryRepo.create(itemData);
      await inventoryRepo.save(item);
    }

    console.log('✅ Inventory test data seeded');
  } catch (error) {
    console.warn('⚠️ Failed to seed inventory test data:', error.message);
  }
}

// Export connection for use in tests
export { connection };

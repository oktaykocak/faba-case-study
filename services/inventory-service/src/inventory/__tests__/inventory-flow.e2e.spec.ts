import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { InventoryModule } from '../inventory.module';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryHistory } from '../entities/inventory-history.entity';
import { EventSequenceEntity } from '../../events/sequence.service';
import {
  createTestModule,
  cleanupTestData,
  sleep,
  createMockInventoryValidationRequest,
  createMockInventoryReservationRequest,
} from '../../test/test-utils';
import { InventoryStatus } from '../enums/inventory-status.enum';
import { InventoryAction } from '../enums/inventory-action.enum';

describe('Inventory Flow E2E', () => {
  let app: INestApplication;
  let inventoryRepository: Repository<InventoryItem>;
  let inventoryHistoryRepository: Repository<InventoryHistory>;
  let sequenceRepository: Repository<EventSequenceEntity>;
  let module: TestingModule;

  beforeAll(async () => {
    module = await createTestModule({
      imports: [InventoryModule],
      controllers: [],
      providers: [],
    });

    app = module.createNestApplication();

    // Add middleware for admin ID
    app.use('/inventory', (req, res, next) => {
      if (!req.headers['x-admin-id']) {
        req.headers['x-admin-id'] = 'test-admin-1';
      }
      req.adminId = req.headers['x-admin-id'];
      next();
    });

    await app.init();

    inventoryRepository = module.get('InventoryItemRepository');
    inventoryHistoryRepository = module.get('InventoryHistoryRepository');
    sequenceRepository = module.get('EventSequenceEntityRepository');
  });

  afterAll(async () => {
    await app.close();
    await module.close();
  });

  beforeEach(async () => {
    // Clean up test data
    await cleanupTestData(inventoryRepository);
    await cleanupTestData(inventoryHistoryRepository);
    await cleanupTestData(sequenceRepository);
  });

  describe('Complete Inventory Lifecycle', () => {
    it('should handle complete inventory item lifecycle from creation to updates', async () => {
      // Step 1: Create Inventory Item
      const createInventoryDto = {
        productId: 'e2e-product-1',
        productName: 'E2E Test Product',
        description: 'Product for end-to-end testing',
        quantity: 100,
        price: 29.99,
      };

      const createResponse = await request(app.getHttpServer())
        .post('/inventory')
        .set('x-admin-id', 'e2e-admin-1')
        .send(createInventoryDto)
        .expect(201);

      const productId = createResponse.body.productId;
      expect(productId).toBe('e2e-product-1');
      expect(createResponse.body.quantity).toBe(100);
      expect(createResponse.body.availableQuantity).toBe(100);
      expect(createResponse.body.reservedQuantity).toBe(0);
      expect(createResponse.body.status).toBe(InventoryStatus.ACTIVE);

      // Verify item in database
      const createdItem = await inventoryRepository.findOne({ where: { productId } });
      expect(createdItem).toBeDefined();
      expect(createdItem!.quantity).toBe(100);
      expect(createdItem!.price).toBe(29.99);

      // Verify sequence generation
      const sequence = await sequenceRepository.findOne({
        where: { entityId: productId, entityType: 'inventory' },
      });
      expect(sequence).toBeDefined();
      expect(sequence!.lastSequenceNumber).toBeGreaterThan(0);

      // Step 2: Update Inventory Item
      const updateInventoryDto = {
        quantity: 150,
        price: 34.99,
        productName: 'Updated E2E Test Product',
      };

      const updateResponse = await request(app.getHttpServer())
        .patch(`/inventory/${productId}`)
        .set('x-admin-id', 'e2e-admin-1')
        .send(updateInventoryDto)
        .expect(200);

      expect(updateResponse.body.quantity).toBe(150);
      expect(updateResponse.body.price).toBe(34.99);
      expect(updateResponse.body.productName).toBe('Updated E2E Test Product');
      expect(updateResponse.body.availableQuantity).toBe(150);

      // Verify history entry
      const historyEntries = await inventoryHistoryRepository.find({
        where: { productId },
        order: { createdAt: 'ASC' },
      });
      expect(historyEntries).toHaveLength(2); // CREATE + UPDATE

      const updateHistory = historyEntries.find(h => h.action === InventoryAction.UPDATED);
      expect(updateHistory).toBeDefined();
      expect(updateHistory!.previousQuantity).toBe(100);
      expect(updateHistory!.newQuantity).toBe(150);
      expect(updateHistory!.previousPrice).toBe(29.99);
      expect(updateHistory!.newPrice).toBe(34.99);

      // Step 3: Get Single Item
      const getResponse = await request(app.getHttpServer())
        .get(`/inventory/${productId}`)
        .expect(200);

      expect(getResponse.body.productId).toBe(productId);
      expect(getResponse.body.quantity).toBe(150);
      expect(getResponse.body.history).toBeDefined();
      expect(getResponse.body.history).toHaveLength(2);

      // Step 4: Get All Items
      const getAllResponse = await request(app.getHttpServer()).get('/inventory').expect(200);

      expect(getAllResponse.body).toHaveLength(1);
      expect(getAllResponse.body[0].productId).toBe(productId);
    });

    it('should handle inventory item deletion (status change)', async () => {
      // Create item first
      const createResponse = await request(app.getHttpServer())
        .post('/inventory')
        .set('x-admin-id', 'delete-admin-1')
        .send({
          productId: 'delete-product-1',
          productName: 'Product to Delete',
          quantity: 50,
          price: 19.99,
        })
        .expect(201);

      const productId = createResponse.body.productId;

      // Delete item (soft delete - status change)
      await request(app.getHttpServer())
        .delete(`/inventory/${productId}`)
        .set('x-admin-id', 'delete-admin-1')
        .expect(200);

      // Verify item is marked as inactive
      const deletedItem = await inventoryRepository.findOne({ where: { productId } });
      expect(deletedItem!.status).toBe(InventoryStatus.INACTIVE);

      // Verify it doesn't appear in active items list
      const getAllResponse = await request(app.getHttpServer()).get('/inventory').expect(200);

      expect(getAllResponse.body.find((item: any) => item.productId === productId)).toBeUndefined();
    });
  });

  describe('Stock Management Operations', () => {
    beforeEach(async () => {
      // Create test inventory items
      await inventoryRepository.save([
        {
          productId: 'stock-product-1',
          productName: 'Stock Test Product 1',
          quantity: 100,
          reservedQuantity: 0,
          availableQuantity: 100,
          price: 25.0,
          status: InventoryStatus.ACTIVE,
        },
        {
          productId: 'stock-product-2',
          productName: 'Stock Test Product 2',
          quantity: 20,
          reservedQuantity: 5,
          availableQuantity: 15,
          price: 45.0,
          status: InventoryStatus.ACTIVE,
        },
      ]);
    });

    it('should handle inventory validation requests', async () => {
      const validationRequest = createMockInventoryValidationRequest({
        items: [
          { productId: 'stock-product-1', quantity: 10 },
          { productId: 'stock-product-2', quantity: 5 },
        ],
      });

      // This would normally be tested via message pattern
      // For E2E, we test the service method directly
      const inventoryController = module.get('InventoryController');
      const result = await inventoryController.handleInventoryValidation(validationRequest);

      expect(result.success).toBe(true);
      expect(result.validatedItems).toHaveLength(2);
      expect(result.validatedItems[0].productId).toBe('stock-product-1');
      expect(result.validatedItems[0].price).toBe(25.0);
    });

    it('should reject validation for insufficient stock', async () => {
      const validationRequest = createMockInventoryValidationRequest({
        items: [
          { productId: 'stock-product-2', quantity: 20 }, // Only 15 available
        ],
      });

      const inventoryController = module.get('InventoryController');
      const result = await inventoryController.handleInventoryValidation(validationRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient stock');
      expect(result.error).toContain('Available: 15, Requested: 20');
    });

    it('should handle inventory reservation', async () => {
      const reservationRequest = createMockInventoryReservationRequest({
        items: [{ productId: 'stock-product-1', quantity: 25 }],
        orderId: 'reservation-order-1',
      });

      const inventoryController = module.get('InventoryController');
      const result = await inventoryController.handleInventoryReservation(reservationRequest);

      expect(result.success).toBe(true);

      // Verify reservation in database
      const updatedItem = await inventoryRepository.findOne({
        where: { productId: 'stock-product-1' },
      });
      expect(updatedItem!.reservedQuantity).toBe(25);
      expect(updatedItem!.availableQuantity).toBe(75); // 100 - 25

      // Verify history entry
      const history = await inventoryHistoryRepository.findOne({
        where: { productId: 'stock-product-1', action: InventoryAction.RESERVED },
      });
      expect(history).toBeDefined();
      expect(history!.notes).toContain('reservation-order-1');
    });

    it('should handle inventory release', async () => {
      // First reserve some inventory
      await inventoryRepository.update(
        { productId: 'stock-product-1' },
        { reservedQuantity: 30, availableQuantity: 70 },
      );

      const releaseRequest = {
        items: [{ productId: 'stock-product-1', quantity: 15 }],
        orderId: 'release-order-1',
        correlationId: 'release-correlation-1',
      };

      const inventoryController = module.get('InventoryController');
      const result = await inventoryController.handleInventoryRelease(releaseRequest);

      expect(result.success).toBe(true);

      // Verify release in database
      const updatedItem = await inventoryRepository.findOne({
        where: { productId: 'stock-product-1' },
      });
      expect(updatedItem!.reservedQuantity).toBe(15); // 30 - 15
      expect(updatedItem!.availableQuantity).toBe(85); // 70 + 15
    });

    it('should handle delivery finalization', async () => {
      // Set up reserved inventory
      await inventoryRepository.update(
        { productId: 'stock-product-1' },
        { quantity: 100, reservedQuantity: 20, availableQuantity: 80 },
      );

      const deliveryRequest = {
        items: [{ productId: 'stock-product-1', quantity: 20 }],
        orderId: 'delivery-order-1',
        correlationId: 'delivery-correlation-1',
      };

      const inventoryController = module.get('InventoryController');
      const result = await inventoryController.handleInventoryDelivery(deliveryRequest);

      expect(result.success).toBe(true);

      // Verify delivery finalization in database
      const updatedItem = await inventoryRepository.findOne({
        where: { productId: 'stock-product-1' },
      });
      expect(updatedItem!.quantity).toBe(80); // 100 - 20 (consumed)
      expect(updatedItem!.reservedQuantity).toBe(0); // 20 - 20 (released)
      expect(updatedItem!.availableQuantity).toBe(80); // 80 - 0

      // Verify history entry
      const history = await inventoryHistoryRepository.findOne({
        where: { productId: 'stock-product-1', action: InventoryAction.DELIVERED },
      });
      expect(history).toBeDefined();
      expect(history!.notes).toContain('delivered');
    });
  });

  describe('Event Ordering and Sequencing', () => {
    it('should maintain sequence numbers across operations', async () => {
      const productId = 'sequence-product-1';

      // Create item
      await request(app.getHttpServer())
        .post('/inventory')
        .set('x-admin-id', 'sequence-admin-1')
        .send({
          productId,
          productName: 'Sequence Test Product',
          quantity: 50,
          price: 15.99,
        })
        .expect(201);

      // Perform multiple updates
      const updates = [
        { quantity: 75, price: 18.99 },
        { quantity: 100, price: 22.99 },
        { quantity: 125, price: 25.99 },
      ];

      for (const update of updates) {
        await request(app.getHttpServer())
          .patch(`/inventory/${productId}`)
          .set('x-admin-id', 'sequence-admin-1')
          .send(update)
          .expect(200);

        await sleep(10); // Small delay for sequence ordering
      }

      // Verify sequence increments
      const sequence = await sequenceRepository.findOne({
        where: { entityId: productId, entityType: 'inventory' },
      });

      expect(sequence!.lastSequenceNumber).toBe(4); // Create + 3 updates

      // Verify history is in correct order
      const history = await inventoryHistoryRepository.find({
        where: { productId },
        order: { createdAt: 'ASC' },
      });

      expect(history).toHaveLength(4);
      expect(history[0].action).toBe(InventoryAction.CREATED);
      expect(history[1].action).toBe(InventoryAction.UPDATED);
      expect(history[1].newQuantity).toBe(75);
      expect(history[2].newQuantity).toBe(100);
      expect(history[3].newQuantity).toBe(125);
    });

    it('should handle concurrent operations with proper sequencing', async () => {
      // Create multiple inventory items concurrently
      const itemPromises = Array.from({ length: 3 }, (_, i) =>
        request(app.getHttpServer())
          .post('/inventory')
          .set('x-admin-id', `concurrent-admin-${i}`)
          .send({
            productId: `concurrent-product-${i}`,
            productName: `Concurrent Product ${i}`,
            quantity: 50,
            price: 20.0,
          }),
      );

      const responses = await Promise.all(itemPromises);
      const productIds = responses.map(r => r.body.productId);

      // Verify all items were created
      expect(productIds).toHaveLength(3);
      expect(new Set(productIds).size).toBe(3); // All unique

      // Verify each has its own sequence
      for (const productId of productIds) {
        const sequence = await sequenceRepository.findOne({
          where: { entityId: productId, entityType: 'inventory' },
        });
        expect(sequence).toBeDefined();
        expect(sequence!.lastSequenceNumber).toBe(1);
      }
    });
  });

  describe('Error Handling and Validation', () => {
    it('should handle invalid product ID format', async () => {
      await request(app.getHttpServer()).get('/inventory/invalid-uuid').expect(400);
    });

    it('should handle product not found', async () => {
      await request(app.getHttpServer())
        .get('/inventory/550e8400-e29b-41d4-a716-446655440999')
        .expect(404);
    });

    it('should validate required fields on creation', async () => {
      await request(app.getHttpServer())
        .post('/inventory')
        .set('x-admin-id', 'validation-admin-1')
        .send({
          // Missing productId and quantity
          productName: 'Invalid Product',
        })
        .expect(400);
    });

    it('should validate positive quantities', async () => {
      await request(app.getHttpServer())
        .post('/inventory')
        .set('x-admin-id', 'validation-admin-1')
        .send({
          productId: 'negative-quantity-product',
          quantity: -10, // Invalid negative quantity
          price: 25.0,
        })
        .expect(400);
    });

    it('should handle duplicate product creation', async () => {
      const productData = {
        productId: 'duplicate-product-1',
        productName: 'Duplicate Product',
        quantity: 50,
        price: 30.0,
      };

      // Create first item
      await request(app.getHttpServer())
        .post('/inventory')
        .set('x-admin-id', 'duplicate-admin-1')
        .send(productData)
        .expect(201);

      // Try to create duplicate
      await request(app.getHttpServer())
        .post('/inventory')
        .set('x-admin-id', 'duplicate-admin-1')
        .send(productData)
        .expect(409); // Conflict
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle multiple concurrent inventory operations', async () => {
      const startTime = Date.now();

      // Create 5 inventory items concurrently
      const createPromises = Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/inventory')
          .set('x-admin-id', `load-admin-${i}`)
          .send({
            productId: `load-product-${i}`,
            productName: `Load Test Product ${i}`,
            quantity: 100,
            price: 25.0,
          }),
      );

      const createResponses = await Promise.all(createPromises);
      const productIds = createResponses.map(r => r.body.productId);

      // Update all items concurrently
      const updatePromises = productIds.map(productId =>
        request(app.getHttpServer())
          .patch(`/inventory/${productId}`)
          .set('x-admin-id', 'load-admin-1')
          .send({ quantity: 150 }),
      );

      await Promise.all(updatePromises);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete within reasonable time (5 seconds)
      expect(totalTime).toBeLessThan(5000);

      // Verify all items were processed correctly
      const items = await inventoryRepository.find({
        where: { productId: { $in: productIds } as any },
      });

      expect(items).toHaveLength(5);
      items.forEach(item => {
        expect(item.quantity).toBe(150);
        expect(item.availableQuantity).toBe(150);
      });
    });

    it('should handle rapid stock operations efficiently', async () => {
      // Create test item
      await request(app.getHttpServer())
        .post('/inventory')
        .set('x-admin-id', 'rapid-admin-1')
        .send({
          productId: 'rapid-stock-product',
          productName: 'Rapid Stock Product',
          quantity: 1000,
          price: 10.0,
        })
        .expect(201);

      const startTime = Date.now();

      // Perform 10 rapid stock operations
      const operations = Array.from({ length: 10 }, (_, i) =>
        request(app.getHttpServer())
          .patch('/inventory/rapid-stock-product')
          .set('x-admin-id', 'rapid-admin-1')
          .send({ quantity: 1000 + i * 10 }),
      );

      await Promise.all(operations);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(2000); // Complete within 2 seconds

      // Verify final state
      const finalItem = await inventoryRepository.findOne({
        where: { productId: 'rapid-stock-product' },
      });
      expect(finalItem!.quantity).toBeGreaterThan(1000);
    });
  });
});

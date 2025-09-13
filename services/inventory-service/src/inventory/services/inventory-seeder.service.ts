import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItem } from '../entities/inventory-item.entity';

@Injectable()
export class InventorySeederService implements OnModuleInit {
  private readonly logger = new Logger(InventorySeederService.name);

  constructor(
    @InjectRepository(InventoryItem)
    private readonly inventoryRepository: Repository<InventoryItem>,
  ) {}

  async onModuleInit() {
    await this.seedInventoryItems();
  }

  private async seedInventoryItems(): Promise<void> {
    try {
      // Mevcut ürün sayısını kontrol et
      const existingItemsCount = await this.inventoryRepository.count();

      if (existingItemsCount > 0) {
        this.logger.log(`Inventory already has ${existingItemsCount} items. Skipping seed.`);
        return;
      }

      this.logger.log('No inventory items found. Starting seed process...');

      const seedItems = this.createSeedItems();

      for (const item of seedItems) {
        await this.inventoryRepository.save(item);
        this.logger.log(`Seeded inventory item: ${item.productId} - ${item.productName}`);
      }

      this.logger.log(`Successfully seeded ${seedItems.length} inventory items.`);
    } catch (error) {
      this.logger.error('Failed to seed inventory items:', error.stack);
    }
  }

  private createSeedItems(): InventoryItem[] {
    return [
      {
        productId: '550e8400-e29b-41d4-a716-446655440001',
        productName: 'Wireless Bluetooth Headphones',
        description: 'High-quality wireless headphones with noise cancellation',
        quantity: 50,
        reservedQuantity: 0,
        availableQuantity: 50,
        price: 99.99,
        lastUpdated: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        productId: '550e8400-e29b-41d4-a716-446655440002',
        productName: 'Smartphone Case',
        description: 'Protective case for smartphones with shock absorption',
        quantity: 100,
        reservedQuantity: 0,
        availableQuantity: 100,
        price: 24.99,
        lastUpdated: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        productId: '550e8400-e29b-41d4-a716-446655440003',
        productName: 'USB-C Charging Cable',
        description: 'Fast charging USB-C cable 2 meters length',
        quantity: 200,
        reservedQuantity: 0,
        availableQuantity: 200,
        price: 15.99,
        lastUpdated: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        productId: '550e8400-e29b-41d4-a716-446655440004',
        productName: 'Wireless Mouse',
        description: 'Ergonomic wireless mouse with precision tracking',
        quantity: 75,
        reservedQuantity: 0,
        availableQuantity: 75,
        price: 39.99,
        lastUpdated: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        productId: '550e8400-e29b-41d4-a716-446655440005',
        productName: 'Portable Power Bank',
        description: '10000mAh portable power bank with fast charging',
        quantity: 30,
        reservedQuantity: 0,
        availableQuantity: 30,
        price: 49.99,
        lastUpdated: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ].map(item => {
      const inventoryItem = new InventoryItem();
      Object.assign(inventoryItem, item);
      return inventoryItem;
    });
  }
}

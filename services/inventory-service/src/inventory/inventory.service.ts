import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItem } from './entities/inventory-item.entity';
import { InventoryHistory } from './entities/inventory-history.entity';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { InsufficientInventoryError } from '@ecommerce/shared-types';
import { EventPublisher } from '../events/event.publisher';
import { InventoryAction } from './enums/inventory-action.enum';
import { InventoryStatus } from './enums/inventory-status.enum';
import { getRandomMockAdminId } from '@ecommerce/shared-types';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(InventoryItem)
    private readonly inventoryRepository: Repository<InventoryItem>,
    @InjectRepository(InventoryHistory)
    private readonly inventoryHistoryRepository: Repository<InventoryHistory>,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async create(
    createInventoryItemDto: CreateInventoryItemDto,
    adminId?: string,
  ): Promise<InventoryItem> {
    try {
      this.logger.log(`Creating inventory item: ${createInventoryItemDto.productId}`);

      const inventoryItem = this.inventoryRepository.create({
        ...createInventoryItemDto,
        availableQuantity: createInventoryItemDto.quantity,
      });

      const savedItem = await this.inventoryRepository.save(inventoryItem);
      this.logger.log(`Inventory item created: ${savedItem.productId}`);

      // History kaydı oluştur
      await this.createHistoryRecord({
        productId: savedItem.productId,
        action: InventoryAction.CREATED,
        newQuantity: savedItem.quantity,
        newPrice: savedItem.price,
        newProductName: savedItem.productName,
        newDescription: savedItem.description,
        adminId: adminId || getRandomMockAdminId(), // Request'ten gelen veya mock admin ID
        notes: 'Initial inventory item creation',
      });

      return savedItem;
    } catch (error) {
      this.logger.error(`Failed to create inventory item: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create inventory item', error);
    }
  }

  async findAll(): Promise<InventoryItem[]> {
    return this.inventoryRepository.find({
      where: { status: InventoryStatus.ACTIVE },
      order: { lastUpdated: 'DESC' },
    });
  }

  async findOne(productId: string): Promise<InventoryItem> {
    const item = await this.inventoryRepository.findOne({
      where: {
        productId,
        status: InventoryStatus.ACTIVE,
      },
    });
    if (!item) {
      throw new NotFoundException(`Active inventory item with product ID ${productId} not found`);
    }
    return item;
  }

  async findOneWithHistory(
    productId: string,
  ): Promise<InventoryItem & { history?: InventoryHistory[] }> {
    const item = await this.inventoryRepository.findOne({
      where: {
        productId,
        status: InventoryStatus.ACTIVE,
      },
    });
    if (!item) {
      throw new NotFoundException(`Active inventory item with product ID ${productId} not found`);
    }
    // Get inventory history
    const history = await this.inventoryHistoryRepository.find({
      where: { productId },
      order: { createdAt: 'DESC' },
    });

    return { ...item, history };
  }

  async update(
    productId: string,
    updateInventoryItemDto: UpdateInventoryItemDto,
    adminId?: string,
  ): Promise<InventoryItem> {
    const item = await this.findOne(productId);

    // Önceki değerleri sakla
    const previousQuantity = item.quantity;
    const previousAvailableQuantity = item.availableQuantity;
    const previousPrice = item.price;
    const previousProductName = item.productName;
    const previousDescription = item.description;

    // Quantity validation - yeni quantity reserved quantity'den küçük olamaz
    if (updateInventoryItemDto.quantity !== undefined) {
      if (updateInventoryItemDto.quantity < item.reservedQuantity) {
        throw new BadRequestException({
          message: 'Invalid quantity update',
          error: 'BAD_REQUEST',
          statusCode: 400,
          details: {
            requestedQuantity: updateInventoryItemDto.quantity,
            currentReservedQuantity: item.reservedQuantity,
            minimumAllowedQuantity: item.reservedQuantity,
            reason: `Cannot set quantity (${updateInventoryItemDto.quantity}) below reserved quantity (${item.reservedQuantity}). This would result in negative available quantity.`,
          },
        });
      }
    }

    Object.assign(item, updateInventoryItemDto);
    item.availableQuantity = item.quantity - item.reservedQuantity;

    const updatedItem = await this.inventoryRepository.save(item);
    this.logger.log(`Inventory item updated: ${updatedItem.productId}`);

    // Back in stock notification check
    if (previousAvailableQuantity === 0 && updatedItem.availableQuantity > 0) {
      await this.eventPublisher.publishBackInStockAlert({
        productId: updatedItem.productId,
        productName: updatedItem.productName,
        previousQuantity: previousQuantity,
        newQuantity: updatedItem.quantity,
        previousAvailableQuantity: previousAvailableQuantity,
        newAvailableQuantity: updatedItem.availableQuantity,
        reservedQuantity: updatedItem.reservedQuantity,
      });

      this.logger.log(
        `📦 Back in stock alert sent for product ${updatedItem.productId}: ${updatedItem.availableQuantity} now available`,
      );
    }

    // History kaydı oluştur
    await this.createHistoryRecord({
      productId: updatedItem.productId,
      action: InventoryAction.UPDATED,
      previousQuantity,
      newQuantity: updatedItem.quantity,
      previousPrice,
      newPrice: updatedItem.price,
      previousProductName,
      newProductName: updatedItem.productName,
      previousDescription,
      newDescription: updatedItem.description,
      adminId: adminId || getRandomMockAdminId(), // Request'ten gelen veya mock admin ID
      notes: 'Inventory item updated',
    });

    // Inventory updated - log the change
    if (
      updateInventoryItemDto.quantity !== undefined &&
      previousQuantity !== updatedItem.quantity
    ) {
      this.logger.log(
        `Inventory updated for product ${productId}: ${previousQuantity} → ${updatedItem.quantity}`,
      );
    }

    return updatedItem;
  }

  async reserveItems(items: Array<{ productId: string; quantity: number }>): Promise<boolean> {
    const queryRunner = this.inventoryRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const item of items) {
        const inventoryItem = await queryRunner.manager.findOne(InventoryItem, {
          where: { productId: item.productId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!inventoryItem) {
          throw new NotFoundException(`Product ${item.productId} not found in inventory`);
        }

        if (inventoryItem.availableQuantity < item.quantity) {
          throw new InsufficientInventoryError(
            `Insufficient inventory for product ${item.productId}. Available: ${inventoryItem.availableQuantity}, Requested: ${item.quantity}`,
          );
        }

        inventoryItem.reservedQuantity += item.quantity;
        inventoryItem.availableQuantity = inventoryItem.quantity - inventoryItem.reservedQuantity;

        await queryRunner.manager.save(inventoryItem);

        // Low stock notification check after reservation
        if (inventoryItem.availableQuantity < 5) {
          // Publish low stock alert to notification service
          await this.eventPublisher.publishLowStockAlert({
            productId: inventoryItem.productId,
            productName: inventoryItem.productName,
            totalQuantity: inventoryItem.quantity,
            reservedQuantity: inventoryItem.reservedQuantity,
            availableQuantity: inventoryItem.availableQuantity,
            threshold: 5,
          });

          this.logger.warn(
            `Low stock alert: ${inventoryItem.productId} (${inventoryItem.availableQuantity} available)`,
          );
        }
        this.logger.log(`Reserved ${item.quantity} units of ${item.productId}`);
      }

      await queryRunner.commitTransaction();
      this.logger.log('Inventory reservation completed successfully');
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Inventory reservation failed: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async releaseReservation(
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<boolean> {
    const queryRunner = this.inventoryRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const item of items) {
        const inventoryItem = await queryRunner.manager.findOne(InventoryItem, {
          where: { productId: item.productId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!inventoryItem) {
          this.logger.warn(
            `Product ${item.productId} not found in inventory during reservation release`,
          );
          continue;
        }

        inventoryItem.reservedQuantity = Math.max(
          0,
          inventoryItem.reservedQuantity - item.quantity,
        );
        inventoryItem.availableQuantity = inventoryItem.quantity - inventoryItem.reservedQuantity;

        await queryRunner.manager.save(inventoryItem);
        this.logger.log(`Released ${item.quantity} units of product ${item.productId}`);
      }

      await queryRunner.commitTransaction();
      this.logger.log('Inventory reservation release completed successfully');
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Inventory reservation release failed: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Finalize delivery - remove from reserved quantity and reduce total quantity
   */
  async finalizeDelivery(items: Array<{ productId: string; quantity: number }>): Promise<boolean> {
    this.logger.log(`Starting finalization for ${items.length} items:`);
    this.logger.log(JSON.stringify(items, null, 2));

    const queryRunner = this.inventoryRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const item of items) {
        this.logger.log(`Processing item: ${item.productId}, quantity: ${item.quantity}`);
        const inventoryItem = await queryRunner.manager.findOne(InventoryItem, {
          where: { productId: item.productId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!inventoryItem) {
          this.logger.warn(
            `Product ${item.productId} not found in inventory during delivery finalization`,
          );
          continue;
        }

        // Remove from reserved quantity
        const previousReserved = inventoryItem.reservedQuantity;
        const previousQuantity = inventoryItem.quantity;

        inventoryItem.reservedQuantity = Math.max(
          0,
          inventoryItem.reservedQuantity - item.quantity,
        );

        // Reduce total quantity (items are now delivered/consumed)
        inventoryItem.quantity = Math.max(0, inventoryItem.quantity - item.quantity);

        // Update available quantity - commented out for debugging
        inventoryItem.availableQuantity = inventoryItem.quantity - inventoryItem.reservedQuantity;
        this.logger.log(
          `✅ Available quantity updated: ${inventoryItem.availableQuantity} for ${item.productId}`,
        );

        this.logger.log(`📊 Inventory Update for ${item.productId}:`);
        this.logger.log(
          `   Reserved: ${previousReserved} → ${inventoryItem.reservedQuantity} (${previousReserved - inventoryItem.reservedQuantity})`,
        );
        this.logger.log(
          `   Total: ${previousQuantity} → ${inventoryItem.quantity} (${previousQuantity - inventoryItem.quantity})`,
        );
        this.logger.log(`   Available: ${inventoryItem.availableQuantity}`);

        // Database save
        this.logger.log(`🔄 About to save inventory item for ${item.productId}...`);
        await queryRunner.manager.save(inventoryItem);
        this.logger.log(`💾 Database save completed for ${item.productId}`);
        this.logger.log(
          `   Final state - Total: ${inventoryItem.quantity}, Reserved: ${inventoryItem.reservedQuantity}, Available: ${inventoryItem.availableQuantity}`,
        );

        // Create history record within transaction
        this.logger.log(`📝 Creating history record for ${item.productId}...`);
        const historyRecord = queryRunner.manager.create(InventoryHistory, {
          productId: item.productId,
          action: InventoryAction.DELIVERED,
          previousQuantity: previousQuantity,
          newQuantity: inventoryItem.quantity,
          quantityChange: -item.quantity,
          notes: `Order delivered - ${item.quantity} units consumed`,
          adminId: 'system-delivery',
        });
        await queryRunner.manager.save(InventoryHistory, historyRecord);
        this.logger.log(`📝 History record created for ${item.productId}`);

        this.logger.log(
          `Finalized delivery: ${item.quantity} units of product ${item.productId} (Total: ${inventoryItem.quantity}, Reserved: ${inventoryItem.reservedQuantity}, Available: ${inventoryItem.availableQuantity})`,
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log('Inventory delivery finalization completed successfully');
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Inventory delivery finalization failed: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async confirmReservation(items: Array<{ productId: string; quantity: number }>): Promise<void> {
    const queryRunner = this.inventoryRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const item of items) {
        const inventoryItem = await queryRunner.manager.findOne(InventoryItem, {
          where: { productId: item.productId },
          lock: { mode: 'pessimistic_write' },
        });

        if (inventoryItem) {
          inventoryItem.quantity -= item.quantity;
          inventoryItem.reservedQuantity -= item.quantity;
          inventoryItem.availableQuantity = inventoryItem.quantity - inventoryItem.reservedQuantity;

          await queryRunner.manager.save(inventoryItem);
          this.logger.log(`Confirmed ${item.quantity} units of product ${item.productId}`);
        }
      }

      await queryRunner.commitTransaction();
      this.logger.log('Inventory reservation confirmation completed');
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to confirm inventory reservation: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async remove(productId: string): Promise<void> {
    const item = await this.findOne(productId);

    // Soft delete - set status to INACTIVE
    item.status = InventoryStatus.INACTIVE;
    await this.inventoryRepository.save(item);

    this.logger.log(`Inventory item soft deleted (set to INACTIVE): ${productId}`);
  }

  private async createHistoryRecord(
    historyData: Partial<InventoryHistory>,
  ): Promise<InventoryHistory> {
    const historyRecord = new InventoryHistory(historyData);
    return await this.inventoryHistoryRepository.save(historyRecord);
  }
}

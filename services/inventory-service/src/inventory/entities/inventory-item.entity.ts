import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { InventoryStatus } from '../enums/inventory-status.enum';

@Entity('inventory_items')
export class InventoryItem {
  @PrimaryColumn()
  productId: string;

  @Column('int', { default: 0 })
  quantity: number;

  @Column('int', { default: 0 })
  reservedQuantity: number;

  @Column('int', { default: 0 })
  availableQuantity: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  price: number;

  @Column({ nullable: true })
  productName: string;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: InventoryStatus,
    default: InventoryStatus.ACTIVE,
  })
  status: InventoryStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  lastUpdated: Date;
}

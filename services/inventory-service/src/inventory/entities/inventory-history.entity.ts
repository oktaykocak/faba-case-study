import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { InventoryItem } from './inventory-item.entity';
import { InventoryAction } from '../enums/inventory-action.enum';

@Entity('inventory_history')
export class InventoryHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  productId: string;

  @Column({
    type: 'enum',
    enum: InventoryAction,
  })
  action: InventoryAction;

  @Column({ type: 'int', nullable: true })
  previousQuantity?: number;

  @Column({ type: 'int', nullable: true })
  newQuantity?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  previousPrice?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  newPrice?: number;

  @Column({ nullable: true })
  previousProductName?: string;

  @Column({ nullable: true })
  newProductName?: string;

  @Column({ type: 'text', nullable: true })
  previousDescription?: string;

  @Column({ type: 'text', nullable: true })
  newDescription?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ nullable: true })
  customerId?: string;

  @Column({ nullable: true })
  adminId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => InventoryItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId', referencedColumnName: 'productId' })
  inventoryItem: InventoryItem;

  constructor(partial: Partial<InventoryHistory>) {
    Object.assign(this, partial);
  }
}

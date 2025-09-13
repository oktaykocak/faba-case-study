import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { OrderStatus } from '@ecommerce/shared-types';

export enum OrderHistoryAction {
  CANCELLED = 'CANCELLED',
  STATUS_UPDATED = 'STATUS_UPDATED',
}

@Entity('order_history')
export class OrderHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  orderId: string;

  @Column({
    type: 'enum',
    enum: OrderHistoryAction,
  })
  action: OrderHistoryAction;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    nullable: true,
  })
  previousStatus?: OrderStatus;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    nullable: true,
  })
  newStatus?: OrderStatus;

  @Column({ nullable: true })
  customerId?: string; // Customer cancel işlemi için

  @Column({ nullable: true })
  adminId?: string; // Admin status update işlemi için

  @Column({ type: 'text', nullable: true })
  reason?: string; // Cancel reason veya status update reason

  @Column({ type: 'text', nullable: true })
  notes?: string; // Ek notlar

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId', referencedColumnName: 'id' })
  order: Order;

  constructor(partial: Partial<OrderHistory>) {
    Object.assign(this, partial);
  }
}

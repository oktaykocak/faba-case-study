import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationLog } from './entities/notification-log.entity';
import { EmailService } from './providers/email.service';
import { SmsService } from './providers/sms.service';
import { NotificationType, NotificationPayload } from '@ecommerce/shared-types';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationLog)
    private readonly notificationRepository: Repository<NotificationLog>,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
  ) {}

  async sendNotification(payload: NotificationPayload): Promise<NotificationLog> {
    this.logger.log(`Sending notification: ${payload.type} to ${payload.recipient}`);

    // Create notification log entry
    const notificationLog = this.notificationRepository.create({
      id: payload.id || uuidv4(),
      type: payload.type,
      recipient: payload.recipient,
      subject: payload.subject,
      message: payload.message,
      metadata: payload.metadata,
      sent: false,
      retryCount: 0,
    });

    const savedLog = await this.notificationRepository.save(notificationLog);

    try {
      // Send notification based on type
      switch (payload.type) {
        case NotificationType.EMAIL:
          await this.emailService.sendEmail({
            to: payload.recipient,
            subject: payload.subject || 'Notification',
            message: payload.message,
            metadata: payload.metadata,
          });
          break;

        case NotificationType.SMS:
          await this.smsService.sendSms({
            to: payload.recipient,
            message: payload.message,
            metadata: payload.metadata,
          });
          break;

        case NotificationType.PUSH:
          // Push notification implementation would go here
          this.logger.log('Push notification sent (mock)');
          break;

        default:
          throw new BadRequestException(`Unsupported notification type: ${payload.type}`);
      }

      // Mark as sent
      savedLog.sent = true;
      savedLog.sentAt = new Date();
      await this.notificationRepository.save(savedLog);

      this.logger.log(`Notification sent successfully: ${savedLog.id}`);
      return savedLog;
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error.message}`, error.stack);

      // Update log with error
      savedLog.error = error.message;
      savedLog.retryCount += 1;
      await this.notificationRepository.save(savedLog);

      throw error;
    }
  }

  async retryFailedNotification(notificationId: string): Promise<NotificationLog> {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification not found: ${notificationId}`);
    }

    if (notification.sent) {
      throw new BadRequestException(`Notification already sent: ${notificationId}`);
    }

    if (notification.retryCount >= 3) {
      throw new BadRequestException(`Maximum retry attempts reached: ${notificationId}`);
    }

    // Retry sending
    const payload: NotificationPayload = {
      id: notification.id,
      type: notification.type,
      recipient: notification.recipient,
      subject: notification.subject,
      message: notification.message,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    };

    return this.sendNotification(payload);
  }

  async findAll(): Promise<NotificationLog[]> {
    return this.notificationRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<NotificationLog> {
    const notification = await this.notificationRepository.findOne({ where: { id } });
    if (!notification) {
      throw new NotFoundException(`Notification not found: ${id}`);
    }
    return notification;
  }

  async findByRecipient(recipient: string): Promise<NotificationLog[]> {
    return this.notificationRepository.find({
      where: { recipient },
      order: { createdAt: 'DESC' },
    });
  }

  async findFailedNotifications(): Promise<NotificationLog[]> {
    return this.notificationRepository.find({
      where: { sent: false },
      order: { createdAt: 'DESC' },
    });
  }

  async markAsProcessed(id: string): Promise<NotificationLog> {
    const notification = await this.findOne(id);
    notification.sent = true;
    notification.sentAt = new Date();
    return this.notificationRepository.save(notification);
  }
}

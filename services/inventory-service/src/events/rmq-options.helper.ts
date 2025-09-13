import { Transport, RmqOptions } from '@nestjs/microservices';

export function getRmqOptions(queue: string): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://oktay:password@rabbitmq:5672'],
      queue,
      queueOptions: {
        durable: true,
      },
    },
  };
}

// Publisher configuration (for EventPublisher - ClientProxy)
export function getRmqOptionsForPublisher(queue: string, maxRetries: number = 3): RmqOptions {
  const dlqName = `${queue}.dlq`;
  const dlxName = `${queue}.dlx`;

  return {
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://oktay:password@rabbitmq:5672'],
      queue,
      queueOptions: {
        durable: true,
        arguments: {
          'x-message-ttl': parseInt(process.env.RABBITMQ_MESSAGE_TTL || '300000'), // 5 minutes
          'x-dead-letter-exchange': dlxName,
          'x-dead-letter-routing-key': dlqName,
          'x-max-retries': maxRetries,
        },
      },
      // Auto acknowledgment for publishers (no reply consumer conflict)
      noAck: true,
      // Prefetch count for better load distribution
      prefetchCount: 1,
    },
  };
}

// Consumer configuration (for MessagePattern handlers)
export function getRmqOptionsForConsumer(queue: string, maxRetries: number = 3): RmqOptions {
  const dlqName = `${queue}.dlq`;
  const dlxName = `${queue}.dlx`;

  return {
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://oktay:password@rabbitmq:5672'],
      queue,
      queueOptions: {
        durable: true,
        arguments: {
          'x-message-ttl': parseInt(process.env.RABBITMQ_MESSAGE_TTL || '300000'), // 5 minutes
          'x-dead-letter-exchange': dlxName,
          'x-dead-letter-routing-key': dlqName,
          'x-max-retries': maxRetries,
        },
      },
      // Manual acknowledgment for retry control
      noAck: false,
      // Prefetch count for better load distribution
      prefetchCount: 1,
    },
  };
}

// Backward compatibility - defaults to consumer config
export function getRmqOptionsWithDLQ(queue: string, maxRetries: number = 3): RmqOptions {
  return getRmqOptionsForConsumer(queue, maxRetries);
}

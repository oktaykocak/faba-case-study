import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from './inventory/inventory.module';
import { HealthModule } from './health/health.module';
import { InventoryItem } from './inventory/entities/inventory-item.entity';
import { InventoryHistory } from './inventory/entities/inventory-history.entity';
import { EventSequenceEntity } from './events/sequence.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'password'),
        database: configService.get('DB_NAME', 'inventory_db'),
        entities: [InventoryItem, InventoryHistory, EventSequenceEntity],
        synchronize: true, // configService.get('NODE_ENV') !== 'production',
        logging: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    InventoryModule,
    HealthModule,
  ],
})
export class AppModule {}

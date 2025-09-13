import {
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsPositive,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @IsString()
  productId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  // price kaldırıldı - inventory service'ten alınacak
  // @IsNumber()
  // @IsPositive()
  // price: number;
}

export class CreateOrderDto {
  // customerId artık middleware'den geliyor
  // @IsString()
  // customerId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

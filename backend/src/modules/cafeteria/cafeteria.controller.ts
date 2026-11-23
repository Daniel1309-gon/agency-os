import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { Authenticated, CurrentUser, RequirePermissions, RequireShift } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CafeteriaService } from './cafeteria.service.js';
import { orderListQuerySchema, orderSchema, salesSummaryQuerySchema, orderStatusSchema, productSchema, productUpdateSchema, type OrderInput, type OrderListQueryInput, type OrderStatusInput, type ProductInput, type ProductUpdateInput, type SalesSummaryQueryInput } from './cafeteria.schemas.js';

@Controller('cafeteria')
@Authenticated()
export class CafeteriaController {
  constructor(private readonly cafeteria: CafeteriaService) {}

  @Get('menu') menu() { return this.cafeteria.menu(); }

  @Post('products')
  @RequirePermissions('cafeteria.manage')
  @UsePipes(new ZodValidationPipe(productSchema))
  product(@Body() body: ProductInput, @CurrentUser() user: AccessTokenClaims) { return this.cafeteria.createProduct(body, user.sub); }

  @Get('products') @RequirePermissions('cafeteria.manage') products() { return this.cafeteria.products(); }
  @Patch('products/:id') @RequirePermissions('cafeteria.manage') @UsePipes(new ZodValidationPipe(productUpdateSchema)) updateProduct(@Param('id') id: string, @Body() body: ProductUpdateInput, @CurrentUser() user: AccessTokenClaims) { return this.cafeteria.updateProduct(id, body, user.sub); }

  @Post('orders')
  @RequireShift()
  @UsePipes(new ZodValidationPipe(orderSchema))
  order(@Body() body: OrderInput, @CurrentUser() user: AccessTokenClaims, @Headers('idempotency-key') idempotencyKey?: string) { return this.cafeteria.createOrder(body, user.sub, idempotencyKey ?? ''); }

  @Patch('orders/:id/status')
  @RequirePermissions('cafeteria.manage')
  @UsePipes(new ZodValidationPipe(orderStatusSchema))
  status(@Param('id') id: string, @Body() body: OrderStatusInput, @CurrentUser() user: AccessTokenClaims) { return this.cafeteria.updateStatus(id, body, user.sub); }

  @Get('orders') @RequirePermissions('cafeteria.manage') orders(@Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQueryInput) { return this.cafeteria.orders(query); }
  @Get('sales/summary') @RequirePermissions('cafeteria.manage') salesSummary(@Query(new ZodValidationPipe(salesSummaryQuerySchema)) query: SalesSummaryQueryInput) { return this.cafeteria.salesSummary(query); }
  @Post('orders/:id/cancel') cancel(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: AccessTokenClaims) { return this.cafeteria.cancelOrder(id, body?.reason, user); }
  @Get('accounts/me') account(@CurrentUser() user: AccessTokenClaims) { return this.cafeteria.account(user.sub); }
}

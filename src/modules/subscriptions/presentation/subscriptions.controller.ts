import { ParsePostgresUuidPipe } from "../../../common/http/parse-postgres-uuid.pipe";
import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../../../common/auth/policy.decorators";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { PlansService } from "../application/plans.service";
import { SubscriptionsService } from "../application/subscriptions.service";
import { RenewalContactsService } from "../application/renewal-contacts.service";
import {
  ActivateSubscriptionDto, ContactsResponseDto, CreatePendingSubscriptionDto, CreatePlanDto,
  ListPlansQueryDto, ListSubscriptionsQueryDto, SubscriptionListResponseDto, OwnerSubscriptionResponseDto, PatchPlanDto, PlanListResponseDto,
  PlanResponseDto, RenewSubscriptionDto, ReplaceContactsDto, SubscriptionResponseDto, OptionalSubscriptionResponseDto,
} from "./subscriptions.dto";

function requirePrincipal(request: AuthenticatedRequest) {
  if (!request.principal) throw new UnauthorizedException();
  return request.principal;
}

@ApiTags("Plans")
@ApiBearerAuth()
@Roles("PRIMARY_ADMIN", "PLATFORM_ADMIN")
@Controller("admin/plans")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Post() @ApiOperation({ summary: "Create a new plan with explicit limits and feature flags" })
  @ApiCreatedResponse({ type: PlanResponseDto })
  async create(@Body() body: CreatePlanDto, @Req() req: AuthenticatedRequest): Promise<PlanResponseDto> {
    return { data: await this.plans.create(body, requirePrincipal(req), req.requestId) };
  }

  @Get() @ApiOperation({ summary: "List plans with stable keyset pagination, default 20 max 100" })
  @ApiOkResponse({ type: PlanListResponseDto })
  async list(@Query() query: ListPlansQueryDto): Promise<PlanListResponseDto> {
    return this.plans.list(query);
  }

  @Get(":id") @ApiOkResponse({ type: PlanResponseDto })
  async get(@Param("id", new ParsePostgresUuidPipe()) id: string): Promise<PlanResponseDto> {
    return { data: await this.plans.get(id) };
  }

  @Patch(":id") @ApiOkResponse({ type: PlanResponseDto })
  async update(
    @Param("id", new ParsePostgresUuidPipe()) id: string, @Body() body: PatchPlanDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PlanResponseDto> {
    return { data: await this.plans.update(id, body, requirePrincipal(req), req.requestId) };
  }
}

@ApiTags("Subscriptions")
@ApiBearerAuth()
@Roles("PRIMARY_ADMIN", "PLATFORM_ADMIN")
@Controller("admin")
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get("subscriptions")
  @ApiOperation({ summary: "List subscriptions with restaurant and plan names and cursor pagination" })
  @ApiOkResponse({ type: SubscriptionListResponseDto })
  async list(@Query() query: ListSubscriptionsQueryDto): Promise<SubscriptionListResponseDto> {
    return this.subscriptions.list(query);
  }

  @Post("restaurants/:restaurantId/subscriptions")
  @ApiOperation({ summary: "Create a pending manual subscription for an existing restaurant" })
  @ApiCreatedResponse({ type: SubscriptionResponseDto })
  async create(
    @Param("restaurantId", new ParsePostgresUuidPipe()) restaurantId: string,
    @Body() body: CreatePendingSubscriptionDto, @Req() req: AuthenticatedRequest,
  ): Promise<SubscriptionResponseDto> {
    return { data: await this.subscriptions.withNames(await this.subscriptions.createPending(restaurantId, body, requirePrincipal(req), req.requestId)) };
  }

  @Get("restaurants/:restaurantId/subscription")
  @ApiOkResponse({ type: OptionalSubscriptionResponseDto })
  async current(@Param("restaurantId", new ParsePostgresUuidPipe()) restaurantId: string): Promise<OptionalSubscriptionResponseDto> {
    return { data: await this.subscriptions.currentForRestaurant(restaurantId) };
  }

  @Post("subscriptions/:id/activate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Activate pending subscription with explicit UTC start and grace period" })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  async activate(
    @Param("id", new ParsePostgresUuidPipe()) id: string,
    @Body() body: ActivateSubscriptionDto, @Req() req: AuthenticatedRequest,
  ): Promise<SubscriptionResponseDto> {
    return { data: await this.subscriptions.withNames(await this.subscriptions.activate(id, body, requirePrincipal(req), req.requestId)) };
  }

  @Post("subscriptions/:id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Immediately cancel a pending or active subscription, preserving history" })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  async cancel(
    @Param("id", new ParsePostgresUuidPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<SubscriptionResponseDto> {
    return { data: await this.subscriptions.withNames(
      await this.subscriptions.cancel(id, requirePrincipal(req), req.requestId),
    ) };
  }

  @Post("subscriptions/:id/renew")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Manually renew current subscription, preserving term history" })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  async renew(
    @Param("id", new ParsePostgresUuidPipe()) id: string,
    @Body() body: RenewSubscriptionDto, @Req() req: AuthenticatedRequest,
  ): Promise<SubscriptionResponseDto> {
    return { data: await this.subscriptions.withNames(await this.subscriptions.renew(id, body, requirePrincipal(req), req.requestId)) };
  }
}

@ApiTags("Renewal contacts")
@ApiBearerAuth()
@Roles("PRIMARY_ADMIN", "PLATFORM_ADMIN")
@Controller("admin/contact-methods")
export class RenewalContactsController {
  constructor(private readonly contacts: RenewalContactsService) {}

  @Get() @ApiOkResponse({ type: ContactsResponseDto })
  async list(): Promise<ContactsResponseDto> { return { data: await this.contacts.list(false) }; }

  @Patch() @ApiOkResponse({ type: ContactsResponseDto })
  async replace(@Body() body: ReplaceContactsDto, @Req() req: AuthenticatedRequest): Promise<ContactsResponseDto> {
    return { data: await this.contacts.replace(body.contacts, requirePrincipal(req), req.requestId) };
  }
}

@ApiTags("Owner subscription")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/subscription")
export class OwnerSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService, private readonly contacts: RenewalContactsService) {}

  @Get()
  @ApiOperation({ summary: "Owner subscription status and renewal contacts, including expired subscription" })
  @ApiOkResponse({ type: OwnerSubscriptionResponseDto })
  async view(@Req() req: AuthenticatedRequest): Promise<OwnerSubscriptionResponseDto> {
    const principal = requirePrincipal(req);
    if (!principal.restaurantId) throw new UnauthorizedException();
    const subscription = await this.subscriptions.currentForRestaurant(principal.restaurantId);
    return { data: { subscription, canOperate: subscription?.canOperate ?? false,
      renewalContacts: await this.contacts.list(true) } };
  }
}

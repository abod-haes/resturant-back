import { ParsePostgresUuidPipe } from "../../../common/http/parse-postgres-uuid.pipe";
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BranchScope, Public, Roles } from "../../../common/auth/policy.decorators";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { CategoriesService } from "../application/categories.service";
import { ProductsService } from "../application/products.service";
import { MenuCopyService } from "../application/menu-copy.service";
import { PublicMenuService } from "../application/public-menu.service";
import {
  CategoryListDto, CategoryResponseDto, CopyMenuDto, CopyMenuResponseDto, CreateCategoryDto,
  CreateProductDto, MenuPageDto, PatchCategoryDto, PatchProductDto,
  OwnerProductListQueryDto, ProductListDto, ProductResponseDto, PublicMenuResponseDto, PublicRestaurantResponseDto, PublicRestaurantIdentityResponseDto,
} from "./menu.dto";

function principal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}
const uuid = () => new ParsePostgresUuidPipe();

@ApiTags("Owner categories")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/categories")
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}
  @Get() @ApiOkResponse({ type: CategoryListDto })
  async list(@Param("branchId", uuid()) branchId: string,
    @Query() query: MenuPageDto, @Req() req: AuthenticatedRequest): Promise<CategoryListDto> {
    return this.service.list(principal(req), branchId, query);
  }
  @Post() @ApiCreatedResponse({ type: CategoryResponseDto })
  async create(@Param("branchId", uuid()) branchId: string,
    @Body() body: CreateCategoryDto, @Req() req: AuthenticatedRequest): Promise<CategoryResponseDto> {
    return { data: await this.service.create(principal(req), branchId, body, req.requestId) };
  }
  @Get(":id") @ApiOkResponse({ type: CategoryResponseDto })
  async get(@Param("branchId", uuid()) branchId: string,
    @Param("id", uuid()) id: string, @Req() req: AuthenticatedRequest): Promise<CategoryResponseDto> {
    return { data: await this.service.get(principal(req), branchId, id) };
  }
  @Patch(":id") @ApiOkResponse({ type: CategoryResponseDto })
  async patch(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Body() body: PatchCategoryDto, @Req() req: AuthenticatedRequest): Promise<CategoryResponseDto> {
    return { data: await this.service.patch(principal(req), branchId, id, body, req.requestId) };
  }
  @Delete(":id") @ApiOperation({ summary: "Soft-archive category; products remain historical and unpublished" })
  async archive(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Req() req: AuthenticatedRequest) {
    await this.service.archive(principal(req), branchId, id, req.requestId);
    return { data: { archived: true } };
  }
}

@ApiTags("Owner products")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/products")
export class ProductsController {
  constructor(private readonly service: ProductsService) {}
  @Get() @ApiOkResponse({ type: ProductListDto })
  async list(@Param("branchId", uuid()) branchId: string, @Query() query: OwnerProductListQueryDto,
    @Req() req: AuthenticatedRequest): Promise<ProductListDto> {
    return this.service.list(principal(req), branchId, query);
  }
  @Post() @ApiCreatedResponse({ type: ProductResponseDto })
  async create(@Param("branchId", uuid()) branchId: string, @Body() body: CreateProductDto,
    @Req() req: AuthenticatedRequest): Promise<ProductResponseDto> {
    return { data: await this.service.create(principal(req), branchId, body, req.requestId) };
  }
  @Get(":id") @ApiOkResponse({ type: ProductResponseDto })
  async get(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Req() req: AuthenticatedRequest): Promise<ProductResponseDto> {
    return { data: await this.service.get(principal(req), branchId, id) };
  }
  @Patch(":id") @ApiOkResponse({ type: ProductResponseDto })
  async patch(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Body() body: PatchProductDto, @Req() req: AuthenticatedRequest): Promise<ProductResponseDto> {
    return { data: await this.service.patch(principal(req), branchId, id, body, req.requestId) };
  }
  @Delete(":id") @ApiOperation({ summary: "Soft-archive product while retaining historical record" })
  async archive(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Req() req: AuthenticatedRequest) {
    await this.service.archive(principal(req), branchId, id, req.requestId);
    return { data: { archived: true } };
  }
}

@ApiTags("Owner menu copy")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/menu")
export class MenuCopyController {
  constructor(private readonly service: MenuCopyService) {}
  @Post("copy-from") @ApiOperation({ summary: "Copy independent menu into empty same-tenant branch" })
  @ApiCreatedResponse({ type: CopyMenuResponseDto })
  async copy(@Param("branchId", uuid()) branchId: string, @Body() body: CopyMenuDto,
    @Req() req: AuthenticatedRequest): Promise<CopyMenuResponseDto> {
    return { data: await this.service.copy(principal(req), branchId, body, req.requestId) };
  }
}

@ApiTags("Public menu")
@Public()
@Controller("public/menu")
export class PublicMenuController {
  constructor(private readonly service: PublicMenuService) {}
  @Get("restaurants/by-subdomain/:subdomain/identity") @ApiOkResponse({ type: PublicRestaurantIdentityResponseDto })
  async identity(@Param("subdomain") subdomain: string): Promise<PublicRestaurantIdentityResponseDto> {
    return { data: await this.service.restaurantIdentity(subdomain) };
  }
  @Get("restaurants/by-subdomain/:subdomain") @ApiOkResponse({ type: PublicRestaurantResponseDto })
  async restaurant(@Param("subdomain") subdomain: string): Promise<PublicRestaurantResponseDto> {
    return { data: await this.service.restaurantBySubdomain(subdomain) };
  }
  @Get(":slug") @ApiOperation({ summary: "Paginated public catalog, without table call credentials" })
  @ApiOkResponse({ type: PublicMenuResponseDto })
  async list(@Param("slug") slug: string, @Query() query: MenuPageDto): Promise<PublicMenuResponseDto> {
    return this.service.list(slug, query);
  }
  @Get(":slug/categories") @ApiOkResponse({ type: CategoryListDto })
  async categories(@Param("slug") slug: string, @Query() query: MenuPageDto): Promise<CategoryListDto> {
    return this.service.categories(slug, query);
  }
}

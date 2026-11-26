import { ParsePostgresUuidPipe } from "../../../common/http/parse-postgres-uuid.pipe";
import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req,
  Res, UnauthorizedException, UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { BranchScope, Roles } from "../../../common/auth/policy.decorators";
import { MAX_UPLOAD_BYTES } from "../application/media-content";
import { MediaService } from "../application/media.service";
import { ProductGalleryService } from "../application/product-gallery.service";
import {
  DocumentAccessResponseDto, GalleryResponseDto, MediaListQueryDto,
  MediaListResponseDto, MediaResponseDto, ReplaceGalleryDto,
} from "./media.dto";

const uuid = () => new ParseUUIDPipe({ version: "4" });
function principal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}
const upload = FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
const fileSchema = { schema: {
  type: "object", required: ["file"],
  properties: { file: { type: "string", format: "binary" } },
} };

@ApiTags("Owner media library")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/media")
export class MediaController {
  constructor(private readonly service: MediaService) {}

  @Post("images")
  @UseInterceptors(upload)
  @ApiConsumes("multipart/form-data")
  @ApiBody(fileSchema)
  @ApiCreatedResponse({ type: MediaResponseDto })
  @ApiOperation({ summary: "JPEG/PNG/WebP upload, EXIF stripped, resized and encoded WebP, max input 8 MiB" })
  async uploadImage(@Param("branchId", uuid()) branchId: string, @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedRequest): Promise<MediaResponseDto> {
    return { data: await this.service.upload(principal(req), branchId, "image", file, req.requestId) };
  }

  @Post("documents")
  @UseInterceptors(upload)
  @ApiConsumes("multipart/form-data")
  @ApiBody(fileSchema)
  @ApiCreatedResponse({ type: MediaResponseDto })
  @ApiOperation({ summary: "Upload private PDF, max 10 MiB, never exposed in public menu" })
  async uploadDocument(@Param("branchId", uuid()) branchId: string, @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedRequest): Promise<MediaResponseDto> {
    return { data: await this.service.upload(principal(req), branchId, "document", file, req.requestId) };
  }

  @Get()
  @ApiOkResponse({ type: MediaListResponseDto })
  async list(@Param("branchId", uuid()) branchId: string, @Query() query: MediaListQueryDto,
    @Req() req: AuthenticatedRequest): Promise<MediaListResponseDto> {
    return this.service.list(principal(req), branchId, query);
  }

  @Get(":id/download")
  @ApiOkResponse({ type: DocumentAccessResponseDto })
  @ApiOperation({ summary: "Authorized 60-second S3 signed attachment download of private PDF" })
  async download(@Param("branchId", uuid()) branchId: string,
    @Param("id", uuid()) assetId: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req: AuthenticatedRequest): Promise<DocumentAccessResponseDto> {
    res.setHeader("Cache-Control", "no-store");
    return { data: await this.service.documentDownload(principal(req), branchId, assetId) };
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete only unreferenced assets; persist deletion for retry on S3 failure" })
  async remove(@Param("branchId", uuid()) branchId: string,
    @Param("id", uuid()) assetId: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.service.remove(principal(req), branchId, assetId, req.requestId) };
  }
}

@ApiTags("Owner product gallery")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/products/:productId/gallery")
export class ProductGalleryController {
  constructor(private readonly service: ProductGalleryService) {}

  @Get()
  @ApiOkResponse({ type: GalleryResponseDto })
  async list(@Param("branchId", uuid()) branchId: string,
    @Param("productId", uuid()) productId: string,
    @Req() req: AuthenticatedRequest): Promise<GalleryResponseDto> {
    return { data: await this.service.list(principal(req), branchId, productId) };
  }

  @Put()
  @ApiOkResponse({ type: GalleryResponseDto })
  @ApiOperation({ summary: "Atomic full gallery replacement: ordered mediaIds, first image is primary, max 8" })
  async replace(@Param("branchId", uuid()) branchId: string, @Param("productId", uuid()) productId: string,
    @Body() body: ReplaceGalleryDto, @Req() req: AuthenticatedRequest): Promise<GalleryResponseDto> {
    return { data: await this.service.replace(principal(req), branchId, productId, body, req.requestId) };
  }
}

@ApiTags("Platform restaurant branding")
@ApiBearerAuth()
@Roles("PRIMARY_ADMIN", "PLATFORM_ADMIN")
@Controller("admin/restaurants/:restaurantId/branding")
export class AdminBrandingMediaController {
  constructor(private readonly service: MediaService) {}
  @Delete("logo/:id")
  async discard(@Param("restaurantId", new ParsePostgresUuidPipe()) restaurantId: string, @Param("id", uuid()) id: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.service.removeRestaurantImage(principal(req), restaurantId, id, req.requestId) };
  }
  @Post("logo") @UseInterceptors(upload) @ApiConsumes("multipart/form-data") @ApiBody(fileSchema)
  @ApiCreatedResponse({ type: MediaResponseDto })
  async logo(@Param("restaurantId", new ParsePostgresUuidPipe()) restaurantId: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: AuthenticatedRequest): Promise<MediaResponseDto> {
    return { data: await this.service.uploadRestaurantLogo(principal(req), restaurantId, file, req.requestId) };
  }
}

@ApiTags("Owner branding")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/restaurant/branding")
export class OwnerBrandingMediaController {
  constructor(private readonly service: MediaService) {}
  @Delete("logo/:id")
  async discard(@Param("id", uuid()) id: string, @Req() req: AuthenticatedRequest) {
    const actor = principal(req);
    if (!actor.restaurantId) throw new UnauthorizedException();
    return { data: await this.service.removeRestaurantImage(actor, actor.restaurantId, id, req.requestId) };
  }
  @Post("logo") @UseInterceptors(upload) @ApiConsumes("multipart/form-data") @ApiBody(fileSchema)
  @ApiCreatedResponse({ type: MediaResponseDto })
  async logo(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: AuthenticatedRequest): Promise<MediaResponseDto> {
    const actor = principal(req);
    if (actor.role !== "RESTAURANT_OWNER" || !actor.restaurantId) throw new UnauthorizedException();
    return { data: await this.service.uploadRestaurantLogo(actor, actor.restaurantId, file, req.requestId) };
  }
}

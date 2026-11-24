import { ParsePostgresUuidPipe } from "../../../common/http/parse-postgres-uuid.pipe";
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param,
  Patch, Post, Query, Req, Res, UnauthorizedException, BadRequestException,
} from "@nestjs/common";
import {
  ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation,
  ApiProduces, ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../../common/auth/authenticated-request";
import { BranchScope, Public, Roles } from "../../../common/auth/policy.decorators";
import { FacilitiesService } from "../application/facilities.service";
import { TablesService } from "../application/tables.service";
import { QrService } from "../application/qr.service";
import { QrPrintService } from "../application/qr-print.service";
import {
  ArchiveEnvelopeDto, AreaListResponseDto, AreaResponseDto, CreateAreaDto, CreateFloorDto,
  CreateTableDto, CreateTablesBulkDto, FloorListResponseDto, FloorResponseDto,
  PatchAreaDto, PatchFloorDto, PatchTableDto, PublicTableContextResponseDto,
  QrCodeResponseDto, QrPrintQueryDto, RestaurantTableBulkResponseDto,
  RestaurantTableListResponseDto, RestaurantTableResponseDto, TableListQueryDto,
} from "./tables.dto";

function principal(req: AuthenticatedRequest) {
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}
const uuid = () => new ParsePostgresUuidPipe();

@ApiTags("Owner floors")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/floors")
export class FloorsController {
  constructor(private readonly facilities: FacilitiesService) {}
  @Get() @ApiOkResponse({ type: FloorListResponseDto })
  async list(@Param("branchId", uuid()) branchId: string, @Query() query: TableListQueryDto,
    @Req() req: AuthenticatedRequest): Promise<FloorListResponseDto> {
    return this.facilities.floors(principal(req), branchId, query);
  }
  @Post() @ApiCreatedResponse({ type: FloorResponseDto })
  async create(@Param("branchId", uuid()) branchId: string, @Body() dto: CreateFloorDto,
    @Req() req: AuthenticatedRequest): Promise<FloorResponseDto> {
    return { data: await this.facilities.createFloor(principal(req), branchId, dto, req.requestId) };
  }
  @Patch(":id") @ApiOkResponse({ type: FloorResponseDto })
  async patch(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Body() dto: PatchFloorDto, @Req() req: AuthenticatedRequest): Promise<FloorResponseDto> {
    return { data: await this.facilities.patchFloor(principal(req), branchId, id, dto, req.requestId) };
  }
  @Delete(":id") @ApiOkResponse({ type: ArchiveEnvelopeDto })
  async archive(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Req() req: AuthenticatedRequest): Promise<ArchiveEnvelopeDto> {
    return { data: await this.facilities.archiveFloor(principal(req), branchId, id, req.requestId) };
  }
}

@ApiTags("Owner areas")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/areas")
export class AreasController {
  constructor(private readonly facilities: FacilitiesService) {}
  @Get() @ApiOkResponse({ type: AreaListResponseDto })
  async list(@Param("branchId", uuid()) branchId: string, @Query() query: TableListQueryDto,
    @Req() req: AuthenticatedRequest): Promise<AreaListResponseDto> {
    return this.facilities.areas(principal(req), branchId, query);
  }
  @Post() @ApiCreatedResponse({ type: AreaResponseDto })
  async create(@Param("branchId", uuid()) branchId: string, @Body() dto: CreateAreaDto,
    @Req() req: AuthenticatedRequest): Promise<AreaResponseDto> {
    return { data: await this.facilities.createArea(principal(req), branchId, dto, req.requestId) };
  }
  @Patch(":id") @ApiOkResponse({ type: AreaResponseDto })
  async patch(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Body() dto: PatchAreaDto, @Req() req: AuthenticatedRequest): Promise<AreaResponseDto> {
    return { data: await this.facilities.patchArea(principal(req), branchId, id, dto, req.requestId) };
  }
  @Delete(":id") @ApiOkResponse({ type: ArchiveEnvelopeDto })
  async archive(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Req() req: AuthenticatedRequest): Promise<ArchiveEnvelopeDto> {
    return { data: await this.facilities.archiveArea(principal(req), branchId, id, req.requestId) };
  }
}

@ApiTags("Owner tables")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/tables")
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get() @ApiOkResponse({ type: RestaurantTableListResponseDto })
  async list(@Param("branchId", uuid()) branchId: string, @Query() query: TableListQueryDto,
    @Req() req: AuthenticatedRequest): Promise<RestaurantTableListResponseDto> {
    return this.tables.list(principal(req), branchId, query);
  }
  @Post() @ApiCreatedResponse({ type: RestaurantTableResponseDto })
  async create(@Param("branchId", uuid()) branchId: string, @Body() dto: CreateTableDto,
    @Req() req: AuthenticatedRequest): Promise<RestaurantTableResponseDto> {
    return { data: await this.tables.create(principal(req), branchId, dto, req.requestId) };
  }
  @Post("bulk") @ApiOperation({ summary: "Atomic bulk creation of 1-50 tables under restaurant quota lock" })
  @ApiCreatedResponse({ type: RestaurantTableBulkResponseDto })
  async bulk(@Param("branchId", uuid()) branchId: string, @Body() dto: CreateTablesBulkDto,
    @Req() req: AuthenticatedRequest): Promise<RestaurantTableBulkResponseDto> {
    return { data: await this.tables.bulkCreate(principal(req), branchId, dto, req.requestId) };
  }
  @Get(":id") @ApiOkResponse({ type: RestaurantTableResponseDto })
  async get(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Req() req: AuthenticatedRequest): Promise<RestaurantTableResponseDto> {
    return { data: await this.tables.get(principal(req), branchId, id) };
  }
  @Patch(":id") @ApiOkResponse({ type: RestaurantTableResponseDto })
  async patch(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Body() dto: PatchTableDto, @Req() req: AuthenticatedRequest): Promise<RestaurantTableResponseDto> {
    return { data: await this.tables.patch(principal(req), branchId, id, dto, req.requestId) };
  }
  @Delete(":id") @ApiOkResponse({ type: ArchiveEnvelopeDto })
  async archive(@Param("branchId", uuid()) branchId: string, @Param("id", uuid()) id: string,
    @Req() req: AuthenticatedRequest): Promise<ArchiveEnvelopeDto> {
    return { data: await this.tables.archive(principal(req), branchId, id, req.requestId) };
  }
}

@ApiTags("Owner QR")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@Controller("owner/tables/:tableId/qr")
export class QrOwnerController {
  constructor(private readonly qr: QrService) {}
  @Get() @ApiOkResponse({ type: QrCodeResponseDto })
  async get(@Param("tableId", uuid()) id: string, @Req() req: AuthenticatedRequest): Promise<QrCodeResponseDto> {
    return { data: await this.qr.get(principal(req), id) };
  }
  @Post("rotate") @HttpCode(HttpStatus.OK) @ApiOkResponse({ type: QrCodeResponseDto })
  async rotate(@Param("tableId", uuid()) id: string, @Req() req: AuthenticatedRequest): Promise<QrCodeResponseDto> {
    return { data: await this.qr.rotate(principal(req), id, req.requestId) };
  }
  @Post("disable") @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disable QR access while preserving credential for explicit re-enable" })
  async disable(@Param("tableId", uuid()) id: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.qr.disable(principal(req), id, req.requestId) };
  }
}

@ApiTags("Owner QR printing")
@ApiBearerAuth()
@Roles("RESTAURANT_OWNER")
@BranchScope("branchId")
@Controller("owner/branches/:branchId/qr")
export class QrPrintController {
  constructor(private readonly qr: QrService, private readonly printer: QrPrintService) {}
  @Get("print") @ApiProduces("application/pdf")
  @ApiOperation({ summary: "Printable A4 PDF of at most 100 active table QR stickers" })
  async print(@Param("branchId", uuid()) branchId: string, @Query() query: QrPrintQueryDto,
    @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const raw = query.tableIds;
    let ids: string[] | null = null;
    if (raw !== undefined) {
      ids = raw.split(",").map((v) => v.trim());
      if (!ids.length || ids.length > 100 || ids.some((id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        || new Set(ids).size !== ids.length) {
        throw new BadRequestException("tableIds must contain 1-100 distinct PostgreSQL UUID values");
      }
    }
    const items = await this.qr.printable(principal(req), branchId, ids);
    const pdf = await this.printer.render(items);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="table-qr-labels.pdf"');
    res.setHeader("Cache-Control", "no-store");
    res.end(pdf);
  }
}

@ApiTags("Public table QR")
@Public()
@Controller("public/t")
export class PublicTableQrController {
  constructor(private readonly qr: QrService) {}
  @Get(":qrToken") @ApiOkResponse({ type: PublicTableContextResponseDto })
  @ApiOperation({ summary: "Resolve an active table QR into read-only table/menu context; no visit sessions or calls yet" })
  async resolve(@Param("qrToken") token: string,
    @Res({ passthrough: true }) res: Response): Promise<PublicTableContextResponseDto> {
    res.setHeader("Cache-Control", "no-store");
    return { data: await this.qr.resolvePublic(token) };
  }
}

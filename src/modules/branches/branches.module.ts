import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { BranchesController } from "./presentation/branches.controller";
import { BranchesService } from "./application/branches.service";

@Module({ imports: [DatabaseModule], controllers: [BranchesController], providers: [BranchesService] })
export class BranchesModule {}

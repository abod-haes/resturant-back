import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/presentation/auth.module";
import { RealtimeService } from "./application/realtime.service";
import { RealtimeController } from "./presentation/realtime.controller";

@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [RealtimeService],
  controllers: [RealtimeController],
  exports: [RealtimeService],
})
export class RealtimeModule {}

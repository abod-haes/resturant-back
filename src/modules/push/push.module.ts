import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { DeviceRegistryService } from "./application/device-registry.service";
import { PushDispatcherService } from "./application/push-dispatcher.service";
import { ExpoPushGateway, PUSH_GATEWAY } from "./infrastructure/expo-push.gateway";
import { PushDevicesController } from "./presentation/push.controller";

@Module({
  imports: [DatabaseModule],
  providers: [
    DeviceRegistryService, PushDispatcherService,
    { provide: PUSH_GATEWAY, useClass: ExpoPushGateway },
  ],
  controllers: [PushDevicesController],
  exports: [PushDispatcherService, PUSH_GATEWAY],
})
export class PushModule {}

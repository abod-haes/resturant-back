import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { DeviceRegistryService } from "./application/device-registry.service";
import { PushDispatcherService } from "./application/push-dispatcher.service";
import { ExpoPushGateway, PUSH_GATEWAY } from "./infrastructure/expo-push.gateway";
import { PushDevicesController } from "./presentation/push.controller";

import { WebDeviceRegistryService } from "./application/web-device-registry.service";
import { WebPushController } from "./presentation/web-push.controller";

@Module({
  imports: [DatabaseModule],
  providers: [
    DeviceRegistryService, WebDeviceRegistryService, PushDispatcherService,
    { provide: PUSH_GATEWAY, useClass: ExpoPushGateway },
  ],
  controllers: [PushDevicesController, WebPushController],
  exports: [PushDispatcherService, PUSH_GATEWAY],
})
export class PushModule {}

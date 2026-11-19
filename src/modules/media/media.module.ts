import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { MediaService } from "./application/media.service";
import { ProductGalleryService } from "./application/product-gallery.service";
import { MEDIA_STORAGE, S3MediaStorageGateway } from "./infrastructure/media-storage.gateway";
import { MediaController, ProductGalleryController } from "./presentation/media.controller";

@Module({
  imports: [DatabaseModule],
  providers: [
    MediaService, ProductGalleryService,
    { provide: MEDIA_STORAGE, useClass: S3MediaStorageGateway },
  ],
  controllers: [MediaController, ProductGalleryController],
  exports: [MediaService],
})
export class MediaModule {}

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CategoriesService } from "./application/categories.service";
import { ProductsService } from "./application/products.service";
import { MenuCopyService } from "./application/menu-copy.service";
import { PublicMenuService } from "./application/public-menu.service";
import {
  CategoriesController, ProductsController, MenuCopyController, PublicMenuController,
} from "./presentation/menu.controller";

@Module({
  imports: [DatabaseModule],
  providers: [CategoriesService, ProductsService, MenuCopyService, PublicMenuService],
  controllers: [CategoriesController, ProductsController, MenuCopyController, PublicMenuController],
})
export class MenuModule {}

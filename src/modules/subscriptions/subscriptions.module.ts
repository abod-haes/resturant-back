import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { PlansService } from "./application/plans.service";
import { SubscriptionsService } from "./application/subscriptions.service";
import { RenewalContactsService } from "./application/renewal-contacts.service";
import {
  PlansController, SubscriptionsController, RenewalContactsController, OwnerSubscriptionController,
} from "./presentation/subscriptions.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [PlansController, SubscriptionsController, RenewalContactsController, OwnerSubscriptionController],
  providers: [PlansService, SubscriptionsService, RenewalContactsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}

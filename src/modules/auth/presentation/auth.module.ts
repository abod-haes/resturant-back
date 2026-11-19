import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { DatabaseModule } from "../../../database/database.module";
import { AuthService } from "../application/auth.service";
import { LoginThrottleService } from "../application/login-throttle.service";
import { AuthController } from "./auth.controller";
import { AccessGuard, RoleGuard, ScopeGuard } from "./auth.guards";

@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService, LoginThrottleService,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}

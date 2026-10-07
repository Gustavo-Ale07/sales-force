import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { AccessGuard } from './access.guard.js';
import { AccountRepository } from './account.repository.js';
import { AccountService } from './account.service.js';
import { AuditService } from './audit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import type { AuthConfig } from './auth-config.js';
import { DrizzleExternalAccountLinks } from './drizzle-external-account-links.js';
import { AUTH_CONFIG, EXTERNAL_ACCOUNT_LINKS, EXTERNAL_IDENTITY_VERIFIER, PASSWORD_HASHER } from './iam-tokens.js';
import { Argon2idPasswordHasher } from './password-hasher.js';
import { PolicyService } from './policy.service.js';
import { SankhyaIdentityVerifier } from './sankhya-identity-verifier.js';
import { SessionRepository } from './session.repository.js';
import { ThrottleRepository } from './throttle.repository.js';

/**
 * Identity and access (RF-IAM, AUTH-1..4 PROPOSED): accounts, sessions, throttling, audit, the
 * central policy and the global access guard. Registered in the API process only.
 */
@Global()
@Module({})
export class IamModule {
  static register(config: AuthConfig): DynamicModule {
    const external = config.externalLogin;
    // Directory login is wired only when explicitly enabled WITH a verifier endpoint; otherwise the optional ports stay
    // absent and `loginExternal` fails closed. Only `EXTERNAL_LOGIN_ENABLED=1` turns it on (`authConfigFromEnv`).
    const externalProviders: Provider[] =
      external?.enabled === true && external.verifier !== undefined
        ? [
            {
              provide: EXTERNAL_IDENTITY_VERIFIER,
              useValue: new SankhyaIdentityVerifier({ url: external.verifier.url, sharedSecret: external.verifier.sharedSecret }),
            },
            { provide: EXTERNAL_ACCOUNT_LINKS, useClass: DrizzleExternalAccountLinks },
          ]
        : [];
    return {
      module: IamModule,
      imports: [ConfigurationModule],
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: config },
        { provide: PASSWORD_HASHER, useValue: new Argon2idPasswordHasher(config.passwordHash) },
        AccountRepository,
        SessionRepository,
        ThrottleRepository,
        AuditService,
        AuthService,
        AccountService,
        PolicyService,
        ...externalProviders,
        // Global default-deny guard: every handler of the process passes through it.
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
      exports: [AuthService, AccountService, PolicyService, AuditService],
    };
  }
}

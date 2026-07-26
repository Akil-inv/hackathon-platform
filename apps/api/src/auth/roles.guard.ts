import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global role that bypasses every @Roles() check.
 *
 * Without this, SUPER_ADMIN is the least privileged role in the system: it
 * appears in no @Roles() list, so `requiredRoles.includes(user.role)` is false
 * for every guarded resolver.
 */
const SUPER_ADMIN = 'SUPER_ADMIN';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const user = this.getUser(context);
    if (!user) return false;

    if (user.role === SUPER_ADMIN) return true;

    return requiredRoles.includes(user.role);
  }

  /**
   * Resolves the request user for both GraphQL and REST handlers.
   *
   * The previous version assumed GraphQL unconditionally, which throws a
   * TypeError on HTTP routes because GqlExecutionContext.getContext() has no
   * `req`. That only stayed hidden because no REST controller carries @Roles()
   * today — adding one would have produced a 500 rather than a 403.
   */
  private getUser(context: ExecutionContext): { role?: string } | null {
    if (context.getType<'graphql' | 'http'>() === 'graphql') {
      const gqlContext = GqlExecutionContext.create(context).getContext();
      return gqlContext?.req?.user ?? null;
    }

    return context.switchToHttp().getRequest()?.user ?? null;
  }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = String(req?.user?.role || '').toUpperCase();
    if (role !== 'ADMIN') {
      throw new ForbiddenException('Solo administradores');
    }
    return true;
  }
}

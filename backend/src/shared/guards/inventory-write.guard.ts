import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class InventoryWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = String(req?.user?.role || '').toUpperCase();
    if (!['ADMIN', 'WAREHOUSE', 'USER'].includes(role)) {
      throw new ForbiddenException('Este perfil solo tiene acceso de consulta');
    }
    return true;
  }
}

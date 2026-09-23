import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/database.service';

/**
 * Lets modules seed their defaults when a new tenant is created (e.g. CRM creates the default
 * funnels) without the identity module depending on them. Provisioners run inside the tenant
 * creation transaction, with app.tenant_id already set, so RLS applies and everything commits
 * or rolls back together.
 */
export interface TenantProvisioner {
  provision(tx: Tx, tenantId: string): Promise<void>;
}

@Injectable()
export class TenantProvisioning {
  private readonly provisioners: TenantProvisioner[] = [];

  register(provisioner: TenantProvisioner): void {
    this.provisioners.push(provisioner);
  }

  async run(tx: Tx, tenantId: string): Promise<void> {
    for (const p of this.provisioners) await p.provision(tx, tenantId);
  }
}

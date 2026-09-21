import { Inject, Injectable } from '@nestjs/common';
import type { DashboardResponse, MetricGroup } from '@salesforce/contracts';
import { PricingService } from '../catalog/pricing.service.js';
import { productFilterOf } from '../catalog/catalog.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { MirrorRepository } from '../mirror/mirror.repository.js';
import { OrdersService } from '../orders/orders.service.js';
import { CLOCK, type Clock } from '../platform/tokens.js';

const count = (value: number) => ({ kind: 'count', value }) as const;

/**
 * Dashboard KPIs inside the actor's scope. Only figures that are plain counts or sums over mirrored
 * or draft data are computed. Credit and positivation rules are UNDECIDED, so those groups carry
 * `value: null` with an explanation instead of an invented figure. No cost or margin exists here (P-20).
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(user: CurrentUser): Promise<DashboardResponse> {
    const { scope, configuration } = await this.policy.accessContext(user);
    const now = this.clock();

    const productBase = { ...productFilterOf(configuration), sort: 'code' } as const;
    const book = await this.pricing.open(this.pricing.forCatalogReference(configuration), now);
    const [customers, visible, sellable, sellableWithoutPrice, figures] = await Promise.all([
      this.mirror.countCustomers(scope),
      this.mirror.countProducts(productBase, book.versionId),
      this.mirror.countProducts({ ...productBase, sellable: true }, book.versionId),
      this.mirror.countProducts({ ...productBase, sellable: true, priceState: 'none' }, book.versionId),
      this.orders.dashboardFigures(scope),
    ]);

    const groups: MetricGroup[] = [
      {
        key: 'portfolio',
        label: 'Carteira de clientes',
        demo: false,
        metrics: [
          { key: 'customers_total', label: 'Clientes na carteira', value: count(customers.total), description: null },
          { key: 'customers_active', label: 'Clientes ativos e liberados', value: count(customers.active), description: null },
          { key: 'customers_blocked', label: 'Clientes bloqueados', value: count(customers.blocked), description: null },
          {
            key: 'customers_without_price_table',
            label: 'Clientes sem tabela de preço',
            value: count(customers.withoutPriceTable),
            description: null,
          },
        ],
      },
      {
        key: 'catalog',
        label: 'Catálogo',
        demo: false,
        metrics: [
          { key: 'products_visible', label: 'Produtos visíveis', value: count(visible), description: null },
          { key: 'products_sellable', label: 'Produtos vendáveis', value: count(sellable), description: null },
          {
            key: 'products_sellable_without_price',
            label: 'Vendáveis sem preço na tabela de referência',
            value: configuration.pricing.catalogReferenceTableCode === null ? null : count(sellableWithoutPrice),
            description:
              configuration.pricing.catalogReferenceTableCode === null
                ? 'A instalação não define uma tabela de referência do catálogo.'
                : null,
          },
        ],
      },
      {
        key: 'orders',
        label: 'Pedidos',
        demo: false,
        metrics: [
          { key: 'drafts', label: 'Rascunhos em aberto', value: count(figures.counts.drafts), description: null },
          {
            key: 'drafts_estimated_total',
            label: 'Valor estimado dos rascunhos',
            value: { kind: 'money', value: figures.counts.draftsEstimatedTotal },
            description: 'Estimativa pelo preço de lista; linhas sem preço não entram na soma.',
          },
          { key: 'cancelled', label: 'Rascunhos descartados', value: count(figures.counts.cancelled), description: null },
        ],
      },
      {
        key: 'credit',
        label: 'Crédito',
        demo: false,
        metrics: [
          {
            key: 'credit_indicators',
            label: 'Indicadores de crédito',
            value: null,
            description: 'As regras de crédito ainda não foram definidas.',
          },
        ],
      },
      {
        key: 'positivation',
        label: 'Positivação',
        demo: false,
        metrics: [
          {
            key: 'positivation_rate',
            label: 'Positivação da carteira',
            value: null,
            description: 'A regra de positivação ainda não foi definida.',
          },
        ],
      },
    ];

    return {
      generatedAt: now.toISOString(),
      scope: scope.kind === 'all' ? { kind: 'all', sellerCodes: [] } : { kind: 'sellers', sellerCodes: [...scope.sellerCodes] },
      groups,
      recentOrders: figures.recent,
    };
  }
}

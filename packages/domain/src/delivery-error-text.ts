/**
 * K3: why the last delivery of a "Precisa de correção" order failed, from the stable class and code only (never the stored text).
 * One text for the site and the app (parity matrix, Lote 0). Moved here from the web labels with the wording unchanged.
 */
export interface DeliveryErrorInput {
  readonly errorClass: string;
  readonly errorCode?: string | null | undefined;
  /** The ERP's own short refusal text (`erp_refused_order` only). */
  readonly message?: string | null | undefined;
}

const DELIVERY_CODE_LABELS: Readonly<Record<string, string>> = {
  environment_mismatch: 'Configuração de ambiente divergente — avise o TI',
  environment_unbound: 'Configuração de ambiente divergente — avise o TI',
  dataset_not_erp: 'Pedido criado com dados de teste: não pode ser enviado ao Sankhya',
  send_disabled: 'Envio ao Sankhya desligado',
  submission_disabled: 'Envio ao Sankhya desligado',
  missing_company: 'Empresa do pedido não configurada — avise o TI',
  missing_top: 'TOP do pedido não definida',
  top_not_eligible: 'TOP do pedido não permitida para envio',
  missing_stock_location: 'Local de estoque não configurado — avise o TI',
  missing_negotiation_type: 'Tipo de negociação não informado',
  missing_freight_type: 'Frete não informado',
  missing_carrier: 'Transportadora não informada',
  no_items: 'Pedido sem itens',
  missing_unit: 'Item sem unidade',
  no_price: 'Item sem preço',
  price_divergence: 'O preço mudou depois do pedido, ou o Sankhya gravou um preço diferente do enviado. Refaça o pedido',
  discount_divergence: 'O Sankhya gravou um desconto diferente do enviado',
  item_mismatch: 'Os itens gravados no Sankhya diferem dos enviados',
  ipi_divergence: 'O Sankhya calculou um IPI diferente da estimativa do Force',
  total_divergence: 'O total da nota no Sankhya difere do total do Force (itens líquidos + IPI)',
  order_not_deliverable: 'O pedido não estava em situação de envio',
  include_timeout_unconfirmed: 'O Sankhya não confirmou o recebimento a tempo. Reenvie: o Force PLAC confere antes de criar o pedido',
  ambiguous_origin: 'Há mais de uma nota com este pedido no Sankhya. Peça à TI para conferir.',
};

export function deliveryErrorText(delivery: DeliveryErrorInput | null | undefined): string | null {
  if (!delivery) return null;
  const byCode = delivery.errorCode ? DELIVERY_CODE_LABELS[delivery.errorCode] : undefined;
  if (byCode) return byCode;
  if (delivery.errorCode === 'erp_refused_order') return delivery.message ? `O Sankhya recusou o pedido: ${delivery.message}` : 'O Sankhya recusou o pedido';
  if (delivery.errorClass === 'validation') return 'O Sankhya ou o Force recusou os dados do pedido';
  return `Falha no envio (${delivery.errorClass}${delivery.errorCode ? ` / ${delivery.errorCode}` : ''})`;
}

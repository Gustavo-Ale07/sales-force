import { describe, expect, it } from 'vitest';
import {
  FakePartnerBook,
  FakeGateway,
  RealSankhyaGateway,
  SankhyaGatewayError,
  Secret,
  type CustomerWriteSettings,
  type PartnerWriteRequest,
} from '../src/index.js';
import type { HttpResponse, HttpTransport } from '../src/real/transport.js';
import { MockSankhya, TEST_CREDENTIALS, ok, type ClockRef } from './support/mock-sankhya.js';

// Edit of an existing customer (D-AP, owner approval 2026-11-25, Sandbox only). The wire stays NEEDS VALIDATION (roteiro T5).

const OPEN: CustomerWriteSettings = { enabled: true, originField: 'AD_FORCEORIGEM', priceTableCode: 5 };
const saveOk: HttpResponse = { status: 200, headers: {}, body: JSON.stringify({ status: '1' }) };

function realHarness() {
  const clock: ClockRef = { now: 1_800_000_000_000 };
  const mock = new MockSankhya({ tables: {}, clock });
  const saves: string[] = [];
  const responses: HttpResponse[] = [];
  const transport: HttpTransport = (req) => {
    if (req.url.includes('CRUDServiceProvider.saveRecord')) {
      saves.push(req.body ?? '');
      return Promise.resolve(responses.shift() ?? saveOk);
    }
    return mock.transport(req);
  };
  const gateway = new RealSankhyaGateway({
    baseUrl: 'https://api.sandbox.sankhya.com.br',
    allowedHosts: ['api.sandbox.sankhya.com.br'],
    environmentKind: 'sandbox',
    credentials: {
      clientId: new Secret(TEST_CREDENTIALS.clientId),
      clientSecret: new Secret(TEST_CREDENTIALS.clientSecret),
      xToken: new Secret(TEST_CREDENTIALS.xToken),
    },
    transport,
    now: () => clock.now,
    customerWrite: OPEN,
  });
  return { gateway, mock, saves, responses };
}

describe('real adapter: updatePartner / readPartnerEditableFields', () => {
  it('sends only TELEFONE/EMAIL/OBSERVACOES keyed by CODPARC, never a forbidden column', async () => {
    const { gateway, saves } = realHarness();
    await gateway.updatePartner({ code: 77, changes: { phone: '11988887777', email: null } });
    expect(saves).toHaveLength(1);
    const sent = JSON.parse(saves[0] ?? '{}') as { requestBody: { dataSet: { dataRow: { key: unknown; localFields: Record<string, unknown> } } } };
    const row = sent.requestBody.dataSet.dataRow;
    expect(row.key).toEqual({ CODPARC: { $: '77' } });
    expect(Object.keys(row.localFields).sort()).toEqual(['EMAIL', 'TELEFONE']);
    expect(row.localFields['EMAIL']).toEqual({ $: '' });
    expect(JSON.stringify(sent)).not.toMatch(/LIMCRED|SENHA|CGC_CPF|NOMEPARC|CODVEND|CODTAB/);
  });

  it('refuses contacts and addresses before any call (no validated mapping)', async () => {
    const { gateway, saves } = realHarness();
    await expect(gateway.updatePartner({ code: 77, changes: { contacts: [] } })).rejects.toMatchObject({ kind: 'validation', code: 'partner_edit_unsupported' });
    await expect(gateway.updatePartner({ code: 77, changes: { addresses: [] } })).rejects.toMatchObject({ kind: 'validation', code: 'partner_edit_unsupported' });
    await expect(gateway.updatePartner({ code: 77, changes: {} })).rejects.toMatchObject({ code: 'partner_edit_empty' });
    expect(saves).toHaveLength(0);
  });

  it('classifies a refusal as permanent and a gateway failure as retryable', async () => {
    const { gateway, responses } = realHarness();
    responses.push({ status: 200, headers: {}, body: JSON.stringify({ status: '0', statusMessage: 'Campo EMAIL invalido' }) });
    await expect(gateway.updatePartner({ code: 77, changes: { email: 'a@example.test' } })).rejects.toMatchObject({ kind: 'permanent' });
    responses.push({ status: 503, headers: {}, body: '' });
    const error = await gateway.updatePartner({ code: 77, changes: { phone: '1' } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SankhyaGatewayError);
    expect((error as SankhyaGatewayError).retryable).toBe(true);
  });

  it('rereads the three editable columns by CODPARC; empty = null; absent partner = null', async () => {
    const { gateway, mock } = realHarness();
    mock.forced.push(ok(['CODPARC', 'TELEFONE', 'EMAIL', 'OBSERVACOES', 'CODTAB'], [[77, '11988887777', null, 'obs', 5]]));
    expect(await gateway.readPartnerEditableFields(77)).toEqual({ phone: '11988887777', email: null, notes: 'obs', priceTableCode: 5 });
    expect(mock.queries()[0]?.sql).toBe('SELECT CODPARC, TELEFONE, EMAIL, OBSERVACOES, CODTAB FROM TGFPAR WHERE CODPARC = 77');
    mock.forced.push(ok(['CODPARC', 'TELEFONE', 'EMAIL', 'OBSERVACOES', 'CODTAB'], []));
    expect(await gateway.readPartnerEditableFields(78)).toBeNull();
    await expect(gateway.readPartnerEditableFields(0)).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('fake gateway: edit of a partner written through the Force', () => {
  const base: PartnerWriteRequest = {
    originField: 'AD_FORCEORIGEM',
    originKey: 'force:0198f0a2-7b1c-7c3e-9a55-0123456789ab',
    document: '11222333000181',
    personType: 'company',
    name: 'TESTE FORCE - NAO USAR',
    tradeName: null,
    icmsClassification: 'R',
    stateRegistration: 'ISENTO',
    sellerCode: 7,
    priceTableCode: 5,
    phone: '11999990000',
    email: 'a@example.test',
    notes: null,
    addresses: [],
  };

  it('replaces present keys, keeps absent ones, clears with null', async () => {
    const partners = new FakePartnerBook();
    const code = partners.seed(base);
    const gateway = new FakeGateway({ partners });
    await gateway.updatePartner({ code, changes: { phone: '11977776666', notes: 'nova' } });
    expect(await gateway.readPartnerEditableFields(code)).toEqual({ phone: '11977776666', email: 'a@example.test', notes: 'nova', priceTableCode: 5 });
    await gateway.updatePartner({ code, changes: { email: null } });
    expect((await gateway.readPartnerEditableFields(code))?.email).toBeNull();
    expect(partners.count('update')).toBe(2);
  });

  it('scripted failure after the write leaves the change applied (lost answer) and contacts are refused like the real adapter', async () => {
    const partners = new FakePartnerBook();
    const code = partners.seed(base);
    const gateway = new FakeGateway({ partners });
    partners.script('update', { kind: 'created_then_error', error: new SankhyaGatewayError('temporary', { code: 'timeout', message: 'timeout' }) });
    await expect(gateway.updatePartner({ code, changes: { phone: '11955554444' } })).rejects.toMatchObject({ kind: 'temporary' });
    expect((await gateway.readPartnerEditableFields(code))?.phone).toBe('11955554444');
    await expect(gateway.updatePartner({ code, changes: { contacts: [] } })).rejects.toMatchObject({ code: 'partner_edit_unsupported' });
    expect(await gateway.readPartnerEditableFields(999)).toBeNull();
  });
});

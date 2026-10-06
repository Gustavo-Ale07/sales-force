export * from './errors.js';
export { Secret } from './secret.js';
export * from './gateway.js';
export {
  MAX_MEDIA_SIGNATURE_PAGE,
  MEDIA_CHUNK_BYTES,
  MEDIA_SAMPLE_BYTES,
  mediaFingerprintOfBytes,
  type ProductMediaSignature,
  type ReadProductMediaBytesOptions,
  type ReadProductMediaSignaturesOptions,
  type SankhyaProductMediaPort,
} from './media.js';
export { selectEffectiveVersions, type ReadScope } from './read-scope.js';
export {
  BootstrapFileConfigurationSource,
  NO_CONFIGURATION_SOURCE_MESSAGE,
  UnavailableConfigurationSource,
  type BootstrapFileConfigurationSourceOptions,
  type ConfigurationSource,
  type ConfigurationValidationResult,
  type ConfigurationValidator,
} from './configuration-source.js';
export { createGateway, type CreateGatewayDependencies, type GatewayEnvironment } from './factory.js';

export { FakeGateway, type FakeGatewayFault, type FakeGatewayMediaOptions, type FakeGatewayOptions } from './fake/fake-gateway.js';
export { syntheticProductImage, type SyntheticImageKind } from './fake/media-fixtures.js';
export { DEMO_ACCOUNTS, DEMO_ACCOUNT_EMAILS, type DemoAccount } from './fake/accounts.js';
export {
  DEMO_CONFIGURATION,
  DEMO_CONFIGURATION_SYNCED_AT,
  DEMO_DERIVED_TABLE_CODE,
  DEMO_FALLBACK_TABLE_CODE,
  DEMO_MAIN_TABLE_CODE,
} from './fake/demo-configuration.js';
export {
  DEMO_EFFECTIVE_VERSION_FROM,
  DEMO_OLDER_VERSION_FROM,
  DEMO_SEED,
  generateDemoDataset,
  getDemoDataset,
  type DemoDataset,
  type DemoSellerManagerLink,
} from './fake/demo-data.js';

export {
  DEFAULT_DB_UTC_OFFSET_MINUTES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_PAGE_SIZE,
  RealSankhyaGateway,
  type RealSankhyaGatewayOptions,
} from './real/real-gateway.js';
export { createFetchTransport, type HttpRequest, type HttpResponse, type HttpTransport } from './real/transport.js';
export type { SankhyaCredentials } from './real/token-provider.js';

import { createPushPort, type PushPort } from "./push/push-registration";
import { createHttpAuth } from "./auth/http-auth";
import type { AuthPort } from "./auth/auth-port";
import { createDeviceConnectivity, type ConnectivityPort, type ConnectivityState } from "./connectivity/connectivity";
import { createMobileApiClient } from "./data/api";
import { createCustomerWritePort, type CustomerWritePort } from "./data/customer-write";
import { createDashboardPort, type DashboardPort } from "./data/dashboard";
import { createOrderTemplatesPort, type OrderTemplatesPort } from "./data/order-templates";
import { createImportsPort, type ImportsPort } from "./data/imports";
import { createExpoImportFile, type ImportFilePort } from "./offline/import-file-expo";
import type { Repositories } from "./data/ports";
import { createRemoteRepositories } from "./data/remote-repositories";
import { createExpoImageFileSystem } from "./images/expo-image-fs";
import { createExpoOrderPdf } from "./offline/order-pdf-expo";
import type { OrderPdfPort } from "./offline/order-pdf";
import { fetch as expoFetch } from "expo/fetch";
import { createOfflineServices, type OfflineServices } from "./offline/services";
import type { StreamFetch } from "./offline/sync-events";
import { createProfilePhotoStore } from "./photo/profile-photo-store";
import { createProfilePhotoApi, createProfilePhotoService, type ProfilePhotoService } from "./photo/profile-photo";
import { detectPhotoPicker } from "./photo/photo-picker";
import type { SqlDatabase } from "@salesforce/mobile-db";
import { withServerCodeStream } from "./server/server-connection";

/** Everything the screens talk to. Each piece is a port, so tests and the future offline adapters plug in here. */
export interface AppDependencies {
  readonly auth: AuthPort;
  readonly repositories: Repositories;
  readonly connectivity: ConnectivityPort;
  /** On-device database services (cache, drafts, outbox, sync). Absent in online-only test setups. */
  readonly offline?: OfflineServices;
  /** "Compartilhar PDF" of an order (share sheet). Absent in test setups: the action is then hidden. */
  readonly orderPdf?: OrderPdfPort;
  /** Profile photo (view, upload, removal). "Trocar foto" is offered only when this build has a picker module. Absent in test setups. */
  readonly profilePhoto?: ProfilePhotoService;
  /** Online edit of a customer (`PATCH /customers/{code}`). Absent in test setups: the edit entry point is then hidden. */
  readonly customerWrite?: CustomerWritePort;
  /** The site's Início counters, online. Absent in test setups: the section is then hidden. */
  readonly dashboard?: DashboardPort;
  /** The site's pedidos recorrentes (templates), online. Absent in test setups: the section is then hidden. */
  readonly orderTemplates?: OrderTemplatesPort;
  /** Push registration (RF-NOT-1). Needs a build that includes expo-notifications; absent or unavailable = no push. */
  readonly push?: PushPort;
  /** Spreadsheet import (items of a quotation, customers in batch), online. Absent in test setups: the entry points are then hidden. */
  readonly imports?: ImportsPort;
  /** The device's file chooser for the import. Absent in test setups. */
  readonly importFile?: ImportFilePort;
}

/** Production composition: online adapters over the API at `baseUrl` (already including the API base path). */
export function createAppDependencies(baseUrl: string, db: SqlDatabase): AppDependencies {
  let offlineServices: OfflineServices | undefined;
  const api = createMobileApiClient(baseUrl);
  const remote = createRemoteRepositories(api);
  const connectivity = createDeviceConnectivity();
  // The sync engine tells "no internet" from "Force server not answering" with the device's own state (kept for the app's life).
  let internet: ConnectivityState = "unknown";
  void connectivity.getState().then((state) => {
    internet = state;
  }).catch(() => undefined);
  connectivity.subscribe((state) => {
    internet = state;
  });
  // Images (thumbnails, own photo) carry the code's key but a 401 there never counts as a rejected code.
  const mediaApi = createMobileApiClient(baseUrl, { quietRejection: true });
  const photoApi = createProfilePhotoApi(api, mediaApi);
  const profilePhoto = createProfilePhotoService({
    api: photoApi,
    store: createProfilePhotoStore({ fs: createExpoImageFileSystem("profile-photo"), fetchPhoto: (signal) => photoApi.fetch(signal) }),
    picker: detectPhotoPicker(),
  });
  return {
    profilePhoto,
    customerWrite: createCustomerWritePort(api),
    dashboard: createDashboardPort(api),
    orderTemplates: createOrderTemplatesPort(api),
    push: createPushPort(api),
    imports: createImportsPort(api),
    importFile: createExpoImportFile(),
    auth: createHttpAuth(api, (config) => {
      // App parameters of the Force configuration: kept for the next offline start.
      void offlineServices?.session.rememberOfflineMaxDays(config.offlineMaxDays).catch(() => undefined);
      if (config.defaultPriceTableCode !== undefined) void offlineServices?.session.rememberDefaultPriceTable?.(config.defaultPriceTableCode).catch(() => undefined);
    }),
    repositories: remote,
    connectivity,
    orderPdf: createExpoOrderPdf(),
    offline: (offlineServices = createOfflineServices({
      db,
      api,
      remote,
      imageFileSystem: createExpoImageFileSystem(),
      mediaApi,
      internetState: () => internet,
      baseUrl,
      // No logger exists in the app yet: the line carries counts and hashes only, never records.
      onMirrorMismatch: (message) => console.warn(message),
      // `expo/fetch` streams the response body (the global fetch of React Native does not).
      // The stream carries the server code's key too (a guard 401 is caught by the ordinary API calls).
      fetchStream: withServerCodeStream((url, init) => expoFetch(url, init as never) as unknown as ReturnType<StreamFetch>) as unknown as StreamFetch,
    })),
  };
}

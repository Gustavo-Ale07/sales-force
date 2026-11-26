import { Platform } from "react-native";
import { callApi, type ApiClient } from "../data/api";

/**
 * Push registration (RF-NOT-1). `expo-notifications` is a native module: a build that does not include it (an APK older than this
 * feature) simply has no push, and the notification central keeps working. The token is sent to the server only; it is never logged.
 */
interface NotificationsModule {
  getPermissionsAsync(): Promise<{ status: string }>;
  requestPermissionsAsync(): Promise<{ status: string }>;
  getExpoPushTokenAsync(options?: { projectId?: string }): Promise<{ data: string }>;
  setNotificationHandler(handler: { handleNotification: () => Promise<Record<string, boolean>> }): void;
  addNotificationResponseReceivedListener(listener: (response: { notification: { request: { content: { data?: Record<string, unknown> } } } }) => void): { remove(): void };
  setNotificationChannelAsync?(id: string, channel: Record<string, unknown>): Promise<unknown>;
}

function loadModule(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as NotificationsModule;
  } catch {
    return null;
  }
}

export interface PushTarget {
  readonly refType: string;
  readonly refId: string;
}

export interface PushPort {
  /** Asks permission (once), gets the device token and registers it for the signed-in account. Returns false when push is not available. */
  register(): Promise<boolean>;
  /** Removes the token of this device from the server (sign-out). Best effort. */
  unregister(): Promise<void>;
  /** A tap on a push opens its target. Returns the unsubscribe function. */
  onOpen(listener: (target: PushTarget) => void): () => void;
}

export function createPushPort(api: ApiClient, projectId?: string): PushPort {
  const notifications = loadModule();
  let lastToken: string | null = null;
  notifications?.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  return {
    async register() {
      if (notifications === null) return false;
      try {
        if (Platform.OS === "android") await notifications.setNotificationChannelAsync?.("default", { name: "Avisos", importance: 4 });
        let status = (await notifications.getPermissionsAsync()).status;
        if (status !== "granted") status = (await notifications.requestPermissionsAsync()).status;
        if (status !== "granted") return false;
        const token = (await notifications.getExpoPushTokenAsync(projectId === undefined ? undefined : { projectId })).data;
        await callApi(() => api.PUT("/push-devices", { body: { token, platform: Platform.OS === "ios" ? "ios" : "android" } }));
        lastToken = token;
        return true;
      } catch {
        return false;
      }
    },
    async unregister() {
      if (lastToken === null) return;
      try {
        await callApi(() => api.POST("/push-devices/remove", { body: { token: lastToken as string } }));
        lastToken = null;
      } catch {
        // Offline sign-out: the server stops using the token when it is registered to another account or reported as unregistered.
      }
    },
    onOpen(listener) {
      if (notifications === null) return () => undefined;
      const subscription = notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data ?? {};
        if (typeof data.refType === "string" && typeof data.refId === "string") listener({ refType: data.refType, refId: data.refId });
      });
      return () => subscription.remove();
    },
  };
}

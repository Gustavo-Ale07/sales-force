import type { PushMessage, PushSender, PushTicket } from './notification-sweep.service.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Expo push service adapter. No secret is involved (the recipient token is the capability); the payload is only
 * the stored title/body and the target ids. Failures of the whole request throw (the sweep retries a few times);
 * per-message results are mapped to a ticket.
 */
export class ExpoPushSender implements PushSender {
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly url: string = EXPO_PUSH_URL) {}

  async send(messages: readonly PushMessage[]): Promise<readonly PushTicket[]> {
    if (messages.length === 0) return [];
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(
        messages.map((message) => ({ to: message.to, title: message.title, body: message.body, data: message.data, sound: 'default', priority: 'high' })),
      ),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`expo_push_http_${response.status}`);
    const json = (await response.json()) as { data?: Array<{ status?: string; details?: { error?: string } }> };
    const data = json.data ?? [];
    return messages.map((_, index): PushTicket => {
      const ticket = data[index];
      if (ticket?.status === 'ok') return 'ok';
      return ticket?.details?.error === 'DeviceNotRegistered' ? 'device_not_registered' : 'failed';
    });
  }
}

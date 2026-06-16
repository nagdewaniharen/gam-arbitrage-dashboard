/**
 * Slack incoming-webhook notifier. Fire-and-forget — caller doesn't await
 * delivery; we just log success/failure.
 */
import { env } from '../config/env.js';
import { retry } from '../lib/retry.js';

export interface SlackAlert {
  title: string;
  text: string;
  fields?: Array<{ label: string; value: string }>;
  level: 'info' | 'warning' | 'critical';
  link?: { text: string; url: string };
}

export async function postSlackAlert(
  alert: SlackAlert,
  log: { info: (m: string, e?: unknown) => void; warn: (m: string, e?: unknown) => void; error: (m: string, e?: unknown) => void },
): Promise<{ delivered: boolean; reason?: string }> {
  if (!env.SLACK_WEBHOOK_URL) {
    log.info('Slack webhook not configured — skipping alert', { title: alert.title });
    return { delivered: false, reason: 'not_configured' };
  }

  const color = alert.level === 'critical' ? '#ef4444' : alert.level === 'warning' ? '#f59e0b' : '#10b981';
  const fieldsBlocks =
    alert.fields?.length ?? 0
      ? [
          {
            type: 'section',
            fields: alert.fields!.map((f) => ({
              type: 'mrkdwn',
              text: `*${f.label}*\n${f.value}`,
            })),
          },
        ]
      : [];
  const payload = {
    attachments: [
      {
        color,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: alert.title } },
          { type: 'section', text: { type: 'mrkdwn', text: alert.text } },
          ...fieldsBlocks,
          ...(alert.link
            ? [
                {
                  type: 'actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: alert.link.text },
                      url: alert.link.url,
                    },
                  ],
                },
              ]
            : []),
        ],
      },
    ],
  };

  try {
    await retry(
      async () => {
        const res = await fetch(env.SLACK_WEBHOOK_URL!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`Slack returned HTTP ${res.status}`);
      },
      { maxAttempts: 3, baseDelayMs: 500 },
    );
    log.info('Slack alert delivered', { title: alert.title });
    return { delivered: true };
  } catch (e) {
    log.warn('Slack alert failed', e);
    return { delivered: false, reason: (e as Error).message };
  }
}

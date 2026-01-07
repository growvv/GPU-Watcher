import dns from 'dns';
import https from 'https';
import type { LookupFunction } from 'net';

import { getRuntimeConfig, updateRuntimeConfig } from '@/config/runtime';

const lookupIPv4: LookupFunction = (hostname, options, callback) => {
  const normalized: dns.LookupOptions = {
    ...(options ?? {}),
    family: 4,
    all: false,
  };
  dns.lookup(hostname, normalized, callback);
};

function getTelegramSettings() {
  const config = getRuntimeConfig();
  return {
    token: config.telegram.botToken,
    chatId: config.telegram.chatId,
    disabled: Boolean(config.telegram.disableNotifications),
  };
}

async function sendMessage({
  token,
  chatId,
  text,
}: {
  token: string;
  chatId: string;
  text: string;
}) {
  const payload = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });

  const url = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
  const options: https.RequestOptions = {
    method: 'POST',
    hostname: url.hostname,
    path: `${url.pathname}${url.search}`,
    port: 443,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    lookup: lookupIPv4,
    timeout: 15000,
  };

  await new Promise<void>((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Array<Buffer> = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(
            new Error(
              `Telegram API error (${res.statusCode}): ${Buffer.concat(
                chunks,
              ).toString('utf-8')}`,
            ),
          );
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Telegram request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

export function isTelegramConfigured() {
  const { token, chatId, disabled } = getTelegramSettings();
  return Boolean(!disabled && token && chatId);
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const { token, chatId, disabled } = getTelegramSettings();
  if (disabled || !token || !chatId) {
    return false;
  }

  try {
    await sendMessage({ token, chatId, text });
    return true;
  } catch (error) {
    console.error('[gpu-watcher] Failed to send telegram message', error);
    return false;
  }
}

export async function sendTelegramTestMessage({
  token,
  chatId,
  text,
  persist,
}: {
  token: string;
  chatId: string;
  text: string;
  persist?: boolean;
}) {
  await sendMessage({ token, chatId, text });
  if (persist) {
    updateRuntimeConfig({
      telegram: {
        botToken: token,
        chatId,
      },
    });
  }
}

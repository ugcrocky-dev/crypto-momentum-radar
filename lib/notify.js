/**
 * Optional outbound notify for FOMO alerts.
 * Telegram, webhook, Web Push, and ntfy when configured. Never places a trade.
 */

import { sanitizeError } from "./freshness.js";
import { sendWebPushFomoAlert, webPushConfigured } from "./webPush.js";

export function notifyConfigured() {
  const telegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const webhook = Boolean(process.env.ALERT_WEBHOOK_URL);
  const webpush = webPushConfigured();
  const ntfy = Boolean(process.env.NTFY_TOPIC);
  return {
    telegram,
    webhook,
    webpush,
    ntfy,
    any: telegram || webhook || webpush || ntfy,
  };
}

export function formatFomoAlertText(alert) {
  const who = (alert.who || []).slice(0, 6).join(", ");
  const clear = alert.risk?.status === "clear" && !alert.risk?.risky;
  return [
    `FOMO ${alert.kind === "fresh" ? "FRESH" : "SIGNAL"}: ${alert.symbol || "?"}`,
    clear ? "GoPlus: clear" : alert.risk?.label || "GoPlus: unscanned",
    `Buyers ${alert.buyers || 0} · score ${alert.avgScore != null ? Math.round(alert.avgScore) : "—"} · ${alert.usd != null ? `$${Math.round(alert.usd)}` : "—"}`,
    who ? `Who: ${who}` : null,
    "Copying OFF — research alert only",
    alert.tokenAddress ? `Mint: ${alert.tokenAddress}` : null,
    "via FOMO Robinhood Radar · crypto-momentum-radar",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, skipped: "telegram_unconfigured" };
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`telegram_http_${res.status}:${body.slice(0, 120)}`);
  }
  return { ok: true, channel: "telegram" };
}

async function sendWebhook(alert, text) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: "webhook_unconfigured" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      type: "fomo_alert",
      text,
      alert,
      copyingEnabled: false,
      autoTrade: false,
    }),
  });
  if (!res.ok) throw new Error(`webhook_http_${res.status}`);
  return { ok: true, channel: "webhook" };
}

async function sendNtfy(alert, text) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return { ok: false, skipped: "ntfy_unconfigured" };
  const base = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const url = `${base}/${topic}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Title: `FOMO CLEAR ${alert.symbol || "alert"}`,
      Priority: "high",
      Tags: "chart_with_upwards_trend,moneybag",
      Click: "https://crypto-momentum-radar.vercel.app/",
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: text,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ntfy_http_${res.status}:${body.slice(0, 120)}`);
  }
  return { ok: true, channel: "ntfy", topic };
}

export async function notifyFomoAlert(alert) {
  const text = formatFomoAlertText(alert);
  const results = [];
  const cfg = notifyConfigured();
  if (!cfg.any) {
    return { sent: false, reason: "no_notify_channel", text };
  }
  if (cfg.telegram) {
    try {
      results.push(await sendTelegram(text));
    } catch (err) {
      results.push({ ok: false, channel: "telegram", error: sanitizeError(err) });
    }
  }
  if (cfg.webhook) {
    try {
      results.push(await sendWebhook(alert, text));
    } catch (err) {
      results.push({ ok: false, channel: "webhook", error: sanitizeError(err) });
    }
  }
  if (cfg.ntfy) {
    try {
      results.push(await sendNtfy(alert, text));
    } catch (err) {
      results.push({ ok: false, channel: "ntfy", error: sanitizeError(err) });
    }
  }
  if (cfg.webpush) {
    try {
      results.push(await sendWebPushFomoAlert(alert));
    } catch (err) {
      results.push({ ok: false, channel: "webpush", error: sanitizeError(err) });
    }
  }
  return {
    sent: results.some((r) => r.ok),
    results,
    text,
  };
}

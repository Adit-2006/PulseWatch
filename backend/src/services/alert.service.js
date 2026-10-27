import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import AlertLog from '../models/AlertLog.js';
import User from '../models/User.js';
import { validateUrlAgainstSSRF } from '../utils/ssrf.js';

/**
 * Compute HMAC SHA-256 signature for a webhook payload.
 *
 * @param {string} payloadString - Stringified JSON payload
 * @param {string} secret - Secret key
 * @returns {string} Hex signature
 */
export function computeHmacSignature(payloadString, secret) {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

/**
 * Deliver an alert with deduplication and exponential backoff retry.
 *
 * 1. Checks and reserves the alert in AlertLog (relying on the unique compound
 *    index { incidentId, type, channel } for database-level deduplication).
 * 2. Executes sendFn with exponential backoff on failure up to maxAttempts.
 * 3. Records every attempt in AlertLog.
 * 4. Marks FAILED after the final attempt without throwing.
 *
 * @param {string} channel - 'email' | 'webhook'
 * @param {Object} monitor - Monitor document
 * @param {Object} incident - Incident document
 * @param {string} alertType - 'OPENED' | 'RESOLVED'
 * @param {Function} sendFn - Async function performing the actual delivery
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3]
 * @param {number} [options.initialBackoffMs]
 * @returns {Promise<Object>}
 */
export async function deliverAlertWithRetry(
  channel,
  monitor,
  incident,
  alertType,
  sendFn,
  options = {}
) {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialBackoffMs = options.initialBackoffMs ?? (process.env.NODE_ENV === 'test' ? 10 : 500);

  // 1. Database-level deduplication:
  // Check if an alert already exists for this (incidentId, type, channel)
  const existingAlert = await AlertLog.findOne({
    incidentId: incident._id,
    type: alertType,
    channel,
  });

  if (existingAlert) {
    return {
      deduplicated: true,
      status: existingAlert.status,
      attempts: existingAlert.attempts,
      alertLog: existingAlert,
    };
  }

  // 2. Atomically reserve the AlertLog document
  // The unique index { incidentId: 1, type: 1, channel: 1 } prevents race conditions
  let alertLog;
  try {
    alertLog = await AlertLog.create({
      incidentId: incident._id,
      type: alertType,
      channel,
      status: 'FAILED', // Initial status; updated to SENT on successful delivery
      errorMessage: 'Delivery in progress',
      attempts: 0,
      attemptHistory: [],
      sentAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) {
      // Race condition caught by unique index: another process already created this alert log
      const duplicateAlert = await AlertLog.findOne({
        incidentId: incident._id,
        type: alertType,
        channel,
      });
      return {
        deduplicated: true,
        status: duplicateAlert?.status,
        attempts: duplicateAlert?.attempts,
        alertLog: duplicateAlert,
      };
    }
    throw err;
  }

  // 3. Execute delivery attempts with exponential backoff
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendFn();

      // Attempt succeeded: mark AlertLog as SENT
      alertLog = await AlertLog.findByIdAndUpdate(
        alertLog._id,
        {
          $set: {
            status: 'SENT',
            errorMessage: null,
            sentAt: new Date(),
            attempts: attempt,
          },
          $push: {
            attemptHistory: {
              attempt,
              status: 'SENT',
              errorMessage: null,
              attemptedAt: new Date(),
            },
          },
        },
        { new: true }
      );

      return {
        success: true,
        attempts: attempt,
        status: 'SENT',
        alertLog,
      };
    } catch (err) {
      lastError = err;

      // Record failed attempt
      alertLog = await AlertLog.findByIdAndUpdate(
        alertLog._id,
        {
          $set: {
            status: 'FAILED',
            errorMessage: err.message,
            attempts: attempt,
          },
          $push: {
            attemptHistory: {
              attempt,
              status: 'FAILED',
              errorMessage: err.message,
              attemptedAt: new Date(),
            },
          },
        },
        { new: true }
      );

      // If attempts remain, wait with exponential backoff
      if (attempt < maxAttempts) {
        const backoffMs = initialBackoffMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // 4. All attempts exhausted: marked FAILED after final attempt
  return {
    success: false,
    attempts: maxAttempts,
    status: 'FAILED',
    error: lastError?.message,
    alertLog,
  };
}

/**
 * Send an email alert for an incident transition.
 *
 * @param {Object} monitor
 * @param {Object} incident
 * @param {string} alertType - 'OPENED' | 'RESOLVED'
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function sendEmailAlert(monitor, incident, alertType, options = {}) {
  if (!monitor.alerts?.email?.enabled) {
    return { skipped: true, reason: 'Email alert channel is disabled' };
  }

  // Determine recipient: custom recipient or monitor owner's email
  let recipient = monitor.alerts.email.recipient;
  if (!recipient || recipient.trim() === '') {
    const user = await User.findById(monitor.userId);
    recipient = user?.email;
  }

  if (!recipient) {
    throw new Error('No recipient email available for monitor');
  }

  const subject =
    alertType === 'OPENED'
      ? `[PulseWatch] CRITICAL: Incident OPENED for ${monitor.name}`
      : `[PulseWatch] RESOLVED: Incident RESOLVED for ${monitor.name}`;

  const textBody =
    alertType === 'OPENED'
      ? `PulseWatch Alert: An incident has OPENED for monitor "${monitor.name}" (${monitor.url}).\n` +
        `Started At: ${incident.startedAt}\n` +
        `Failure Count: ${incident.failureCount}\n` +
        `Error: ${incident.lastErrorMessage || 'Service unavailable'}`
      : `PulseWatch Alert: The incident for monitor "${monitor.name}" (${monitor.url}) has been RESOLVED.\n` +
        `Resolved At: ${incident.resolvedAt}\n` +
        `Duration: ${incident.duration ? Math.round(incident.duration / 1000) + 's' : 'N/A'}\n` +
        `Status: All health checks are now UP.`;

  const htmlBody = `<div style="font-family:sans-serif;padding:20px;">
    <h2 style="color:${alertType === 'OPENED' ? '#ef4444' : '#10b981'};">${subject}</h2>
    <p><strong>Monitor:</strong> ${monitor.name} (${monitor.url})</p>
    <p><strong>Status:</strong> ${incident.status}</p>
    <p><strong>Time:</strong> ${alertType === 'OPENED' ? incident.startedAt : incident.resolvedAt}</p>
    ${alertType === 'OPENED' ? `<p><strong>Error:</strong> ${incident.lastErrorMessage || 'Unknown error'}</p>` : `<p><strong>Duration:</strong> ${incident.duration ? Math.round(incident.duration / 1000) + 's' : 'N/A'}</p>`}
  </div>`;

  const performSend = async () => {
    // 1. Custom mock sender function if provided (testing)
    if (options.sendMailFn) {
      return options.sendMailFn({
        to: recipient,
        subject,
        text: textBody,
        html: htmlBody,
      });
    }

    const provider = env.EMAIL_PROVIDER || 'resend';

    // 2. SMTP Provider via nodemailer
    if (provider === 'smtp') {
      const transport =
        options.mailTransport ||
        nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT || 587,
          secure: env.SMTP_SECURE || false,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        });

      return transport.sendMail({
        from: env.EMAIL_FROM || 'alerts@pulsewatch.dev',
        to: recipient,
        subject,
        text: textBody,
        html: htmlBody,
      });
    }

    // 3. Resend Provider via HTTP API
    const fetchFn = options.fetchFn || globalThis.fetch;
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'alerts@pulsewatch.dev',
        to: [recipient],
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Resend API returned HTTP ${res.status}: ${errorText}`);
    }
  };

  return deliverAlertWithRetry('email', monitor, incident, alertType, performSend, options);
}

/**
 * Send a webhook alert for an incident transition.
 *
 * @param {Object} monitor
 * @param {Object} incident
 * @param {string} alertType - 'OPENED' | 'RESOLVED'
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function sendWebhookAlert(monitor, incident, alertType, options = {}) {
  const webhookConfig = monitor.alerts?.webhook;

  if (!webhookConfig?.enabled || !webhookConfig?.url) {
    return { skipped: true, reason: 'Webhook alert channel is disabled or URL is missing' };
  }

  const webhookUrl = webhookConfig.url;

  const payload = {
    event: alertType === 'OPENED' ? 'incident.opened' : 'incident.resolved',
    type: alertType,
    monitor: {
      id: monitor._id.toString(),
      name: monitor.name,
      url: monitor.url,
    },
    incident: {
      id: incident._id.toString(),
      status: incident.status,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      duration: incident.duration,
      failureCount: incident.failureCount,
      lastErrorMessage: incident.lastErrorMessage,
    },
    timestamp: new Date().toISOString(),
  };

  const payloadString = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'PulseWatch-Alert-Webhook/1.0',
    'X-PulseWatch-Event': payload.event,
  };

  // Sign payload with HMAC secret if configured
  if (webhookConfig.hmacSecret && webhookConfig.hmacSecret.trim() !== '') {
    const signature = computeHmacSignature(payloadString, webhookConfig.hmacSecret);
    headers['X-PulseWatch-Signature'] = `sha256=${signature}`;
  }

  const performSend = async () => {
    // SSRF Protection: ensure target URL is not a private/loopback/cloud metadata address
    await validateUrlAgainstSSRF(webhookUrl);

    if (options.sendWebhookFn) {
      return options.sendWebhookFn({
        url: webhookUrl,
        headers,
        payload,
      });
    }

    const fetchFn = options.fetchFn || globalThis.fetch;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || env.WEBHOOK_TIMEOUT_MS || 5000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchFn(webhookUrl, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Webhook endpoint returned HTTP ${res.status}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  };

  return deliverAlertWithRetry('webhook', monitor, incident, alertType, performSend, options);
}

/**
 * Dispatch alerts for an incident state transition asynchronously.
 * Runs non-blocking: never crashes or blocks caller loops.
 *
 * @param {Object} monitor
 * @param {Object} incident
 * @param {string} alertType - 'OPENED' | 'RESOLVED'
 * @param {Object} [options]
 * @returns {Promise<Array<Object>>}
 */
export async function dispatchAlerts(monitor, incident, alertType, options = {}) {
  const tasks = [];

  if (monitor.alerts?.email?.enabled) {
    tasks.push(
      sendEmailAlert(monitor, incident, alertType, options).catch((err) => {
        console.error(`⚠️ Email alert dispatch failed for monitor ${monitor._id}:`, err.message);
        return { error: err.message, channel: 'email' };
      })
    );
  }

  if (monitor.alerts?.webhook?.enabled && monitor.alerts?.webhook?.url) {
    tasks.push(
      sendWebhookAlert(monitor, incident, alertType, options).catch((err) => {
        console.error(`⚠️ Webhook alert dispatch failed for monitor ${monitor._id}:`, err.message);
        return { error: err.message, channel: 'webhook' };
      })
    );
  }

  if (tasks.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(tasks);
  return results.map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason?.message }));
}

export default {
  dispatchAlerts,
  sendEmailAlert,
  sendWebhookAlert,
  deliverAlertWithRetry,
  computeHmacSignature,
};

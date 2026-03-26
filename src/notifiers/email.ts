/**
 * Send email notifications via Nodemailer (SMTP).
 */

import nodemailer from "nodemailer";
import type { PendingNotification } from "../types.js";
import { emailHtml, emailSubject, plainText } from "../formatter.js";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ?? "587";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_TO = process.env.EMAIL_TO;
const EMAIL_FROM = process.env.EMAIL_FROM ?? process.env.SMTP_USER;
const SMTP_CONNECTION_TIMEOUT_MS = parseNumberEnv("SMTP_CONNECTION_TIMEOUT_MS", 20000, 1000, 120000);
const SMTP_SOCKET_TIMEOUT_MS = parseNumberEnv("SMTP_SOCKET_TIMEOUT_MS", 20000, 1000, 120000);
const SMTP_RETRY_COUNT = parseNumberEnv("SMTP_RETRY_COUNT", 3, 1, 10);
const SMTP_RETRY_BASE_DELAY_MS = parseNumberEnv("SMTP_RETRY_BASE_DELAY_MS", 500, 0, 10000);

function parseNumberEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const maybe = err as { code?: unknown };
  return typeof maybe.code === "string" ? maybe.code : undefined;
}

function isTransientSmtpError(err: unknown): boolean {
  const code = getErrorCode(err);
  if (!code) return false;
  // Common transient network errors we want to retry.
  return [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ETEMPFAIL",
    "EPIPE",
  ].includes(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isEmailConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && EMAIL_TO);
}

function getTransporter(): nodemailer.Transporter {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS must be set");
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: SMTP_PORT === "465",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    // Prevent long hangs and allow retries to kick in for transient failures.
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });
}

export async function sendEmailNotification(n: PendingNotification): Promise<void> {
  if (!EMAIL_TO) {
    throw new Error("EMAIL_TO is not set");
  }

  const transporter = getTransporter();

  let lastErr: unknown;
  for (let attempt = 0; attempt < SMTP_RETRY_COUNT; attempt++) {
    try {
      await transporter.sendMail({
        from: EMAIL_FROM ?? SMTP_USER,
        to: EMAIL_TO,
        subject: emailSubject(n),
        text: plainText(n),
        html: emailHtml(n),
      });
      return;
    } catch (err) {
      lastErr = err;
      const transient = isTransientSmtpError(err);
      const isLastAttempt = attempt >= SMTP_RETRY_COUNT - 1;
      if (!transient || isLastAttempt) break;

      const backoff = SMTP_RETRY_BASE_DELAY_MS * 2 ** attempt;
      // Small jitter to avoid thundering herd if multiple notifications fire together.
      const jitter = Math.floor(Math.random() * 250);
      await sleep(backoff + jitter);
    }
  }

  throw lastErr ?? new Error("Failed to send email notification");
}

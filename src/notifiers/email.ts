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
  });
}

export async function sendEmailNotification(n: PendingNotification): Promise<void> {
  if (!EMAIL_TO) {
    throw new Error("EMAIL_TO is not set");
  }

  const transporter = getTransporter();

  await transporter.sendMail({
    from: EMAIL_FROM ?? SMTP_USER,
    to: EMAIL_TO,
    subject: emailSubject(n),
    text: plainText(n),
    html: emailHtml(n),
  });
}

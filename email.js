export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseSender(from) {
  if (!from) return { name: 'EcoSmart', email: '' };
  const trimmed = from.trim();
  const match = trimmed.match(/^(?:(.*?)<)?([^>]+)>?$/);
  if (match && match[2]) {
    const name = match[1]?.trim() || 'EcoSmart';
    const email = match[2]?.trim();
    return { name, email };
  }
  return { name: 'EcoSmart', email: trimmed };
}

export function createEmailProvider(env = process.env, transport = fetch) {
  const apiKey = (env.BREVO_API_KEY || env.BREVA_API_KEY || '').trim();
  const sender = parseSender(env.EMAIL_FROM);
  const configured = Boolean(apiKey && sender.email);

  return {
    configured,
    async send(email, code, requestId) {
      if (!configured) throw new AppError(503, 'Email verification is not configured yet. Please try again later.');
      let response;
      try {
        response = await transport('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'accept': 'application/json',
            'X-Request-Id': requestId
          },
          body: JSON.stringify({
            sender: { name: sender.name, email: sender.email },
            to: [{ email }],
            subject: 'Your EcoSmart verification code',
            textContent: `Your EcoSmart verification code is ${code}.\n\nIt expires in 10 minutes and can be used once. If you request another code, use the newest email.\n\nIf you did not request this code, you can ignore this email.`
          })
        });
      } catch {
        throw new AppError(503, 'The email service could not be reached. Please try again shortly.');
      }
      const data = await response.json().catch(() => ({}));
      if (response.status === 429) throw new AppError(429, 'The email service is busy. Please wait before trying again.');
      const messageId = typeof data.messageId === 'string' && data.messageId ? data.messageId : (Array.isArray(data.messageIds) && data.messageIds[0] ? data.messageIds[0] : null);
      if (!response.ok || !messageId) throw new AppError(503, 'We could not send your verification email. Please try again later.');
      return messageId;
    },
    async sendNotification(email, subject, textContent) {
      if (!configured) return null;
      try {
        const response = await transport('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'accept': 'application/json'
          },
          body: JSON.stringify({
            sender: { name: sender.name, email: sender.email },
            to: [{ email }],
            subject,
            textContent
          })
        });
        return response.ok;
      } catch (err) {
        console.error('Failed to send email notification:', err);
        return false;
      }
    }
  };
}


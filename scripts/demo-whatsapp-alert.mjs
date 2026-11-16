import { parseArgs } from 'node:util';

const usage =
  'Usage: pnpm exec node --env-file=.env scripts/demo-whatsapp-alert.mjs [<sender-phone-number-id> <+recipient>] [--template <name> | --alert]';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      alert: { type: 'boolean' },
      help: { type: 'boolean' },
      template: { type: 'string' },
    },
  });
  if (values.help) {
    console.log(usage);
    console.log('With no positional arguments, use the sender, recipient and template saved in .env.');
    console.log('Set META_WHATSAPP_ACCESS_TOKEN to a temporary token from Meta API Setup.');
    console.log('Reply from WhatsApp, then use --alert within 24 hours.');
    return;
  }

  const useSavedDemo = positionals.length === 0;
  const [phoneNumberId, recipient] = useSavedDemo
    ? [process.env.META_WHATSAPP_DEMO_PHONE_NUMBER_ID, process.env.META_WHATSAPP_DEMO_RECIPIENT]
    : positionals;
  const savedTemplate = useSavedDemo ? process.env.META_WHATSAPP_DEMO_TEMPLATE : undefined;
  const template = values.template ?? savedTemplate ?? 'hello_world';
  if (
    (!useSavedDemo && positionals.length !== 2) ||
    !/^\d+$/.test(phoneNumberId) ||
    !/^\+[1-9]\d{6,14}$/.test(recipient) ||
    (values.alert && values.template !== undefined) ||
    (!values.alert && !/^[a-z0-9_]+$/.test(template))
  ) {
    throw new Error(usage);
  }

  const token = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error('Set META_WHATSAPP_ACCESS_TOKEN to the temporary token from Meta API Setup.');
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient.slice(1),
  };
  if (values.alert) {
    payload.type = 'interactive';
    payload.interactive = {
      type: 'button',
      body: { text: 'VHH Fleet test alert\nTruck DEMO-01 reported an overheating engine.' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'demo-01:acknowledge', title: 'Acknowledge' } },
          { type: 'reply', reply: { id: 'demo-01:complete', title: 'Repair completed' } },
        ],
      },
    };
  } else {
    payload.type = 'template';
    payload.template = { name: template, language: { code: 'en_US' } };
  }

  let response;
  let result;
  try {
    response = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    result = await response.json();
  } catch {
    throw new Error('Could not confirm the send request. Check WhatsApp before trying again.');
  }

  if (!response.ok) {
    const code = result?.error?.code;
    const tips = {
      190: 'Generate a fresh temporary token in Meta API Setup.',
      131030: 'Add and verify the recipient in Meta API Setup.',
      131042: 'Check the payment method for the WhatsApp account in Meta Business Suite.',
      131047: 'Reply from the recipient’s WhatsApp before using --alert.',
      132001: 'Check that the selected template is approved in English (US) on this WhatsApp account.',
    };
    const errorCode = Number.isInteger(code) ? `, error ${code}` : '';
    const tip = tips[code] ?? 'Check the sender, recipient and token in Meta API Setup.';
    throw new Error(`Meta rejected the request (HTTP ${response.status}${errorCode}). ${tip}`);
  }

  const messageId = result?.messages?.[0]?.id;
  if (typeof messageId !== 'string' || !messageId.startsWith('wamid.')) {
    throw new Error('Meta returned no message ID. Check WhatsApp before trying again.');
  }
  console.log(`Meta accepted ${messageId}. Check the recipient’s WhatsApp for delivery.`);
  if (!values.alert) {
    console.log('Reply in WhatsApp, then run the command again with --alert in place of any --template option.');
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

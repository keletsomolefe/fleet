# VHH Fleet WhatsApp demo

The demo uses the existing **VHH Fleet** Meta app and the connected sender on the **vhh fleet** WhatsApp account. Open [WhatsApp API Setup](https://developers.facebook.com/apps/1686137176275958/use_cases/customize/wa-dev-console/?business_id=1626738568937718&use_case_enum=WHATSAPP_BUSINESS_MESSAGING) to check the sender and refresh the temporary token.

Keep these values in the root `.env`:

| Variable | Value |
| --- | --- |
| `META_WHATSAPP_ACCESS_TOKEN` | Temporary access token for the **vhh fleet** WhatsApp account. Replace it when it expires. |
| `META_WHATSAPP_DEMO_PHONE_NUMBER_ID` | Phone number ID of the connected sender ending in **5749**. |
| `META_WHATSAPP_DEMO_RECIPIENT` | Recipient's WhatsApp number including `+` and the country code. |
| `META_WHATSAPP_DEMO_TEMPLATE` | `vhh_api_test`, the approved English (US) greeting. |

From the Fleet root, send the greeting:

```sh
pnpm exec node --env-file=.env scripts/demo-whatsapp-alert.mjs
```

Reply **Hi** from the recipient's WhatsApp, then send the demo alert within 24 hours:

```sh
pnpm exec node --env-file=.env scripts/demo-whatsapp-alert.mjs --alert
```

Check WhatsApp for the demo message and buttons. The script submits messages and reports Meta's acceptance. The WhatsApp chat confirms delivery. This demo is separate from the production Service jobs integration; see [whatsapp-service-jobs.md](whatsapp-service-jobs.md) for the approved job template, webhook and provider links.

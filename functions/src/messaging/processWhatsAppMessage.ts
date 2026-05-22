import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

/**
 * Processes a queued outbound WhatsApp message by calling Meta's WhatsApp
 * Cloud API. Triggered by `enqueueWhatsApp` writes to /whatsapp/{id}.
 *
 * Requires two environment variables on the function:
 *  - WHATSAPP_TOKEN      — system user access token from Meta
 *  - WHATSAPP_PHONE_ID   — the phone number ID from your WABA
 *
 * Optional (recommended for cold-start notifications outside the 24-hour
 * customer-service window — which is most of ours):
 *  - WHATSAPP_TEMPLATE_NAME — pre-approved template name (e.g.
 *    "blue_seal_notification") with a single body parameter "{{1}}"
 *    that we fill with the queued body. If unset, we send a free-form
 *    text message which Meta will reject outside the 24h window.
 *  - WHATSAPP_TEMPLATE_LANG — BCP-47 language tag the template was
 *    submitted in (default "en_US").
 *
 * If `WHATSAPP_TOKEN` or `WHATSAPP_PHONE_ID` isn't set, the function
 * exits without touching the doc — the queue accumulates harmlessly and
 * flushes retroactively once you complete the HUMANTASKS.md steps.
 */
export const processWhatsAppMessage = onDocumentCreated(
  "whatsapp/{messageId}",
  async (event) => {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    if (!token || !phoneId) {
      logger.warn("processWhatsAppMessage: WHATSAPP_TOKEN or WHATSAPP_PHONE_ID unset; skipping");
      return;
    }

    const data = event.data?.data() as { to?: string; body?: string } | undefined;
    if (!data?.to || !data.body) {
      logger.warn("processWhatsAppMessage: doc missing to/body", { id: event.params.messageId });
      return;
    }

    // Meta's API wants the phone WITHOUT the leading "+" for the `to`
    // field. The enqueue helper validates E.164 (which requires the "+"),
    // so we strip it here.
    const to = data.to.replace(/^\+/, "");

    const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
    const templateLang = process.env.WHATSAPP_TEMPLATE_LANG ?? "en_US";

    const payload = templateName
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLang },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: data.body }],
              },
            ],
          },
        }
      : {
          // No template configured — try free-form text. Meta will reject
          // this for any recipient outside the 24-hour customer-service
          // window. We log the error and move on; the user-visible failure
          // is "no WhatsApp delivered" — they still got the in-app notif.
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: data.body },
        };

    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        logger.error("processWhatsAppMessage: Meta API rejected", {
          id: event.params.messageId,
          status: res.status,
          response: json,
        });
        await event.data?.ref.update({
          status: "failed",
          error: JSON.stringify(json).slice(0, 2000),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return;
      }
      const messages = (json.messages as Array<{ id?: string }> | undefined) ?? [];
      await event.data?.ref.update({
        status: "sent",
        providerId: messages[0]?.id ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.error("processWhatsAppMessage: fetch failed", {
        id: event.params.messageId,
        err,
      });
      await event.data?.ref.update({
        status: "failed",
        error: String(err).slice(0, 2000),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  },
);

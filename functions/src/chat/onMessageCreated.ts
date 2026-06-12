import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

// At most one out-of-app alert (email + push) per recipient per chat per this
// window. The in-app bell still fires on every message; this only debounces the
// noisy channels so a 10-message burst sends one email, not ten.
const AWAY_ALERT_WINDOW_MS = 15 * 60 * 1000;

interface MessageLike {
  senderId: string;
  text?: string;
  photoUrl?: string | null;
  type?: string;
  carriedOver?: boolean;
}

interface ChatLike {
  clientId: string;
  tradespersonId: string;
  jobId: string;
  awayAlertAt?: Record<string, Timestamp>;
}

/**
 * On new chat message: bump lastMessage metadata + increment unreadCount
 * for the *other* party only, and drop a notification in their inbox.
 */
export const onMessageCreated = onDocumentCreated(
  "chats/{chatId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data() as MessageLike | undefined;
    if (!msg?.senderId) return;
    // System messages (auto-posted by status/schedule/clock triggers) bump
    // lastMessage metadata in the writer itself; we don't want to notify on
    // them — both parties are already looking at the event that caused
    // them, and pinging the bell on every schedule edit is too noisy.
    if (msg.type === "system" || msg.senderId === "system") return;
    // History copied in from a pre-acceptance application thread — both
    // parties already read it there; no unread bump, no re-notification.
    if (msg.carriedOver) return;
    const chatId = event.params.chatId;
    const chatRef = db.doc(`chats/${chatId}`);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) return;
    const chat = chatSnap.data() as ChatLike;
    const recipient = chat.clientId === msg.senderId ? chat.tradespersonId : chat.clientId;
    const preview = msg.photoUrl ? "📷 Photo" : (msg.text ?? "").slice(0, 120);

    // Smart/debounced away-alert: the in-app bell fires on every message
    // (priority "low" below = inbox only), but the recipient's only out-of-app
    // signal — email + push — is rate-limited to once per AWAY_ALERT_WINDOW_MS
    // per chat. Without native push (no app store yet), email is the primary
    // way an away client/tradesperson learns a new message arrived, so we can't
    // stay in-app-only — but we also don't want a chatty thread to fan out a
    // dozen emails. One alert per ~15 min strikes that balance.
    const lastAlertMs = chat.awayAlertAt?.[recipient]?.toMillis?.() ?? 0;
    const sendAwayAlert = Date.now() - lastAlertMs > AWAY_ALERT_WINDOW_MS;

    await chatRef.update({
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview,
      [`unreadCounts.${recipient}`]: FieldValue.increment(1),
      ...(sendAwayAlert ? { [`awayAlertAt.${recipient}`]: FieldValue.serverTimestamp() } : {}),
    });
    // Pull the sender's display name for a more human notification.
    const senderSnap = await db.doc(`users/${msg.senderId}`).get();
    const senderName = (senderSnap.data() as { displayName?: string } | undefined)?.displayName
      ?? "Someone";
    await notify({
      userId: recipient,
      type: "message_received",
      // "{Name} sent you a message" so the email heading splits cleanly into a
      // name line + action ("Sarah Chen / Sent you a message"), and the subject
      // line leads with who it's from.
      title: `${senderName} sent you a message`,
      body: preview,
      link: `/jobs/${chat.jobId}`,
      jobId: chat.jobId,
      chatId,
      actorUid: msg.senderId,
      // Sender is on the chat (clientId or tradespersonId), so the
      // recipient role is the opposite seat at the table.
      recipientRole: recipient === chat.clientId ? "client" : "tradesperson",
      // "normal" adds push + email (the away alert); "low" is in-app bell only.
      // The window above keeps the noisy channels to ~one per 15 min per chat.
      priority: sendAwayAlert ? "normal" : "low",
    });
  },
);

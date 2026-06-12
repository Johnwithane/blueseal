import { defineStore } from "pinia";
import {
  deleteAssistantConversation,
  findAssistantConversation,
  sendAssistantMessage,
  subscribeAssistantConversations,
  subscribeAssistantMessages,
  type AiChatInput,
} from "@/firebase/services/assistant";
import type {
  AssistantConversationDoc,
  AssistantMessageDoc,
  AssistantScope,
  WithId,
} from "@/firebase/interfaces";
import { usePaywallStore } from "@/stores/paywall";

interface State {
  // Panel chrome
  isOpen: boolean;
  // What the panel is asking about right now. Updated by the bubble watcher
  // whenever the route changes, used by `send` to scope the call.
  scope: AssistantScope;
  jobId: string | null;
  pageRoute: string | null;
  // The conversation the panel is showing. Resolved lazily — we don't pre-
  // load conversations until the user opens the panel for the first time.
  currentConversationId: string | null;
  messages: WithId<AssistantMessageDoc>[];
  conversations: WithId<AssistantConversationDoc>[];
  // Per-turn UX state. `sending` covers the round-trip to aiChat; `error`
  // stores the most recent failure for inline display.
  sending: boolean;
  error: string | null;
  // Pending textarea draft pushed by quick-prompt chips. The composer
  // watches `draftTick` (a monotonically increasing counter) so the same
  // chip clicked twice still re-fills the textarea — without the tick the
  // composer wouldn't notice an identical `draft` value the second time.
  draft: string;
  draftTick: number;
  // Local-only echo of the message the user just sent, shown immediately
  // so the panel doesn't sit silent for the ~2s it takes Vertex to reply.
  // The Firestore listener delivers the canonical persisted version once
  // the batch commits; the thread component dedupes on content.
  optimisticUserMessage: { content: string; createdAt: number } | null;
}

// Subscription handles. Kept module-scoped (not in state) so they aren't
// serialized by Pinia devtools.
let unsubMessages: (() => void) | null = null;
let unsubConversations: (() => void) | null = null;

function clearMessageSub() {
  unsubMessages?.();
  unsubMessages = null;
}

function clearConversationsSub() {
  unsubConversations?.();
  unsubConversations = null;
}

export const useAssistantStore = defineStore("assistant", {
  state: (): State => ({
    isOpen: false,
    scope: "general",
    jobId: null,
    pageRoute: null,
    currentConversationId: null,
    messages: [],
    conversations: [],
    sending: false,
    error: null,
    draft: "",
    draftTick: 0,
    optimisticUserMessage: null,
  }),

  getters: {
    /** Single label for the active thread — used in the panel header. */
    threadTitle: (s): string => {
      if (s.scope === "job") {
        const convo = s.conversations.find((c) => c.id === s.currentConversationId);
        return convo?.title ?? "This job";
      }
      if (s.scope === "admin") return "Admin assistant";
      return "General";
    },
  },

  actions: {
    open() {
      this.isOpen = true;
    },
    close() {
      this.isOpen = false;
    },
    toggle() {
      this.isOpen = !this.isOpen;
    },

    /**
     * Called by the bubble whenever the route or role changes. Derives the
     * scope from (activeRole, route) and switches the visible thread.
     */
    async setContext(opts: {
      userId: string | null;
      scope: AssistantScope;
      jobId: string | null;
      pageRoute: string | null;
    }) {
      const scopeChanged = opts.scope !== this.scope || opts.jobId !== this.jobId;
      this.scope = opts.scope;
      this.jobId = opts.jobId;
      this.pageRoute = opts.pageRoute;

      if (!scopeChanged) return;
      // Different thread now — any optimistic message in flight belongs to
      // the prior context and shouldn't bleed in.
      this.optimisticUserMessage = null;
      if (!opts.userId) {
        this.currentConversationId = null;
        this.messages = [];
        clearMessageSub();
        return;
      }
      // Look up an existing thread for this scope. If none yet, leave
      // currentConversationId null — it gets created server-side on the
      // first `send`. This keeps "open panel and see nothing" cheap.
      try {
        const existing = await findAssistantConversation({
          userId: opts.userId,
          scope: opts.scope,
          jobId: opts.jobId,
        });
        if (existing) {
          this.attachToConversation(existing.id);
        } else {
          this.currentConversationId = null;
          this.messages = [];
          clearMessageSub();
        }
      } catch (e) {
        // Soft-fail — the panel will just show empty + the user can still send.
        this.error = (e as Error).message;
        this.currentConversationId = null;
        this.messages = [];
      }
    },

    /** Subscribe to a specific conversation's messages. */
    attachToConversation(conversationId: string) {
      if (this.currentConversationId === conversationId && unsubMessages) return;
      this.currentConversationId = conversationId;
      this.messages = [];
      clearMessageSub();
      unsubMessages = subscribeAssistantMessages(conversationId, (msgs) => {
        this.messages = msgs;
      });
    },

    /** Subscribe to the user's full conversation list — used by the picker. */
    attachConversationList(userId: string) {
      clearConversationsSub();
      unsubConversations = subscribeAssistantConversations(userId, (list) => {
        this.conversations = list;
      });
    },

    /**
     * Send a message in the current context.
     *
     * Pass `{ hidden: true }` to mark this as a one-click quick-prompt
     * action — the user-side bubble is suppressed in the thread, only the
     * AI's reply is shown. The user turn still persists server-side so the
     * model retains context for follow-up messages.
     */
    async send(message: string, opts: { hidden?: boolean } = {}) {
      if (this.sending) return;
      const trimmed = message.trim();
      if (!trimmed) return;
      // Optimistic echo — only for visible sends. Hidden quick-prompts use
      // the thinking-dots placeholder instead so the panel doesn't briefly
      // flash a bubble that's about to vanish.
      if (!opts.hidden) {
        this.optimisticUserMessage = { content: trimmed, createdAt: Date.now() };
      }
      this.sending = true;
      this.error = null;
      try {
        const input: AiChatInput = {
          conversationId: this.currentConversationId ?? undefined,
          scope: this.scope,
          jobId: this.jobId,
          pageRoute: this.pageRoute,
          message: trimmed,
          hidden: opts.hidden,
        };
        const res = await sendAssistantMessage(input);
        if (res.conversationId !== this.currentConversationId) {
          this.attachToConversation(res.conversationId);
        }
      } catch (e) {
        // Pro paywall (e.g. a trial/comp lapsed mid-session — the panel
        // normally gates non-Pro out of the composer): show the upgrade popup
        // instead of leaking the raw token into the thread, and don't rethrow
        // so call sites don't also toast.
        if (usePaywallStore().fromError(e)) {
          this.error = null;
          this.optimisticUserMessage = null;
          return;
        }
        this.error = (e as Error).message;
        this.optimisticUserMessage = null;
        throw e;
      } finally {
        this.sending = false;
        this.optimisticUserMessage = null;
      }
    },

    /**
     * Push a prompt into the composer textarea. Used by the quick-prompt
     * chips so the user can review / tweak before sending. Always opens
     * the panel so the action has a visible effect from anywhere.
     */
    applyQuickPrompt(text: string) {
      this.draft = text;
      this.draftTick += 1;
      this.isOpen = true;
    },

    async deleteCurrentConversation() {
      const id = this.currentConversationId;
      if (!id) return;
      clearMessageSub();
      this.currentConversationId = null;
      this.messages = [];
      await deleteAssistantConversation(id);
    },

    /** Tear everything down on sign-out. */
    reset() {
      clearMessageSub();
      clearConversationsSub();
      this.isOpen = false;
      this.scope = "general";
      this.jobId = null;
      this.pageRoute = null;
      this.currentConversationId = null;
      this.messages = [];
      this.conversations = [];
      this.sending = false;
      this.error = null;
      this.draft = "";
      this.draftTick = 0;
      this.optimisticUserMessage = null;
    },
  },
});

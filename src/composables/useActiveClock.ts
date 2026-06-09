import { computed, effectScope, onScopeDispose, ref, watch, type EffectScope } from "vue";
import {
  collectionGroup,
  onSnapshot,
  query,
  where,
  type FirestoreError,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuthStore } from "@/stores/auth";
import type { TimeEntryDoc, WithId } from "@/firebase/interfaces";

// The tradie's single open clock session across ALL their jobs. clockIn enforces
// one running session at a time (auto-stopping any other job), so this is a
// single-doc view. Drives the quick clock button on job-list cards and the
// job-detail header, and reflects auto-stop live.
//
// Shared singleton: one collectionGroup listener for the whole app, ref-counted
// so it tears down when no component is using it. The listener needs the
// COLLECTION_GROUP index on timeEntries (tradespersonId, endedAt).

type ActiveEntry = WithId<TimeEntryDoc> & { jobId: string };

const activeEntry = ref<ActiveEntry | null>(null);
const nowMs = ref(Date.now());
let refCount = 0;
let unsubscribe: (() => void) | null = null;
let ticker: number | null = null;
let watchedUid: string | null = null;
let authScope: EffectScope | null = null;

function start(uid: string) {
  stop();
  watchedUid = uid;
  const q = query(
    collectionGroup(db, "timeEntries"),
    where("tradespersonId", "==", uid),
    where("endedAt", "==", null),
  );
  unsubscribe = onSnapshot(
    q,
    (snap) => {
      // At most one open session is expected; if several slipped through, the
      // most recently started wins for display purposes.
      let best: ActiveEntry | null = null;
      for (const d of snap.docs) {
        const jobId = d.ref.parent.parent?.id;
        if (!jobId) continue;
        const entry: ActiveEntry = { id: d.id, jobId, ...(d.data() as TimeEntryDoc) };
        if (!best || (entry.startedAt?.toMillis?.() ?? 0) > (best.startedAt?.toMillis?.() ?? 0)) {
          best = entry;
        }
      }
      activeEntry.value = best;
    },
    (err: FirestoreError) => {
      console.warn("[useActiveClock] listener:", err.code, err.message);
      activeEntry.value = null;
    },
  );
}

function stop() {
  unsubscribe?.();
  unsubscribe = null;
  watchedUid = null;
  activeEntry.value = null;
}

// Detached singleton watcher that (re)attaches the listener to whoever is
// signed in. Lives in its own effect scope — not the calling component's — so
// it survives a consumer unmounting while another is still using the singleton.
// This is what lets a persistently-mounted consumer (the global clock banner,
// which mounts once at App boot, BEFORE auth resolves) start tracking the
// moment a tradesperson signs in, rather than only catching a uid that already
// happened to be present at setup time.
function ensureAuthWatcher() {
  if (authScope) return;
  authScope = effectScope(true);
  authScope.run(() => {
    const auth = useAuthStore();
    watch(
      () => [auth.fbUser?.uid ?? null, auth.roles.includes("tradesperson")] as const,
      ([uid, isTradie]) => {
        if (uid && isTradie) {
          if (watchedUid !== uid) start(uid);
        } else {
          stop();
        }
      },
      { immediate: true },
    );
  });
}

export function useActiveClock() {
  refCount += 1;
  ensureAuthWatcher();
  if (ticker === null) {
    ticker = window.setInterval(() => (nowMs.value = Date.now()), 1000);
  }

  onScopeDispose(() => {
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      stop();
      authScope?.stop();
      authScope = null;
      if (ticker !== null) {
        window.clearInterval(ticker);
        ticker = null;
      }
    }
  });

  const runningJobId = computed(() => activeEntry.value?.jobId ?? null);
  const elapsedMs = computed(() => {
    const e = activeEntry.value;
    if (!e) return 0;
    return Math.max(0, nowMs.value - (e.startedAt?.toMillis?.() ?? nowMs.value));
  });

  return {
    activeEntry: computed(() => activeEntry.value),
    runningJobId,
    elapsedMs,
    isRunningOn: (jobId: string) => runningJobId.value === jobId,
  };
}

import { computed, onScopeDispose, ref } from "vue";
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

export function useActiveClock() {
  const auth = useAuthStore();

  refCount += 1;
  // (Re)attach when a tradie is signed in. The composable is only mounted in
  // tradie-facing views, so a quick uid check is enough — no need to watch.
  const uid = auth.fbUser?.uid ?? null;
  if (uid && auth.roles.includes("tradesperson") && watchedUid !== uid) {
    start(uid);
  }
  if (ticker === null) {
    ticker = window.setInterval(() => (nowMs.value = Date.now()), 1000);
  }

  onScopeDispose(() => {
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      stop();
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

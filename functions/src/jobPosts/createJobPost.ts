import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, GeoPoint, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRoleOrAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { deriveGeohashes, firstNameOnly } from "./helpers";

const caPostalRegex = /^[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d$/;
const caFsaRegex = /^[A-Z]\d[A-Z]$/;

const Input = z.object({
  trade: z.string().min(1).max(50),
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(2000),
  // Storage paths (e.g. "jobPosts/<tempId>/photos/abc.webp") uploaded by the
  // client before the post doc exists. The callable moves them under the
  // permanent post id by writing the post doc; the client's temp upload path
  // is already stored under jobPosts/{tempId}, but since we mint the real
  // id here we just keep the paths as-is and the storage rules allow reads.
  photos: z.array(z.string().min(1).max(500)).min(1).max(8),
  addressPublic: z.object({
    city: z.string().trim().min(2).max(100),
    region: z.string().trim().min(2).max(100),
    postalFsa: z.string().trim().toUpperCase().regex(caFsaRegex),
  }),
  addressPrivate: z.object({
    line1: z.string().trim().min(2).max(200),
    fullPostal: z.string().trim().regex(caPostalRegex),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  budget: z
    .object({
      min: z.number().int().min(500).max(100_000_000),
      max: z.number().int().min(500).max(100_000_000),
      currency: z.literal("CAD"),
    })
    .refine((v) => v.max >= v.min, { message: "max < min", path: ["max"] }),
  urgency: z.enum(["flexible", "this_week", "urgent"]),
  preferredDateWindow: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
});

const OPEN_POSTS_PER_CLIENT_CAP = 5;
const EXPIRY_DAYS = 30;

function toTimestamp(dateStr: string | null): Timestamp | null {
  if (!dateStr) return null;
  // Local-midnight interpretation; sufficient for "preferred date window"
  // which is informational, not enforced.
  return Timestamp.fromDate(new Date(`${dateStr}T00:00:00Z`));
}

export const createJobPost = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRoleOrAdmin(req, "client");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const input = parsed.data;
  const ctx = { fn: "createJobPost", uid };

  // Per-client open-post cap.
  const openSnap = await db
    .collection("jobPosts")
    .where("clientId", "==", uid)
    .where("status", "==", "open")
    .count()
    .get();
  if (openSnap.data().count >= OPEN_POSTS_PER_CLIENT_CAP) {
    throw new HttpsError(
      "failed-precondition",
      `You can have at most ${OPEN_POSTS_PER_CLIENT_CAP} open posts. Close an existing one first.`,
    );
  }

  const { geohashExact, geohashPublic } = deriveGeohashes(
    input.addressPrivate.lat,
    input.addressPrivate.lng,
  );

  // Denormalize the client's first name + avatar onto the public post so
  // browsing tradies can see who they'd be working for without a
  // cross-account /users read (blocked by rules). Lookup failures fall
  // back to "Client" + null photo so the post still renders sensibly.
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.data() as
    | { displayName?: string; photoURL?: string | null }
    | undefined;
  const clientName = firstNameOnly(userData?.displayName);
  const clientPhotoURL = userData?.photoURL ?? null;

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const postRef = db.collection("jobPosts").doc();
  const metaRef = postRef.collection("private").doc("meta");

  const batch = db.batch();
  batch.set(postRef, {
    clientId: uid,
    clientName,
    clientPhotoURL,
    status: "open",
    trade: input.trade,
    title: input.title,
    description: input.description,
    photos: input.photos,
    addressPublic: {
      city: input.addressPublic.city,
      region: input.addressPublic.region,
      postalFsa: input.addressPublic.postalFsa,
      geohashPublic,
    },
    budget: input.budget,
    urgency: input.urgency,
    preferredDateWindow: {
      start: toTimestamp(input.preferredDateWindow.start),
      end: toTimestamp(input.preferredDateWindow.end),
    },
    convertedJobId: null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    closedAt: null,
    acceptedAt: null,
    editedAt: null,
  });
  batch.set(metaRef, {
    addressPrivate: {
      line1: input.addressPrivate.line1,
      fullPostal: input.addressPrivate.fullPostal,
      geo: new GeoPoint(input.addressPrivate.lat, input.addressPrivate.lng),
      geohashExact,
    },
    applicationCount: 0,
    selectedApplicantId: null,
  });
  await batch.commit();

  logger.info("createJobPost success", { ...ctx, postId: postRef.id });
  await logAdminAction({
    actorUid: uid,
    action: "createJobPost",
    targetType: "jobPost",
    targetId: postRef.id,
    metadata: { trade: input.trade },
  });

  return { postId: postRef.id };
});

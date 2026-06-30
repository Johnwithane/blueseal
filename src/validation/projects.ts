import { z } from "zod";

// A project manager's project: a bundle of trade jobs for one client, set up from
// the cockpit and sent by email invite. Validated at the form boundary; the
// createProject callable re-validates server-side and adds the server-managed
// fields (projectManagerId, status, projectInvite, timestamps). Caps mirror the
// invite-job + job-post schemas so the eventual postings fit those limits.
export const projectJobSpecSchema = z.object({
  trade: z.string().trim().min(1, "Pick a trade"),
  title: z.string().trim().min(3, "Add a short title").max(140),
  description: z.string().trim().min(1, "Describe the work").max(4000),
  // Optional photos a PM attaches per job — Storage paths under
  // jobPosts/{uuid}/photos/ (uploaded exactly like a client job post). Up to 8,
  // mirroring the job-post cap; the eventual posting carries them through.
  photos: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
});

export const projectSchema = z.object({
  label: z.string().trim().min(2, "Add a project name").max(120),
  clientName: z.string().trim().min(1, "Add the client's name").max(80),
  clientEmail: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  propertyId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .transform((v) => (v ? v : null))
    .default(null),
  photoUrl: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .transform((v) => (v ? v : null))
    .default(null),
  // Optional unit within the chosen property (one of its unit labels).
  unit: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => (v ? v : null))
    .default(null),
  jobs: z.array(projectJobSpecSchema).min(1, "Add at least one job").max(20),
});

export type ProjectDraft = z.infer<typeof projectSchema>;

// Adding jobs to an ALREADY-ACCEPTED project (proposeProjectJobs). Each added job
// needs the client's per-job approval before it dispatches, so this is a separate,
// narrower input than the create/edit bundle. The server caps the project's TOTAL
// job count (existing + added) at 20 to mirror projectSchema.
export const addProjectJobsSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  jobs: z.array(projectJobSpecSchema).min(1, "Add at least one job").max(20),
});

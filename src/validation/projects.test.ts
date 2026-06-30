import { describe, it, expect } from "vitest";
import { addProjectJobsSchema } from "./projects";

const validJob = { trade: "painter", title: "Repaint hallway", description: "Two coats, eggshell." };

describe("addProjectJobsSchema", () => {
  it("accepts a project id with one valid job", () => {
    const r = addProjectJobsSchema.safeParse({ projectId: "abc123", jobs: [validJob] });
    expect(r.success).toBe(true);
  });

  it("accepts up to 20 jobs", () => {
    const jobs = Array.from({ length: 20 }, () => ({ ...validJob }));
    expect(addProjectJobsSchema.safeParse({ projectId: "p", jobs }).success).toBe(true);
  });

  it("rejects an empty jobs array", () => {
    expect(addProjectJobsSchema.safeParse({ projectId: "p", jobs: [] }).success).toBe(false);
  });

  it("rejects more than 20 jobs", () => {
    const jobs = Array.from({ length: 21 }, () => ({ ...validJob }));
    expect(addProjectJobsSchema.safeParse({ projectId: "p", jobs }).success).toBe(false);
  });

  it("rejects a missing project id", () => {
    expect(addProjectJobsSchema.safeParse({ projectId: "  ", jobs: [validJob] }).success).toBe(false);
  });

  it("rejects a job with no trade", () => {
    const r = addProjectJobsSchema.safeParse({
      projectId: "p",
      jobs: [{ trade: "", title: "Repaint hallway", description: "x" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a title shorter than 3 chars", () => {
    const r = addProjectJobsSchema.safeParse({
      projectId: "p",
      jobs: [{ trade: "painter", title: "ab", description: "x" }],
    });
    expect(r.success).toBe(false);
  });

  it("trims and strips down to the canonical fields, defaulting photos to []", () => {
    const r = addProjectJobsSchema.safeParse({
      projectId: " p ",
      jobs: [{ trade: " painter ", title: " Repaint hallway ", description: " Two coats. " }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.projectId).toBe("p");
      expect(r.data.jobs[0]).toEqual({
        trade: "painter",
        title: "Repaint hallway",
        description: "Two coats.",
        photos: [],
      });
    }
  });

  it("keeps attached photo paths (up to 8)", () => {
    const photos = Array.from({ length: 8 }, (_, i) => `jobPosts/u/photos/${i}.webp`);
    const r = addProjectJobsSchema.safeParse({
      projectId: "p",
      jobs: [{ ...validJob, photos }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.jobs[0].photos).toEqual(photos);
  });

  it("rejects more than 8 photos on a job", () => {
    const photos = Array.from({ length: 9 }, (_, i) => `jobPosts/u/photos/${i}.webp`);
    const r = addProjectJobsSchema.safeParse({
      projectId: "p",
      jobs: [{ ...validJob, photos }],
    });
    expect(r.success).toBe(false);
  });
});

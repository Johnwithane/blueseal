import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { downscaleForPdf } from "./pdfRender";

// Why this exists: a branded invoice was shipping at ~45 MB because the
// 6250x1718 RGBA lockup went into the PDF at full resolution — jsPDF expands
// an RGBA PNG into a raw RGB stream plus an alpha SMask, and neither was
// compressed. `compress: true` on the jsPDF instance is the bulk of the fix;
// downscaleForPdf is what keeps a tradesperson's phone-camera logo/banner from
// putting it straight back (photos don't shrink losslessly).
//
// happy-dom has no canvas raster backend, so Image + canvas are stubbed here.
// The behaviour under test is the decision-making, not the resampling itself.

interface StubbedCanvas {
  width: number;
  height: number;
  toDataURL: ReturnType<typeof vi.fn>;
}

let lastCanvas: StubbedCanvas | null = null;
let naturalSize = { width: 6250, height: 1718 };
let alphaValue = 255;

beforeEach(() => {
  lastCanvas = null;
  naturalSize = { width: 6250, height: 1718 };
  alphaValue = 255;

  // Resolve the load synchronously-ish: the real Image fires onload after the
  // data URL is decoded; a microtask is close enough for the helper's await.
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        this.naturalWidth = naturalSize.width;
        this.naturalHeight = naturalSize.height;
        queueMicrotask(() => this.onload?.());
      }
    },
  );

  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") throw new Error(`unexpected createElement(${tag})`);
    const canvas: StubbedCanvas & { getContext: (t: string) => unknown } = {
      width: 0,
      height: 0,
      toDataURL: vi.fn((type: string) => `data:${type};base64,SMALL`),
      getContext: () => ({
        drawImage: vi.fn(),
        // One pixel's worth of RGBA is enough — the helper scans for any
        // alpha < 255 and short-circuits.
        getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, alphaValue]) }),
      }),
    };
    lastCanvas = canvas;
    return canvas as unknown as HTMLElement;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downscaleForPdf", () => {
  it("resamples an oversized image down to its draw box, aspect preserved", async () => {
    // The Blue Seal lockup: drawn 34pt tall, so 102px at 3x. 6250x1718 is
    // ~1800x more pixels than the page can ever show.
    await downscaleForPdf("data:image/png;base64,BIG", 612, 34);

    expect(lastCanvas).not.toBeNull();
    expect(lastCanvas!.height).toBe(102);
    // 6250/1718 * 102, rounded.
    expect(lastCanvas!.width).toBe(371);
  });

  it("re-encodes a fully opaque image as JPEG", async () => {
    await downscaleForPdf("data:image/png;base64,BIG", 612, 70);
    expect(lastCanvas!.toDataURL).toHaveBeenCalledWith("image/jpeg", expect.any(Number));
  });

  it("keeps PNG when any pixel is transparent", async () => {
    // The white lockup is transparent everywhere but the mark — JPEG has no
    // alpha channel, so re-encoding it would paint the transparency black
    // across the brand band.
    alphaValue = 0;
    await downscaleForPdf("data:image/png;base64,BIG", 612, 34);
    expect(lastCanvas!.toDataURL).toHaveBeenCalledWith("image/png");
  });

  it("fills the box on both axes for an image the page stretches anyway", async () => {
    // The Pro logo slot draws 38pt square regardless of the source's shape, so
    // aspect-preserving here would hand the page a 29px-tall image to stretch
    // over 38pt — soft on a paid feature. Each axis is capped on its own.
    naturalSize = { width: 1000, height: 250 };
    await downscaleForPdf("data:image/png;base64,WIDE", 38, 38, "stretch");

    expect(lastCanvas!.width).toBe(114); // 38pt * 3
    expect(lastCanvas!.height).toBe(114);
  });

  it("leaves an already-small image alone rather than upscaling it", async () => {
    naturalSize = { width: 80, height: 80 };
    const src = "data:image/png;base64,SMALLSRC";
    expect(await downscaleForPdf(src, 38, 38)).toBe(src);
    expect(lastCanvas).toBeNull();
  });

  it("falls back to the original data URL when decoding fails", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    const src = "data:image/png;base64,BROKEN";
    expect(await downscaleForPdf(src, 612, 34)).toBe(src);
  });
});

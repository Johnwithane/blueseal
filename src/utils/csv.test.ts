import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    expect(parseCsv("name,email\nJane,jane@x.com\nDave,dave@x.com")).toEqual([
      ["name", "email"],
      ["Jane", "jane@x.com"],
      ["Dave", "dave@x.com"],
    ]);
  });

  it("handles quoted fields with embedded commas and quotes", () => {
    expect(parseCsv('name,notes\n"Doe, Jane","She said ""hi"""')).toEqual([
      ["name", "notes"],
      ["Doe, Jane", 'She said "hi"'],
    ]);
  });

  it("handles embedded newlines inside quotes", () => {
    expect(parseCsv('name,notes\n"Jane","line1\nline2"')).toEqual([
      ["name", "notes"],
      ["Jane", "line1\nline2"],
    ]);
  });

  it("handles CRLF line endings and a leading BOM", () => {
    expect(parseCsv("﻿name,email\r\nJane,jane@x.com\r\n")).toEqual([
      ["name", "email"],
      ["Jane", "jane@x.com"],
    ]);
  });

  it("drops fully-empty lines", () => {
    expect(parseCsv("name\n\nJane\n\n")).toEqual([["name"], ["Jane"]]);
  });

  it("keeps empty cells", () => {
    expect(parseCsv("name,email,phone\nJane,,555-1234")).toEqual([
      ["name", "email", "phone"],
      ["Jane", "", "555-1234"],
    ]);
  });
});

import type { Timestamp } from "firebase/firestore";

// Firestore date fields arrive as a Timestamp on the wire but as a JS Date once
// a withConverter has run. Normalize either to a Date. The verification upload
// cards each hand-rolled this exact toDate-or-Date check.
export function toJsDate(value: Timestamp | Date): Date {
  return typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as Timestamp).toDate()
    : (value as Date);
}

import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";

export interface AiResult {
  ok: boolean;
  content: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiCallInput {
  jobId: string;
  prompt?: string;
}

export async function diagnose(input: AiCallInput): Promise<AiResult> {
  const fn = httpsCallable<AiCallInput, AiResult>(functions, "aiDiagnose");
  const { data } = await fn(input);
  return data;
}

export async function quoteHelper(input: AiCallInput): Promise<AiResult> {
  const fn = httpsCallable<AiCallInput, AiResult>(functions, "aiQuote");
  const { data } = await fn(input);
  return data;
}

export async function summarizeJob(input: AiCallInput): Promise<AiResult> {
  const fn = httpsCallable<AiCallInput, AiResult>(functions, "aiSummarize");
  const { data } = await fn(input);
  return data;
}

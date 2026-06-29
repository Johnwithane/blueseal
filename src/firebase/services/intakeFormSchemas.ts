import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { IntakeFormSchemaDoc } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

export async function getIntakeSchema(trade: string): Promise<IntakeFormSchemaDoc | null> {
  const snap = await getDoc(
    doc(db, "intakeFormSchemas", trade).withConverter(typedConverter<IntakeFormSchemaDoc>()),
  );
  return snap.exists() ? snap.data() : null;
}

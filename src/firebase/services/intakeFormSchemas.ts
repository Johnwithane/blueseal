import { doc, getDoc, getDocs, collection } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { IntakeFormSchemaDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const schemasCol = () =>
  collection(db, "intakeFormSchemas").withConverter(typedConverter<IntakeFormSchemaDoc>());

export async function getIntakeSchema(trade: string): Promise<IntakeFormSchemaDoc | null> {
  const snap = await getDoc(
    doc(db, "intakeFormSchemas", trade).withConverter(typedConverter<IntakeFormSchemaDoc>()),
  );
  return snap.exists() ? snap.data() : null;
}

export async function listIntakeSchemas(): Promise<WithId<IntakeFormSchemaDoc>[]> {
  const snap = await getDocs(schemasCol());
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

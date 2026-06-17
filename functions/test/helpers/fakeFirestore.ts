// Tiny in-memory Firestore double for unit-testing callables. Supports the
// subset the callables actually use: db.doc(path).{get,set,update}, snapshot
// .exists/.id/.data()/.ref, and db.runTransaction(tx => …) with
// tx.{get,set,update,delete}. Server-timestamp / FieldValue sentinels are stored
// verbatim (the firebase-admin/firestore mock returns string sentinels), so
// assertions can check `update.field === "__serverTimestamp__"`.

export type Data = Record<string, unknown>;

export interface FakeSnap {
  exists: boolean;
  id: string;
  ref: FakeDocRef;
  data(): Data | undefined;
}

function makeSnap(ref: FakeDocRef, raw: Data | undefined): FakeSnap {
  return {
    exists: raw !== undefined,
    id: ref.id,
    ref,
    data: () => (raw ? { ...raw } : undefined),
  };
}

export class FakeDocRef {
  constructor(
    private readonly fs: FakeFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return this.path.split("/").pop() as string;
  }

  // Firestore doc snapshots expose `.ref` pointing back at the doc.
  get ref(): FakeDocRef {
    return this;
  }

  async get(): Promise<FakeSnap> {
    return makeSnap(this, this.fs._read(this.path));
  }

  async set(data: Data, opts?: { merge?: boolean }): Promise<void> {
    const prev = this.fs._read(this.path);
    this.fs._write(this.path, opts?.merge && prev ? { ...prev, ...data } : { ...data });
  }

  async update(data: Data): Promise<void> {
    const prev = this.fs._read(this.path);
    if (prev === undefined) throw new Error(`update on missing doc ${this.path}`);
    this.fs._write(this.path, { ...prev, ...data });
  }
}

export class FakeTransaction {
  private readonly ops: Array<() => void> = [];
  constructor(private readonly fs: FakeFirestore) {}

  async get(ref: FakeDocRef): Promise<FakeSnap> {
    return makeSnap(ref, this.fs._read(ref.path));
  }
  set(ref: FakeDocRef, data: Data, opts?: { merge?: boolean }): FakeTransaction {
    this.ops.push(() => {
      const prev = this.fs._read(ref.path);
      this.fs._write(ref.path, opts?.merge && prev ? { ...prev, ...data } : { ...data });
    });
    return this;
  }
  update(ref: FakeDocRef, data: Data): FakeTransaction {
    this.ops.push(() => {
      const prev = this.fs._read(ref.path) ?? {};
      this.fs._write(ref.path, { ...prev, ...data });
    });
    return this;
  }
  delete(ref: FakeDocRef): FakeTransaction {
    this.ops.push(() => this.fs._delete(ref.path));
    return this;
  }
  _commit(): void {
    this.ops.forEach((op) => op());
  }
}

export class FakeFirestore {
  private readonly store = new Map<string, Data>();
  private seq = 0;

  /** Seed a document (test setup). */
  seed(path: string, data: Data): void {
    this.store.set(path, { ...data });
  }
  /** All stored docs whose path starts with `prefix/` (e.g. a subcollection). */
  peekUnder(prefix: string): Data[] {
    const out: Data[] = [];
    for (const [k, v] of this.store) if (k.startsWith(`${prefix}/`)) out.push({ ...v });
    return out;
  }
  /** Read the current raw data for assertions (undefined if absent). */
  peek(path: string): Data | undefined {
    const v = this.store.get(path);
    return v ? { ...v } : undefined;
  }
  reset(): void {
    this.store.clear();
  }

  // Internal — used by refs/transactions.
  _read(path: string): Data | undefined {
    return this.store.get(path);
  }
  _write(path: string, data: Data): void {
    this.store.set(path, data);
  }
  _delete(path: string): void {
    this.store.delete(path);
  }

  doc(path: string): FakeDocRef {
    return new FakeDocRef(this, path);
  }

  // Minimal collection ref — enough for callables that do
  // collection(path).add(data) (audit/mail/aiUsage/replies). Auto-ids are
  // sequential so tests can assert deterministically.
  collection(path: string): { add: (data: Data) => Promise<{ id: string }> } {
    return {
      add: async (data: Data) => {
        this.seq += 1;
        const id = `auto_${this.seq}`;
        this.store.set(`${path}/${id}`, { ...data });
        return { id };
      },
    };
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const tx = new FakeTransaction(this);
    const result = await fn(tx);
    tx._commit();
    return result;
  }
}

// Tiny in-memory Firestore double for unit-testing callables. Supports the
// subset the callables actually use: db.doc(path).{get,set,update}, snapshot
// .exists/.id/.data()/.ref, db.runTransaction(tx => …) with
// tx.{get,set,update,delete}, db.batch() with batch.{set,update,delete,commit},
// and collection(path).{add,doc,get} (including subcollections via
// docRef.collection(name)). Server-timestamp / FieldValue sentinels are stored
// verbatim (the firebase-admin/firestore mock returns string sentinels), so
// assertions can check `update.field === "__serverTimestamp__"`.

export type Data = Record<string, unknown>;

export interface FakeSnap {
  exists: boolean;
  id: string;
  ref: FakeDocRef;
  data(): Data | undefined;
}

export interface FakeQuerySnap {
  docs: FakeSnap[];
  empty: boolean;
  size: number;
}

export interface FakeCollectionRef {
  add(data: Data): Promise<{ id: string }>;
  doc(id: string): FakeDocRef;
  get(): Promise<FakeQuerySnap>;
}

function makeSnap(ref: FakeDocRef, raw: Data | undefined): FakeSnap {
  return {
    exists: raw !== undefined,
    id: ref.id,
    ref,
    data: () => (raw ? { ...raw } : undefined),
  };
}

// Apply an update map onto a doc, interpreting dotted keys ("a.b.c") as nested
// field paths the way real Firestore does, cloning nested objects along each
// path so the stored object isn't mutated in place.
function applyUpdate(prev: Data, data: Data): Data {
  const next: Data = { ...prev };
  for (const [key, val] of Object.entries(data)) {
    if (!key.includes(".")) {
      next[key] = val;
      continue;
    }
    const parts = key.split(".");
    let obj = next;
    for (let i = 0; i < parts.length - 1; i++) {
      const cur = obj[parts[i]];
      obj[parts[i]] = typeof cur === "object" && cur !== null ? { ...(cur as Data) } : {};
      obj = obj[parts[i]] as Data;
    }
    obj[parts[parts.length - 1]] = val;
  }
  return next;
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
    this.fs._write(this.path, applyUpdate(prev, data));
  }

  async delete(): Promise<void> {
    this.fs._delete(this.path);
  }

  // Subcollection: jobs/{id}/timeEntries etc. Same ref type as a root
  // collection — the store is flat and keyed by full path.
  collection(name: string): FakeCollectionRef {
    return this.fs.collection(`${this.path}/${name}`);
  }
}

// A WriteBatch: queued ops applied on commit(). Same semantics as
// FakeTransaction minus the reads.
export class FakeBatch {
  private readonly ops: Array<() => void> = [];
  constructor(private readonly fs: FakeFirestore) {}

  set(ref: FakeDocRef, data: Data, opts?: { merge?: boolean }): FakeBatch {
    this.ops.push(() => {
      const prev = this.fs._read(ref.path);
      this.fs._write(ref.path, opts?.merge && prev ? { ...prev, ...data } : { ...data });
    });
    return this;
  }
  update(ref: FakeDocRef, data: Data): FakeBatch {
    this.ops.push(() => {
      const prev = this.fs._read(ref.path) ?? {};
      this.fs._write(ref.path, applyUpdate(prev, data));
    });
    return this;
  }
  delete(ref: FakeDocRef): FakeBatch {
    this.ops.push(() => this.fs._delete(ref.path));
    return this;
  }
  async commit(): Promise<void> {
    this.ops.forEach((op) => op());
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
      this.fs._write(ref.path, applyUpdate(prev, data));
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

  // Collection ref — add() for the write-only callers (audit/mail/aiUsage/
  // replies; auto-ids are sequential so tests can assert deterministically),
  // plus doc()/get() for the ones that read a subcollection back.
  collection(path: string): FakeCollectionRef {
    return {
      add: async (data: Data) => {
        this.seq += 1;
        const id = `auto_${this.seq}`;
        this.store.set(`${path}/${id}`, { ...data });
        return { id };
      },
      doc: (id: string) => this.doc(`${path}/${id}`),
      // Direct children only — a nested subcollection under one of these docs
      // is a different collection, same as real Firestore.
      get: async () => {
        const docs: FakeSnap[] = [];
        for (const [key, raw] of this.store) {
          if (!key.startsWith(`${path}/`)) continue;
          if (key.slice(path.length + 1).includes("/")) continue;
          docs.push(makeSnap(this.doc(key), raw));
        }
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  batch(): FakeBatch {
    return new FakeBatch(this);
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const tx = new FakeTransaction(this);
    const result = await fn(tx);
    tx._commit();
    return result;
  }
}

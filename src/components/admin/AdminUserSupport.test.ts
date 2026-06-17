import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AdminUserSupport from "./AdminUserSupport.vue";
import type { UserDoc, WithId } from "@/firebase/interfaces";

// Composables need app context we don't stand up — mock them.
vi.mock("@/composables/useFormatters", () => ({
  useFormatters: () => ({ dateTime: () => "Jan 1, 2026" }),
}));
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

// Callable + service seams. Each callable returns the { data } envelope.
const adminVerifyUserEmail = vi.fn(async () => ({ data: { ok: true } }));
const adminSetTempPassword = vi.fn(async () => ({ data: { ok: true, tempPassword: "TempPW234ABCDEFG" } }));
vi.mock("@/firebase/services/admin", () => ({
  adminVerifyUserEmail: () => adminVerifyUserEmail(),
  adminSetTempPassword: () => adminSetTempPassword(),
  adminSendPasswordReset: vi.fn(async () => ({ data: { ok: true } })),
  adminResendVerificationEmail: vi.fn(async () => ({ data: { ok: true } })),
  adminSetUserDisabled: vi.fn(async () => ({ data: { ok: true, disabled: true } })),
  adminUpdateUserContact: vi.fn(async () => ({ data: { ok: true, emailChanged: false } })),
  adminGetUserAuthState: vi.fn(async () => ({ data: {} })),
  adminSoftDeleteUser: vi.fn(async () => ({ data: { ok: true, alreadyPending: false } })),
  adminRestoreUser: vi.fn(async () => ({ data: { ok: true } })),
}));
vi.mock("@/firebase/services/users", () => ({
  listSupportNotes: vi.fn(async () => []),
  addSupportNote: vi.fn(async () => {}),
  deleteSupportNote: vi.fn(async () => {}),
}));

const STUBS = {
  Button: {
    props: ["label", "disabled", "loading"],
    emits: ["click"],
    template: '<button :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
  },
  InputText: {
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  Textarea: { props: ["modelValue"], template: "<textarea></textarea>" },
  Message: { template: "<div><slot /></div>" },
  Tag: { props: ["value"], template: "<span>{{ value }}</span>" },
  Dialog: { props: ["visible"], template: '<div v-if="visible"><slot /><slot name="footer" /></div>' },
};

function makeUser(over: Partial<WithId<UserDoc>> = {}): WithId<UserDoc> {
  return {
    id: "u1",
    roles: ["client"],
    activeRole: "client",
    displayName: "Sam Client",
    email: "sam@example.com",
    photoURL: null,
    phone: null,
    createdAt: { toMillis: () => 0 } as never,
    lastActiveAt: { toMillis: () => 0 } as never,
    emailVerified: false,
    clientRatingAvg: 0,
    clientRatingCount: 0,
    termsAcceptedAt: null,
    termsAcceptedVersion: null,
    deletedAt: null,
    notificationPrefs: { emailEnabled: true, whatsappEnabled: true },
    ...over,
  };
}

function mountPanel(user = makeUser()) {
  return mount(AdminUserSupport, {
    props: { user, authState: null },
    global: { stubs: STUBS },
  });
}

const btn = (w: ReturnType<typeof mountPanel>, label: string) =>
  w.findAll("button").find((b) => b.text() === label);

describe("AdminUserSupport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the support sections", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(w.text()).toContain("Support tools");
    expect(w.text()).toContain("Email & password");
    expect(w.text()).toContain("Danger zone");
    expect(btn(w, "Verify email")).toBeTruthy(); // unverified → verify shown
  });

  it("verifies email: calls the callable and emits a patch", async () => {
    const w = mountPanel();
    await flushPromises();
    await btn(w, "Verify email")!.trigger("click");
    await flushPromises();
    expect(adminVerifyUserEmail).toHaveBeenCalledOnce();
    expect(w.emitted("patch")?.[0]).toEqual([{ emailVerified: true }]);
    expect(w.emitted("refreshAuth")).toBeTruthy();
  });

  it("reveals the temp password once after setting it", async () => {
    const w = mountPanel();
    await flushPromises();
    await btn(w, "Set temp password")!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("TempPW234ABCDEFG");
  });

  it("keeps the delete button disabled until the exact email is typed", async () => {
    const w = mountPanel();
    await flushPromises();
    // Open the confirm dialog.
    await btn(w, "Delete account")!.trigger("click");
    // The dialog's footer "Delete account" button is the last one with that label.
    const dialogDelete = () => w.findAll("button").filter((b) => b.text() === "Delete account").at(-1)!;
    expect(dialogDelete().attributes("disabled")).toBeDefined();
    // Type the exact email into the confirm field → button arms.
    const confirm = w.findAll("input").find((i) => i.attributes("placeholder") === "Type the email to confirm")!;
    await confirm.setValue("sam@example.com");
    expect(dialogDelete().attributes("disabled")).toBeUndefined();
  });

  it("shows Restore (not Delete) when the account is already pending deletion", async () => {
    const w = mountPanel(makeUser({ deletedAt: { toMillis: () => 1 } as never }));
    await flushPromises();
    expect(btn(w, "Restore account")).toBeTruthy();
    expect(btn(w, "Delete account")).toBeFalsy();
  });
});

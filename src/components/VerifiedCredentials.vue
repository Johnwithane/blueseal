<script setup lang="ts">
// The "Verified credentials" block on the public tradesperson profile. Lists
// each credential Blue Seal reviewed — Red Seal endorsements (with our seal
// emblem), other trade certifications (by issuing body), plus live liability
// insurance and WSIB clearance. Reads only PUBLIC fields on the tradie doc;
// never shows cert numbers or the uploaded documents themselves.
import { computed } from "vue";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { isRedSealIssuer } from "@/utils/credentials";
import { useFormatters } from "@/composables/useFormatters";

const props = defineProps<{ tradie: WithId<TradespersonDoc> }>();
const { date } = useFormatters();

type RowKind = "redseal" | "cert" | "insurance" | "wsib";
interface Row {
  key: string;
  kind: RowKind;
  title: string;
  subtitle: string;
}

const now = Date.now();

// Credential rows from the denormalized verifiedCredentials, falling back to
// the legacy verifiedTrades list for docs approved before that field existed —
// so the block is never empty for a tradie who clearly has approved certs.
const certRows = computed<Row[]>(() => {
  const creds = props.tradie.verifiedCredentials ?? [];
  if (creds.length) {
    return creds.map((c, i) => {
      const redSeal = c.redSeal || isRedSealIssuer(c.issuingBody);
      return {
        key: `cred-${i}`,
        kind: redSeal ? "redseal" : "cert",
        title: redSeal ? `Red Seal — ${tradeLabel(c.trade)}` : `${tradeLabel(c.trade)} certification`,
        subtitle: redSeal
          ? "Interprovincial Red Seal standard"
          : c.issuingBody || "Verified by Blue Seal",
      };
    });
  }
  return (props.tradie.verifiedTrades ?? []).map((t, i) => ({
    key: `vt-${i}`,
    kind: "cert" as const,
    title: `${tradeLabel(t)} certification`,
    subtitle: "Verified by Blue Seal",
  }));
});

// Insurance / WSIB auto-hide once their recorded expiry passes (same rule as
// the header badges) — a lapsed policy shouldn't read as currently covered.
const insuranceLive = computed(() => {
  if (!props.tradie.insuranceVerified) return false;
  const exp = props.tradie.insuranceExpiresAt?.toDate?.().getTime();
  return exp == null || exp > now;
});
const wsibLive = computed(() => {
  if (!props.tradie.wsibVerified) return false;
  const exp = props.tradie.wsibExpiresAt?.toDate?.().getTime();
  return exp == null || exp > now;
});

const rows = computed<Row[]>(() => {
  const out = [...certRows.value];
  if (insuranceLive.value) {
    const exp = props.tradie.insuranceExpiresAt;
    out.push({
      key: "insurance",
      kind: "insurance",
      title: "Liability insurance",
      subtitle: exp ? `Verified · expires ${date(exp)}` : "Verified by Blue Seal",
    });
  }
  if (wsibLive.value) {
    const exp = props.tradie.wsibExpiresAt;
    out.push({
      key: "wsib",
      kind: "wsib",
      title: "WSIB clearance",
      subtitle: exp ? `Verified · expires ${date(exp)}` : "Verified by Blue Seal",
    });
  }
  return out;
});
</script>

<template>
  <section v-if="rows.length" class="bs-card p-5 mt-4">
    <h2 class="font-semibold mb-1">Verified credentials</h2>
    <p class="text-xs text-[color:var(--bs-muted)] mb-4">
      Documents Blue Seal's admin team reviewed before this tradesperson went live.
    </p>
    <ul class="space-y-3">
      <li v-for="row in rows" :key="row.key" class="flex items-center gap-3">
        <svg
          v-if="row.kind === 'redseal'"
          class="bs-cred-seal"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="11" fill="var(--bs-red)" />
          <path
            fill="#fff"
            d="M12 4.5L13.76 9.57 19.13 9.68 14.85 12.93 16.41 18.07 12 15 7.59 18.07 9.15 12.93 4.87 9.68 10.24 9.57Z"
          />
        </svg>
        <i
          v-else
          class="bs-cred-icon pi"
          :class="row.kind === 'cert' ? 'pi-verified' : 'pi-shield'"
          :style="{
            color:
              row.kind === 'cert'
                ? 'var(--bs-info)'
                : row.kind === 'wsib'
                  ? 'var(--bs-warning)'
                  : 'var(--bs-text)',
          }"
          aria-hidden="true"
        />
        <div class="min-w-0">
          <div class="text-sm font-semibold">{{ row.title }}</div>
          <div class="text-xs text-[color:var(--bs-muted)]">{{ row.subtitle }}</div>
        </div>
      </li>
    </ul>
    <p class="text-xs text-[color:var(--bs-muted)] mt-4">
      A badge confirms a document was checked — not that it's currently in force.
      Always request current proof before work begins.
    </p>
  </section>
</template>

<style scoped>
.bs-cred-seal {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
}
.bs-cred-icon {
  font-size: 20px;
  width: 26px;
  text-align: center;
  flex: 0 0 auto;
}
</style>

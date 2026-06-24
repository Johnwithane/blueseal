<script setup lang="ts">
// Live sample invoice/quote, branded with the tradesperson's logo, letterhead
// banner and brand colour, so they can see how their branding lands on the
// paperwork as they edit it. Self-contained mock (no real invoice data, no
// dependency on the PDF renderer) — purely a faithful preview.
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    logoUrl: string | null;
    bannerUrl: string | null;
    brandColor: string;
    businessName: string;
  }>(),
  { logoUrl: null, bannerUrl: null, brandColor: "#2A3A5C", businessName: "Your business" },
);

// Pick a readable ink colour for text sitting on the brand-colour band.
const textOnBrand = computed(() => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(props.brandColor || "");
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1f2937" : "#ffffff";
});
const brand = computed(() => props.brandColor || "#2A3A5C");
</script>

<template>
  <div class="inv">
    <img v-if="bannerUrl" :src="bannerUrl" class="inv__banner" alt="" />
    <div class="inv__band" :style="{ background: brand, color: textOnBrand }">
      <div class="inv__brand">
        <img v-if="logoUrl" :src="logoUrl" class="inv__logo" alt="" />
        <div class="inv__brand-text">
          <div class="inv__co">{{ businessName || "Your business" }}</div>
          <div class="inv__sub" :style="{ color: textOnBrand, opacity: 0.8 }">
            you@business.ca · (250) 555-0100
          </div>
        </div>
      </div>
      <div class="inv__title">
        <div class="inv__title-word">INVOICE</div>
        <div class="inv__num">INV-2026-0001</div>
      </div>
    </div>

    <div class="inv__body">
      <div class="inv__meta">
        <div>
          <span class="inv__label">Billed to</span>
          <strong>Sample Client</strong>
          <div>123 Example St, Kelowna BC</div>
        </div>
        <div class="inv__meta-right">
          <div><span class="inv__label">Issued</span> Jun 23, 2026</div>
          <div><span class="inv__label">Due</span> Jul 7, 2026</div>
        </div>
      </div>

      <table class="inv__table">
        <thead>
          <tr :style="{ color: brand }">
            <th>Description</th>
            <th class="num">Qty</th>
            <th class="num">Rate</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Labour — site visit &amp; assessment</td>
            <td class="num">2</td>
            <td class="num">$95.00</td>
            <td class="num">$190.00</td>
          </tr>
          <tr>
            <td>Materials &amp; parts</td>
            <td class="num">1</td>
            <td class="num">$140.00</td>
            <td class="num">$140.00</td>
          </tr>
        </tbody>
      </table>

      <div class="inv__totals">
        <div><span>Subtotal</span><span>$330.00</span></div>
        <div><span>GST (5%)</span><span>$16.50</span></div>
        <div class="inv__total" :style="{ color: brand }">
          <span>Total due</span><span>$346.50</span>
        </div>
      </div>

      <div class="inv__pay">
        Payment by e-transfer to you@business.ca. Thanks for your business.
      </div>
    </div>
  </div>
</template>

<style scoped>
.inv {
  border: 1px solid var(--bs-border);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  box-shadow: var(--bs-shadow-sm);
  font-size: 0.8rem;
  color: var(--bs-text);
}
.inv__banner {
  width: 100%;
  height: 56px;
  object-fit: cover;
  display: block;
}
.inv__band {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.8rem 1rem;
}
.inv__brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.inv__logo {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  object-fit: contain;
  background: #fff;
  padding: 2px;
  flex: none;
}
.inv__co {
  font-weight: 700;
  font-size: 0.95rem;
  font-family: var(--bs-font-display);
  line-height: 1.1;
}
.inv__sub {
  font-size: 0.68rem;
}
.inv__title {
  text-align: right;
}
.inv__title-word {
  font-weight: 800;
  letter-spacing: 0.08em;
  font-size: 0.95rem;
}
.inv__num {
  font-size: 0.7rem;
  opacity: 0.85;
}
.inv__body {
  padding: 1rem;
}
.inv__meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
}
.inv__meta strong {
  display: block;
}
.inv__meta-right {
  text-align: right;
}
.inv__label {
  display: inline-block;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--bs-muted);
  margin-bottom: 0.1rem;
}
.inv__table {
  width: 100%;
  border-collapse: collapse;
}
.inv__table th {
  text-align: left;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.3rem 0;
  border-bottom: 2px solid currentColor;
}
.inv__table td {
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--bs-border);
}
.inv__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.inv__totals {
  margin-top: 0.7rem;
  margin-left: auto;
  width: 60%;
}
.inv__totals > div {
  display: flex;
  justify-content: space-between;
  padding: 0.2rem 0;
  font-variant-numeric: tabular-nums;
}
.inv__total {
  font-weight: 700;
  font-size: 0.95rem;
  border-top: 1px solid var(--bs-border);
  margin-top: 0.2rem;
  padding-top: 0.4rem;
}
.inv__pay {
  margin-top: 1rem;
  padding-top: 0.6rem;
  border-top: 1px dashed var(--bs-border);
  font-size: 0.72rem;
  color: var(--bs-muted);
}
</style>

<script setup lang="ts">
// Pitch mockup — "Itemized invoice + card payment". Static mock data only.
import PhoneFrame from "./PhoneFrame.vue";
</script>

<template>
  <PhoneFrame>
    <div class="mk mk-invoice">
      <div class="mk-inv-hd">
        <div>
          <div class="mk-inv-ttl">Invoice</div>
          <div class="mk-inv-no">#BS-1042 · Jun 14, 2026</div>
        </div>
        <span class="mk-inv-status">DUE</span>
      </div>
      <div class="mk-inv-party"><span class="mk-dim">Billed to</span><b>Sarah Patel</b></div>
      <div class="mk-inv-lines">
        <div class="mk-line"><span>Labour · 3.5 hrs @ $95</span><span class="mk-amt">$332.50</span></div>
        <div class="mk-line"><span>Moen 1225 cartridge</span><span class="mk-amt">$48.00</span></div>
        <div class="mk-line"><span>Service call</span><span class="mk-amt">$60.00</span></div>
      </div>
      <div class="mk-inv-tot">
        <div class="mk-trow"><span class="mk-dim">Subtotal</span><span>$440.50</span></div>
        <div class="mk-trow"><span class="mk-dim">GST (5%)</span><span>$22.03</span></div>
        <div class="mk-trow mk-trow--grand"><span>Total</span><span>$462.53</span></div>
      </div>
      <button class="mk-pay">Pay $462.53 by card</button>
      <div class="mk-card-field">
        <span>💳</span><span class="mk-cc-no">4242 4242 4242 4242</span><span class="mk-dim">04/27</span>
      </div>
      <div class="mk-secure">🔒 Secured by Stripe</div>
    </div>
  </PhoneFrame>
</template>

<style scoped>
.mk {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-size: 11px;
  line-height: 1.35;
  color: #2b3242;
}
.mk-dim {
  color: #9aa0ac;
}
.mk-invoice {
  padding: 0 14px 12px;
}
.mk-inv-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 8px 0 10px;
}
.mk-inv-ttl {
  font-family: var(--display, "Poltawski Nowy", serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--bs-dark-blue, #374c76);
}
.mk-inv-no {
  font-size: 10px;
  color: #9aa0ac;
  margin-top: 1px;
}
.mk-inv-status {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  padding: 4px 8px;
  border-radius: 999px;
  background: #fff3df;
  color: #9a6212;
}
.mk-inv-party {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 9px 11px;
  background: #f7f8fa;
  border-radius: 10px;
  font-size: 10.5px;
}
.mk-inv-party b {
  color: #2b3242;
  font-size: 11.5px;
}
.mk-inv-lines {
  margin-top: 10px;
}
.mk-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid #f0f1f4;
  font-size: 11px;
}
.mk-line span:first-child {
  color: #4a5160;
}
.mk-amt {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #2b3242;
}
.mk-inv-tot {
  margin-top: 9px;
}
.mk-trow {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  padding: 3px 0;
  font-variant-numeric: tabular-nums;
}
.mk-trow--grand {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1.5px solid #e6e8ec;
  font-weight: 800;
  font-size: 13px;
  color: var(--bs-dark-blue, #374c76);
}
.mk-pay {
  margin-top: auto;
  border: none;
  cursor: pointer;
  background: var(--bs-red, #b2373d);
  color: #fff;
  font-family: var(--body, "Roboto", sans-serif);
  font-weight: 700;
  font-size: 12px;
  padding: 11px;
  border-radius: 11px;
  box-shadow: var(--sh-md, 0 8px 24px -12px rgba(34, 49, 78, 0.25));
}
.mk-card-field {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  padding: 9px 11px;
  border: 1px solid var(--bs-border, #eae7df);
  border-radius: 10px;
  font-size: 11px;
}
.mk-cc-no {
  letter-spacing: 0.04em;
  color: #3a4150;
  flex: 1;
}
.mk-secure {
  text-align: center;
  font-size: 9px;
  color: #9aa0ac;
  margin-top: 8px;
}
</style>

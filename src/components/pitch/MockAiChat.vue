<script setup lang="ts">
// Pitch mockup — "the AI assistant inside a job" (diagnose · draft a reply ·
// quote). Static mock data only.
import PhoneFrame from "./PhoneFrame.vue";
</script>

<template>
  <PhoneFrame>
    <div class="mk mk-ai">
      <div class="mk-ai-hd">
        <span class="mk-ai-spark">✦</span>
        <div>
          <div class="mk-ai-ttl">Blue Seal AI</div>
          <div class="mk-ai-ctx">Leaking kitchen tap · Sarah P.</div>
        </div>
        <span class="mk-pro">PRO</span>
      </div>
      <div class="mk-thread">
        <div class="mk-msg mk-msg--user">What's likely wrong, and what should I quote?</div>
        <div class="mk-msg mk-msg--ai">
          From the photos and intake it's a worn cartridge — not the whole faucet. ~30&nbsp;min plus
          the part. Here's a draft quote:
        </div>
        <div class="mk-quote">
          <div class="mk-quote-row"><span>Labour · 0.5 hr</span><span>$47.50</span></div>
          <div class="mk-quote-row"><span>Moen 1225 cartridge</span><span>$48.00</span></div>
          <div class="mk-quote-row mk-quote-row--t"><span>Total incl. GST</span><span>$100.28</span></div>
        </div>
      </div>
      <div class="mk-ai-actions">
        <span class="mk-act">Draft a reply</span>
        <span class="mk-act mk-act--on">Use quote</span>
        <span class="mk-act">Clock me in</span>
      </div>
      <div class="mk-ai-input">
        <span class="grow mk-dim">Ask anything about this job…</span><span class="mk-send">➤</span>
      </div>
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
.grow {
  flex: 1;
}
.mk-ai {
  background: #f6f8fc;
}
.mk-ai-hd {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 13px;
  background: #fff;
  border-bottom: 1px solid #eef0f4;
}
.mk-ai-spark {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--bs-mid-blue, #5e81c9), var(--bs-dark-blue, #374c76));
  color: #fff;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.mk-ai-ttl {
  font-weight: 800;
  font-size: 12px;
  color: var(--bs-dark-blue, #374c76);
}
.mk-ai-ctx {
  font-size: 9.5px;
  color: #9aa0ac;
  margin-top: 1px;
}
.mk-pro {
  margin-left: auto;
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 3px 7px;
  border-radius: 999px;
  background: #eceefb;
  color: #4250a8;
}
.mk-thread {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 13px;
}
.mk-msg {
  max-width: 82%;
  padding: 8px 10px;
  border-radius: 13px;
  font-size: 11px;
  line-height: 1.4;
}
.mk-msg--user {
  align-self: flex-end;
  background: var(--bs-dark-blue, #374c76);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.mk-msg--ai {
  align-self: flex-start;
  background: #fff;
  border: 1px solid #e9ecf2;
  color: #39404e;
  border-bottom-left-radius: 4px;
}
.mk-quote {
  align-self: flex-start;
  width: 88%;
  background: #fff;
  border: 1px solid #e9ecf2;
  border-left: 3px solid var(--bs-mid-blue, #5e81c9);
  border-radius: 11px;
  padding: 9px 11px;
}
.mk-quote-row {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  padding: 3px 0;
  color: #4a5160;
  font-variant-numeric: tabular-nums;
}
.mk-quote-row--t {
  margin-top: 3px;
  padding-top: 6px;
  border-top: 1px solid #eef0f4;
  font-weight: 800;
  color: var(--bs-dark-blue, #374c76);
}
.mk-ai-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 6px 13px;
  overflow: hidden;
}
.mk-act {
  font-size: 9.5px;
  font-weight: 700;
  padding: 6px 10px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--bs-border, #eae7df);
  color: #5b6172;
  white-space: nowrap;
}
.mk-act--on {
  background: var(--bs-mid-blue, #5e81c9);
  border-color: var(--bs-mid-blue, #5e81c9);
  color: #fff;
}
.mk-ai-input {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 13px 13px;
  padding: 9px 12px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 999px;
  font-size: 11px;
}
.mk-send {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bs-red, #b2373d);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex: 0 0 auto;
}
</style>

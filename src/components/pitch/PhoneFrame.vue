<script setup lang="ts">
// Pure presentational phone shell for the pitch-deck app mockups: dark bezel,
// dynamic-island pill, a faux status bar (9:41 · 5G · battery), and a slot for
// the screen content. No logic — the four Mock* screens wrap their markup in
// this so the device chrome is defined once. Brand CSS vars are inherited from
// the surrounding `.pitch-root`; var() fallbacks keep it sane in isolation.
</script>

<template>
  <div class="phone">
    <div class="phone-bezel">
      <div class="phone-island"></div>
      <div class="phone-screen">
        <div class="phone-status">
          <span>9:41</span>
          <span class="ps-r">5G<span class="phone-bat"></span></span>
        </div>
        <div class="phone-content">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.phone {
  width: 100%;
  max-width: 300px;
  margin: 0 auto;
}
.phone-bezel {
  position: relative;
  background: #10151f;
  border-radius: 38px;
  padding: 7px;
  box-shadow:
    0 26px 54px -20px rgba(16, 21, 31, 0.6),
    inset 0 0 0 2px rgba(255, 255, 255, 0.05);
}
.phone-screen {
  position: relative;
  background: #fff;
  border-radius: 32px;
  overflow: hidden;
  aspect-ratio: 300 / 580;
  display: flex;
  flex-direction: column;
}
.phone-island {
  position: absolute;
  top: 13px;
  left: 50%;
  transform: translateX(-50%);
  width: 74px;
  height: 19px;
  background: #10151f;
  border-radius: 999px;
  z-index: 6;
}
.phone-status {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 18px 5px;
  font-size: 11px;
  font-weight: 700;
  color: #10151f;
  letter-spacing: 0.02em;
}
.ps-r {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.phone-bat {
  width: 20px;
  height: 10px;
  border: 1.4px solid #10151f;
  border-radius: 3px;
  position: relative;
}
.phone-bat::before {
  content: "";
  position: absolute;
  inset: 1.5px;
  right: 5px;
  background: #10151f;
  border-radius: 1px;
}
.phone-bat::after {
  content: "";
  position: absolute;
  right: -3px;
  top: 3px;
  width: 2px;
  height: 4px;
  background: #10151f;
  border-radius: 0 1px 1px 0;
}
.phone-content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>

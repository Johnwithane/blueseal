<script setup lang="ts">
// Pitch mockup — "Search & map of verified pros". Static mock data only.
import PhoneFrame from "./PhoneFrame.vue";
</script>

<template>
  <PhoneFrame>
    <div class="mk mk-search">
      <div class="mk-hd">
        <div>
          <div class="mk-hd-sm">Find a verified pro</div>
          <div class="mk-hd-loc">📍 Kelowna, BC</div>
        </div>
        <div class="mk-ava-sm">SP</div>
      </div>
      <div class="mk-search-bar">
        <span class="mk-srch-ic">🔍</span><span class="grow">Plumber</span><span class="mk-srch-ic">⚙</span>
      </div>
      <div class="mk-chips">
        <span class="mk-chip mk-chip--on">✓ Verified</span>
        <span class="mk-chip">Top rated</span>
        <span class="mk-chip">Available</span>
      </div>
      <div class="mk-map">
        <span class="mk-road mk-road--1"></span>
        <span class="mk-road mk-road--2"></span>
        <span class="mk-pin" style="left: 26%; top: 40%"></span>
        <span class="mk-pin" style="left: 64%; top: 30%"></span>
        <span class="mk-pin mk-pin--active" style="left: 48%; top: 64%"></span>
      </div>
      <div class="mk-results">
        <div class="mk-res">
          <div class="mk-res-ava" style="background: #5e81c9">DR</div>
          <div class="mk-res-main">
            <div class="mk-res-top">
              <span class="mk-res-name">Dave R. Plumbing</span><span class="mk-seal">✓</span>
            </div>
            <div class="mk-res-sub">Plumber · Red Seal</div>
            <div class="mk-res-meta">
              <span class="mk-star">★ 4.9</span><span class="mk-dim">(32)</span><span class="mk-dim">· 2.3 km</span>
            </div>
          </div>
        </div>
        <div class="mk-res">
          <div class="mk-res-ava" style="background: #b2373d">SM</div>
          <div class="mk-res-main">
            <div class="mk-res-top">
              <span class="mk-res-name">S. Mitchell Mech.</span><span class="mk-seal">✓</span>
            </div>
            <div class="mk-res-sub">Plumber · Gas-fitter</div>
            <div class="mk-res-meta">
              <span class="mk-star">★ 4.8</span><span class="mk-dim">(17)</span><span class="mk-dim">· 4.1 km</span>
            </div>
          </div>
        </div>
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
.mk-hd {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px 10px;
}
.mk-hd-sm {
  font-family: var(--display, "Poltawski Nowy", serif);
  font-size: 14px;
  font-weight: 700;
  color: var(--bs-dark-blue, #374c76);
}
.mk-hd-loc {
  font-size: 10px;
  color: #9aa0ac;
  margin-top: 1px;
}
.mk-ava-sm {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--bs-dark-blue, #374c76);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mk-seal {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--bs-mid-blue, #5e81c9);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  box-shadow: 0 0 0 2px #fff;
}
.mk-search-bar {
  margin: 0 14px;
  display: flex;
  align-items: center;
  gap: 7px;
  background: #f2f3f6;
  border-radius: 11px;
  padding: 9px 11px;
  font-size: 11px;
  font-weight: 600;
  color: #3a4150;
}
.grow {
  flex: 1;
}
.mk-srch-ic {
  opacity: 0.6;
}
.mk-chips {
  display: flex;
  gap: 6px;
  padding: 9px 14px 4px;
}
.mk-chip {
  font-size: 9.5px;
  font-weight: 700;
  padding: 4px 9px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--bs-border, #eae7df);
  color: #6b7280;
}
.mk-chip--on {
  background: #eaf1fc;
  border-color: #cfe0fb;
  color: var(--bs-mid-blue, #5e81c9);
}
.mk-map {
  position: relative;
  flex: 1 1 auto;
  min-height: 90px;
  margin: 8px 14px;
  border-radius: 13px;
  overflow: hidden;
  background:
    radial-gradient(120px 90px at 20% 80%, #cfe9d6, transparent 70%),
    radial-gradient(140px 110px at 90% 15%, #cfe3f7, transparent 70%), #eef1ee;
}
.mk-map::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(120, 130, 140, 0.1) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120, 130, 140, 0.1) 1px, transparent 1px);
  background-size: 26px 26px;
}
.mk-road {
  position: absolute;
  background: #fff;
  opacity: 0.8;
}
.mk-road--1 {
  left: -10%;
  right: -10%;
  top: 46%;
  height: 6px;
  transform: rotate(-7deg);
  border-radius: 6px;
}
.mk-road--2 {
  top: -10%;
  bottom: -10%;
  left: 38%;
  width: 6px;
  transform: rotate(9deg);
  border-radius: 6px;
}
.mk-pin {
  position: absolute;
  width: 13px;
  height: 13px;
  border-radius: 50% 50% 50% 0;
  transform: translate(-50%, -100%) rotate(-45deg);
  background: var(--bs-mid-blue, #5e81c9);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
}
.mk-pin::after {
  content: "";
  position: absolute;
  inset: 3.5px;
  background: #fff;
  border-radius: 50%;
}
.mk-pin--active {
  background: var(--bs-red, #b2373d);
  width: 17px;
  height: 17px;
  z-index: 3;
}
.mk-results {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 2px 14px 10px;
}
.mk-res {
  display: flex;
  gap: 9px;
  align-items: center;
  background: #fff;
  border: 1px solid var(--bs-border, #eae7df);
  border-radius: 12px;
  padding: 8px 9px;
  box-shadow: var(--sh-sm, 0 1px 2px rgba(34, 49, 78, 0.08));
}
.mk-res-ava {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.mk-res-main {
  flex: 1;
  min-width: 0;
}
.mk-res-top {
  display: flex;
  align-items: center;
  gap: 5px;
}
.mk-res-name {
  font-weight: 700;
  font-size: 11.5px;
  color: #2b3242;
}
.mk-res-sub {
  font-size: 10px;
  color: #7b8190;
  margin-top: 1px;
}
.mk-res-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  margin-top: 3px;
}
.mk-star {
  color: #e0a23b;
  font-weight: 700;
}
</style>

<script setup lang="ts">
// Pitch mockup — "Job kanban + per-job chat". Static mock data only. Columns and
// labels mirror the real KanbanBoard (Inbox / Quoted / In progress).
import PhoneFrame from "./PhoneFrame.vue";
</script>

<template>
  <PhoneFrame>
    <div class="mk mk-kanban">
      <div class="mk-hd">
        <div class="mk-hd-title">My jobs</div>
        <div class="mk-seg"><span>List</span><span class="mk-seg--on">Board</span><span>Cal</span></div>
      </div>
      <div class="mk-board">
        <div class="mk-col">
          <div class="mk-col-hd"><span class="mk-dot" style="background: #5e81c9"></span>Inbox <b>2</b></div>
          <div class="mk-card">
            <div class="mk-card-t">Leaking kitchen tap</div>
            <div class="mk-card-c">Sarah P. · Glenmore</div>
            <div class="mk-card-f"><span class="mk-tag">New</span><span class="mk-chatb">💬 2</span></div>
          </div>
          <div class="mk-card">
            <div class="mk-card-t">Bathroom reno quote</div>
            <div class="mk-card-c">M. Chen</div>
            <div class="mk-card-f"><span class="mk-tag">New</span></div>
          </div>
        </div>
        <div class="mk-col">
          <div class="mk-col-hd"><span class="mk-dot" style="background: #e0a23b"></span>Quoted <b>1</b></div>
          <div class="mk-card">
            <div class="mk-card-t">Water heater swap</div>
            <div class="mk-card-c">D. Okafor</div>
            <div class="mk-card-f"><span class="mk-price">$1,180</span></div>
          </div>
        </div>
        <div class="mk-col">
          <div class="mk-col-hd"><span class="mk-dot" style="background: #37a169"></span>In progress <b>1</b></div>
          <div class="mk-card mk-card--live">
            <div class="mk-card-t">Repipe — basement</div>
            <div class="mk-card-c">R. Singh</div>
            <div class="mk-card-f"><span class="mk-tag mk-tag--live">● Clocked in</span></div>
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
.mk-hd {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px 10px;
}
.mk-hd-title {
  font-family: var(--display, "Poltawski Nowy", serif);
  font-size: 15px;
  font-weight: 700;
  color: var(--bs-dark-blue, #374c76);
}
.mk-seg {
  display: inline-flex;
  background: #f2f3f6;
  border-radius: 9px;
  padding: 2px;
  font-size: 10px;
  font-weight: 700;
}
.mk-seg span {
  padding: 4px 8px;
  border-radius: 7px;
  color: #8a90a0;
}
.mk-seg .mk-seg--on {
  background: #fff;
  color: var(--bs-dark-blue, #374c76);
  box-shadow: var(--sh-sm, 0 1px 2px rgba(34, 49, 78, 0.08));
}
.mk-board {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  gap: 8px;
  padding: 0 0 12px 14px;
  overflow: hidden;
}
.mk-board::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 26px;
  background: linear-gradient(90deg, transparent, #fff);
  pointer-events: none;
}
.mk-col {
  flex: 0 0 132px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.mk-col-hd {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 700;
  color: #5b6172;
  padding: 2px 2px 0;
}
.mk-col-hd b {
  margin-left: auto;
  color: #9aa0ac;
  font-weight: 700;
}
.mk-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.mk-card {
  background: #fff;
  border: 1px solid var(--bs-border, #eae7df);
  border-radius: 11px;
  padding: 8px 9px;
  box-shadow: var(--sh-sm, 0 1px 2px rgba(34, 49, 78, 0.08));
}
.mk-card--live {
  border-color: #bfe3cd;
}
.mk-card-t {
  font-weight: 700;
  font-size: 11px;
  color: #2b3242;
}
.mk-card-c {
  font-size: 10px;
  color: #8a90a0;
  margin-top: 2px;
}
.mk-card-f {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
}
.mk-tag {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: #eef1f9;
  color: var(--bs-mid-blue, #5e81c9);
}
.mk-tag--live {
  background: #e7f5ec;
  color: #2f8a52;
}
.mk-price {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--bs-dark-blue, #374c76);
}
.mk-chatb {
  margin-left: auto;
  font-size: 9.5px;
  font-weight: 700;
  color: #8a90a0;
}
</style>

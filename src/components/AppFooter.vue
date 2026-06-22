<script setup lang="ts">
const year = new Date().getFullYear();
</script>

<template>
  <footer class="border-t border-[color:var(--bs-border)] bg-white">
    <div class="bs-container py-6 text-sm text-[color:var(--bs-muted)] flex flex-wrap items-start justify-between gap-3">
      <div>
        <div>© {{ year }} Blue Seal · verified tradespeople across Canada.</div>
        <div class="mt-1 text-xs flex flex-wrap gap-3">
          <router-link to="/privacy">Privacy</router-link>
          <router-link to="/terms">Terms</router-link>
          <router-link to="/help">Help Center</router-link>
          <router-link to="/faq">FAQ</router-link>
        </div>
        <div class="mt-2 text-xs flex flex-wrap gap-3">
          <span class="font-semibold text-[color:var(--bs-blue-dark)]">Areas:</span>
          <router-link to="/cities/kelowna">Kelowna</router-link>
          <router-link to="/cities/vernon">Vernon</router-link>
          <router-link to="/cities/penticton">Penticton</router-link>
          <router-link to="/cities/kamloops">Kamloops</router-link>
          <router-link to="/cities">All areas</router-link>
        </div>
      </div>
      <nav class="flex flex-wrap gap-4">
        <router-link to="/search">Find a tradesperson</router-link>
        <router-link to="/trades">Browse trades</router-link>
        <router-link to="/cities">Areas we cover</router-link>
        <router-link to="/sign-up?as=tradesperson">I'm a tradesperson</router-link>
        <router-link to="/pricing">Pricing</router-link>
      </nav>
    </div>
  </footer>
</template>

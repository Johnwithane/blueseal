<script setup lang="ts">
const year = new Date().getFullYear();
</script>

<template>
  <footer class="border-t border-[color:var(--bs-border)] bg-white">
    <div class="bs-container py-6 text-sm text-[color:var(--bs-muted)] flex flex-wrap items-start justify-between gap-3">
      <div>
        <div>© {{ year }} Blue Seal — verified tradespeople across Canada.</div>
        <div class="mt-1 text-xs flex flex-wrap gap-3">
          <router-link to="/privacy">Privacy</router-link>
          <router-link to="/terms">Terms</router-link>
          <router-link to="/help">Help Center</router-link>
          <router-link to="/faq">FAQ</router-link>
        </div>
      </div>
      <nav class="flex flex-wrap gap-4">
        <router-link to="/search">Find a tradesperson</router-link>
        <router-link to="/sign-up?as=tradesperson">I'm a tradesperson</router-link>
        <router-link to="/help">Help &amp; support</router-link>
      </nav>
    </div>
  </footer>
</template>

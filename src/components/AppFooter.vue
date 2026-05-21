<script setup lang="ts">
const year = new Date().getFullYear();
</script>

<template>
  <footer class="border-t border-[color:var(--bs-border)] bg-white">
    <div class="bs-container py-6 text-sm text-[color:var(--bs-muted)] flex flex-wrap items-center justify-between gap-3">
      <div>© {{ year }} Blue Seal — verified tradespeople across Canada.</div>
      <nav class="flex gap-4">
        <router-link to="/search">Find a tradie</router-link>
        <router-link to="/sign-up/tradie">I'm a trade</router-link>
      </nav>
    </div>
  </footer>
</template>

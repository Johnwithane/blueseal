<script setup lang="ts">
import MyApplicationsList from "@/components/MyApplicationsList.vue";
</script>

<template>
  <section class="bs-container py-6 max-w-3xl">
    <p class="text-[color:var(--bs-muted)]">Jobs you've applied to, grouped by status.</p>
    <MyApplicationsList />
  </section>
</template>

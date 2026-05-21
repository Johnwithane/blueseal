<script setup lang="ts">
import { RouterLink } from "vue-router";
import Button from "primevue/button";
</script>

<template>
  <section class="bg-gradient-to-br from-[#0d47a1] to-[#1e88e5] text-white">
    <div class="bs-container py-16 sm:py-24 grid sm:grid-cols-2 gap-10 items-center">
      <div>
        <h1 class="text-4xl sm:text-5xl font-bold leading-tight">
          Verified tradies. Real reviews. Honest quotes.
        </h1>
        <p class="mt-4 text-lg opacity-90 max-w-prose">
          Blue Seal vets every tradesperson by cert and government ID. Find a trusted pro near you,
          chat, get a quote, and keep your whole job in one place.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <RouterLink to="/search"><Button label="Find a tradie" icon="pi pi-search" size="large" severity="contrast" /></RouterLink>
          <RouterLink to="/sign-up/tradie"><Button label="I'm a trade" icon="pi pi-wrench" size="large" outlined severity="contrast" /></RouterLink>
        </div>
      </div>
      <div class="bs-card p-6 text-[color:var(--bs-text)]">
        <h3 class="font-semibold text-lg mb-3">Why Blue Seal?</h3>
        <ul class="space-y-3 text-sm">
          <li class="flex gap-2"><i class="pi pi-verified text-[color:var(--bs-blue)] mt-0.5"></i><span><strong>Real verification.</strong> Cert + photo ID, admin-reviewed.</span></li>
          <li class="flex gap-2"><i class="pi pi-star text-[color:var(--bs-blue)] mt-0.5"></i><span><strong>Mutual reviews.</strong> Both sides build reputation.</span></li>
          <li class="flex gap-2"><i class="pi pi-comments text-[color:var(--bs-blue)] mt-0.5"></i><span><strong>Everything in one thread.</strong> Chat, photos, schedule, invoice.</span></li>
          <li class="flex gap-2"><i class="pi pi-bolt text-[color:var(--bs-blue)] mt-0.5"></i><span><strong>AI built in.</strong> Diagnose, quote, and summarize faster.</span></li>
        </ul>
      </div>
    </div>
  </section>

  <section class="bs-container py-12">
    <h2 class="text-2xl font-bold mb-6">How it works</h2>
    <div class="grid sm:grid-cols-3 gap-6">
      <div class="bs-card p-5">
        <i class="pi pi-search text-2xl text-[color:var(--bs-blue)]"></i>
        <h3 class="font-semibold mt-2">1. Search</h3>
        <p class="text-sm text-[color:var(--bs-muted)]">Filter by trade, distance, rating, and availability.</p>
      </div>
      <div class="bs-card p-5">
        <i class="pi pi-comments text-2xl text-[color:var(--bs-blue)]"></i>
        <h3 class="font-semibold mt-2">2. Request</h3>
        <p class="text-sm text-[color:var(--bs-muted)]">Send a quote request with photos and trade-specific details.</p>
      </div>
      <div class="bs-card p-5">
        <i class="pi pi-check-circle text-2xl text-[color:var(--bs-blue)]"></i>
        <h3 class="font-semibold mt-2">3. Get it done</h3>
        <p class="text-sm text-[color:var(--bs-muted)]">Chat, schedule, pay, and review — all in Blue Seal.</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import LegalDocument from "@/components/LegalDocument.vue";
import source from "../../legal/privacy-policy.md?raw";
</script>

<template>
  <LegalDocument :source="source" />
</template>

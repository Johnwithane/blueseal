<script setup lang="ts">
import LegalDocument from "@/components/LegalDocument.vue";
import source from "../../legal/terms-of-service.md?raw";
</script>

<template>
  <LegalDocument :source="source" />
</template>

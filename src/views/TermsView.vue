<script setup lang="ts">
import LegalDocument from "@/components/LegalDocument.vue";
import source from "../../legal/terms-of-service.md?raw";
import { useSeo } from "@/composables/useSeo";
import { termsSeo } from "@/seo/content";

useSeo(termsSeo());
</script>

<template>
  <LegalDocument :source="source" />
</template>

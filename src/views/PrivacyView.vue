<script setup lang="ts">
import LegalDocument from "@/components/LegalDocument.vue";
import source from "../../legal/privacy-policy.md?raw";
import { useSeo } from "@/composables/useSeo";
import { privacySeo } from "@/seo/content";

useSeo(privacySeo());
</script>

<template>
  <LegalDocument :source="source" />
</template>

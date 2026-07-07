<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "@/utils/renderMarkdown";

const props = defineProps<{
  source: string;
}>();

const html = computed(() =>
  // Sanitize (shared util), then rewrite the repo-relative doc links to routes.
  renderMarkdown(props.source)
    .replaceAll('href="./privacy-policy.md"', 'href="/privacy"')
    .replaceAll('href="./terms-of-service.md"', 'href="/terms"'),
);
</script>

<template>
  <article class="bs-container py-10 max-w-3xl mx-auto legal-doc">
    <!-- Source is our own repo-checked legal markdown — not user input. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-html="html" />
  </article>
</template>

<style scoped>
.legal-doc :deep(h1) {
  font-size: 1.875rem;
  font-weight: 700;
  margin-bottom: 1rem;
}
.legal-doc :deep(h2) {
  font-size: 1.5rem;
  font-weight: 600;
  margin-top: 2.5rem;
  margin-bottom: 0.75rem;
}
.legal-doc :deep(h3) {
  font-size: 1.125rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
}
.legal-doc :deep(p) {
  margin-bottom: 1rem;
  line-height: 1.6;
}
.legal-doc :deep(ul),
.legal-doc :deep(ol) {
  padding-left: 1.5rem;
  margin-bottom: 1rem;
  line-height: 1.6;
}
.legal-doc :deep(li) {
  margin-bottom: 0.25rem;
}
.legal-doc :deep(table) {
  border-collapse: collapse;
  margin-bottom: 1rem;
  width: 100%;
  font-size: 0.9375rem;
}
.legal-doc :deep(th),
.legal-doc :deep(td) {
  border: 1px solid var(--bs-border);
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: top;
}
.legal-doc :deep(th) {
  background: rgba(0, 0, 0, 0.03);
  font-weight: 600;
}
.legal-doc :deep(a) {
  color: #0d47a1;
  text-decoration: underline;
}
.legal-doc :deep(strong) {
  font-weight: 600;
}
.legal-doc :deep(hr) {
  border: 0;
  border-top: 1px solid var(--bs-border);
  margin: 2.5rem 0;
}
.legal-doc :deep(code) {
  background: rgba(0, 0, 0, 0.04);
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.875em;
}
.legal-doc :deep(blockquote) {
  border-left: 3px solid var(--bs-border);
  padding-left: 1rem;
  color: var(--bs-muted);
  margin-bottom: 1rem;
}
</style>

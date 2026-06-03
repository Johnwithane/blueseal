<script setup lang="ts">
// Renders Markdown for Help Center articles and FAQ answers. Content is
// admin-authored (siteContent/help, admin-only write) or our own bundled
// baseline — not arbitrary user input — so v-html is acceptable here, the
// same trust model as LegalDocument.vue.
import { computed } from "vue";
import { marked } from "marked";

const props = defineProps<{ source: string }>();

const html = computed(() => marked.parse(props.source, { gfm: true, async: false }) as string);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="help-prose" v-html="html" />
</template>

<style scoped>
.help-prose :deep(h2) {
  font-size: 1.35rem;
  font-weight: 600;
  margin-top: 2rem;
  margin-bottom: 0.6rem;
  color: var(--bs-blue-dark);
}
.help-prose :deep(h3) {
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 0.4rem;
  color: var(--bs-blue-dark);
}
.help-prose :deep(p) {
  margin-bottom: 1rem;
  line-height: 1.7;
}
.help-prose :deep(ul),
.help-prose :deep(ol) {
  padding-left: 1.4rem;
  margin-bottom: 1rem;
  line-height: 1.7;
}
.help-prose :deep(ul) {
  list-style: disc;
}
.help-prose :deep(ol) {
  list-style: decimal;
}
.help-prose :deep(li) {
  margin-bottom: 0.35rem;
}
.help-prose :deep(a) {
  color: var(--bs-blue);
  text-decoration: underline;
}
.help-prose :deep(strong) {
  font-weight: 600;
  color: var(--bs-text);
}
.help-prose :deep(code) {
  background: rgba(0, 0, 0, 0.04);
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
  font-size: 0.875em;
}
.help-prose :deep(blockquote) {
  border-left: 3px solid var(--bs-border);
  padding-left: 1rem;
  color: var(--bs-muted);
  margin-bottom: 1rem;
}
.help-prose :deep(hr) {
  border: 0;
  border-top: 1px solid var(--bs-border);
  margin: 2rem 0;
}
</style>

<script setup lang="ts">
import { watch, onUnmounted } from "vue";

// Lightweight full-screen image lightbox. Controlled via `src`: set it to a URL
// to open, emit `close` to dismiss. Used instead of opening images in a new
// tab (which on mobile leaves the app / shows a bare image page).
const props = withDefaults(defineProps<{ src: string | null; alt?: string }>(), {
  alt: "",
});

const emit = defineEmits<{ close: [] }>();

// Lock body scroll while open, and allow Esc to close.
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
watch(
  () => props.src,
  (s) => {
    if (s) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", onKey);
    } else {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    }
  },
);
onUnmounted(() => {
  document.body.style.overflow = "";
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="src" class="bs-lightbox" @click="emit('close')">
      <button type="button" class="bs-lightbox__close" aria-label="Close" @click="emit('close')">
        <i class="pi pi-times"></i>
      </button>
      <!-- Stop propagation so tapping the image itself doesn't close it. -->
      <img :src="src" :alt="alt" class="bs-lightbox__img" @click.stop />
    </div>
  </Teleport>
</template>

<style scoped>
.bs-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.88);
  padding: 1rem;
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
.bs-lightbox__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}
.bs-lightbox__close {
  position: absolute;
  top: max(0.75rem, env(safe-area-inset-top));
  right: 0.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 0;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  font-size: 1.1rem;
  cursor: pointer;
}
.bs-lightbox__close:hover {
  background: rgba(255, 255, 255, 0.28);
}
</style>

<script setup lang="ts">
import type { JobDoc, WithId } from "@/firebase/interfaces";
import ChatThread from "@/components/ChatThread.vue";

defineProps<{
  job: WithId<JobDoc>;
  isTradie: boolean;
}>();
</script>

<template>
  <ChatThread
    :chat-id="job.chatId"
    :job-id="job.id"
    :enable-ai-replies="isTradie"
  />
</template>

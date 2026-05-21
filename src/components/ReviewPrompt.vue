<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import Rating from "primevue/rating";
import Message from "primevue/message";
import { createReview, createClientReview } from "@/firebase/services/reviews";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useToast } from "@/composables/useToast";

const props = defineProps<{
  job: WithId<JobDoc>;
  asRole: "client" | "tradesperson";
}>();

const emit = defineEmits<{ reviewed: [] }>();

const open = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

const overall = ref(5);
const text = ref("");
const quality = ref(5);
const punctuality = ref(5);
const communication = ref(5);
const value = ref(5);
const clarity = ref(5);
const payment = ref(5);

async function submit() {
  submitting.value = true;
  error.value = null;
  try {
    if (props.asRole === "client") {
      await createReview({
        jobId: props.job.id,
        clientId: props.job.clientId,
        tradespersonId: props.job.tradespersonId,
        rating: overall.value,
        text: text.value,
        dimensions: {
          quality: quality.value,
          punctuality: punctuality.value,
          communication: communication.value,
          value: value.value,
        },
      });
    } else {
      await createClientReview({
        jobId: props.job.id,
        clientId: props.job.clientId,
        tradespersonId: props.job.tradespersonId,
        rating: overall.value,
        text: text.value,
        categoryScores: {
          punctuality: punctuality.value,
          communication: communication.value,
          clarity: clarity.value,
          payment: payment.value,
        },
      });
    }
    useToast().success("Review submitted");
    open.value = false;
    emit("reviewed");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Button label="Leave a review" icon="pi pi-star" outlined @click="open = true" />

  <Dialog
    v-model:visible="open"
    modal
    :header="props.asRole === 'client' ? 'Review the tradesperson' : 'Review the client (private)'"
    :style="{ width: '32rem' }"
  >
    <Message v-if="error" severity="error" :closable="false" class="mb-3">{{ error }}</Message>
    <div class="space-y-3">
      <div>
        <label class="text-sm font-medium block mb-1">Overall</label>
        <Rating v-model="overall" :cancel="false" />
      </div>

      <template v-if="props.asRole === 'client'">
        <div class="grid grid-cols-2 gap-2">
          <div><label class="text-xs">Quality</label><Rating v-model="quality" :cancel="false" /></div>
          <div><label class="text-xs">Punctuality</label><Rating v-model="punctuality" :cancel="false" /></div>
          <div><label class="text-xs">Communication</label><Rating v-model="communication" :cancel="false" /></div>
          <div><label class="text-xs">Value</label><Rating v-model="value" :cancel="false" /></div>
        </div>
      </template>
      <template v-else>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="text-xs">Punctuality</label><Rating v-model="punctuality" :cancel="false" /></div>
          <div><label class="text-xs">Communication</label><Rating v-model="communication" :cancel="false" /></div>
          <div><label class="text-xs">Clarity</label><Rating v-model="clarity" :cancel="false" /></div>
          <div><label class="text-xs">Payment</label><Rating v-model="payment" :cancel="false" /></div>
        </div>
      </template>

      <div>
        <label class="text-xs font-medium">Comments</label>
        <Textarea v-model="text" rows="4" class="w-full mt-1" />
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text @click="open = false" />
      <Button label="Submit" icon="pi pi-send" :loading="submitting" @click="submit" />
    </template>
  </Dialog>
</template>

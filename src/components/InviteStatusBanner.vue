<script setup lang="ts">
// Tradesperson-only banner on a bring-your-own-client job that the client
// hasn't joined yet (clientId null). Shows the invite state; the resend /
// copy-link / revoke controls arrive with the claim-flow increment.
import type { ClientInvite } from "@/firebase/interfaces";

const props = defineProps<{
  invite: ClientInvite;
}>();

const isInvited = () => props.invite.status === "invited";
</script>

<template>
  <div class="bs-card p-4 border-l-4 border-l-[color:var(--bs-blue-light)]">
    <div class="flex items-start gap-3">
      <i
        class="pi text-[color:var(--bs-blue)] text-lg mt-0.5"
        :class="isInvited() ? 'pi-user-plus' : 'pi-user'"
      ></i>
      <div class="min-w-0 flex-1">
        <template v-if="isInvited()">
          <div class="font-semibold">Waiting for {{ invite.clientName }} to join</div>
          <p class="text-sm text-[color:var(--bs-muted)] mt-1 break-words">
            Invite created for <span class="font-medium">{{ invite.emailLower }}</span
            >. Until they join, you can run the whole job yourself — quote it, track
            time, and record payment.
          </p>
        </template>
        <template v-else>
          <div class="font-semibold">Solo job</div>
          <p class="text-sm text-[color:var(--bs-muted)] mt-1">
            The invite was revoked — you're running this one yourself. Quotes,
            time tracking and invoicing all work as usual.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

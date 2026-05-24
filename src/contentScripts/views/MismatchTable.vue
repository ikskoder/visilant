<script setup lang="ts">
import { computed } from 'vue'
import SecureText from '~/components/SecureText.vue'
import { useI18n } from '~/composables/useI18n'

const props = defineProps<{
  textDomain: string
  textDomainIsSafe: boolean
  textDomainCount: number
  destDomain: string
  destIsSafe: boolean
  destCount: number
  showVisitCount: 'always' | 'never' | 'unfamiliar' | 'familiar'
  cellPadding?: string
}>()

const emit = defineEmits<{
  (e: 'details', domain: string): void
}>()

const { t } = useI18n()

const pad = computed(() => props.cellPadding || 'p-1.5')

function shouldShowCount(isSafe: boolean) {
  switch (props.showVisitCount) {
    case 'always': return true
    case 'never': return false
    case 'unfamiliar': return !isSafe
    case 'familiar': return isSafe
    default: return true
  }
}

const statusLabel = computed(() => (isSafe: boolean, count: number) => {
  if (isSafe)
    return { text: t.value('linkTooltipFamiliar'), class: 'text-green-400' }
  if (count === 0)
    return { text: t.value('linkTooltipNeverVisited'), class: 'text-red-400' }
  return { text: t.value('linkTooltipUnfamiliar'), class: 'text-yellow-400' }
})
</script>

<template>
  <table class="w-full comparison-table">
    <thead>
      <tr>
        <th class="text-gray-500 font-normal text-left" :class="[pad]" />
        <th class="text-gray-400 font-medium text-left" :class="[pad]">
          {{ t('linkTooltipShowsDomain') }}
        </th>
        <th class="text-gray-400 font-medium text-left" :class="[pad]">
          {{ t('linkTooltipLeadsTo') }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="text-gray-500" :class="[pad]">
          {{ t('linkInterceptDomain') }}
        </td>
        <td class="text-white font-medium" :class="[pad]">
          <SecureText :text="textDomain" :force-highlight="true" :danger-only="true" />
        </td>
        <td class="text-white font-medium" :class="[pad]">
          <SecureText :text="destDomain" :force-highlight="true" :danger-only="true" />
        </td>
      </tr>
      <tr>
        <td class="text-gray-500" :class="[pad]">
          {{ t('linkInterceptStatus') }}
        </td>
        <td class="font-medium" :class="[pad, statusLabel(textDomainIsSafe, textDomainCount).class]">
          {{ statusLabel(textDomainIsSafe, textDomainCount).text }}
        </td>
        <td class="font-medium" :class="[pad, statusLabel(destIsSafe, destCount).class]">
          {{ statusLabel(destIsSafe, destCount).text }}
        </td>
      </tr>
      <tr v-if="shouldShowCount(textDomainIsSafe) || shouldShowCount(destIsSafe)">
        <td class="text-gray-500" :class="[pad]">
          {{ t('linkTooltipVisits') }}
        </td>
        <td :class="[pad, shouldShowCount(textDomainIsSafe) ? 'text-white font-medium' : 'text-gray-600 italic']">
          {{ shouldShowCount(textDomainIsSafe) ? textDomainCount : t('mismatchVisitsHidden') }}
        </td>
        <td :class="[pad, shouldShowCount(destIsSafe) ? 'text-white font-medium' : 'text-gray-600 italic']">
          {{ shouldShowCount(destIsSafe) ? destCount : t('mismatchVisitsHidden') }}
        </td>
      </tr>
      <tr>
        <td :class="pad" />
        <td :class="pad">
          <button
            class="w-full px-2 py-1 bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 rounded border border-gray-600 transition-colors text-center"
            @click="emit('details', textDomain)"
          >
            {{ t('linkTooltipDetails') }}
          </button>
        </td>
        <td :class="pad">
          <button
            class="w-full px-2 py-1 bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 rounded border border-gray-600 transition-colors text-center"
            @click="emit('details', destDomain)"
          >
            {{ t('linkTooltipDetails') }}
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
button {
  box-shadow: none !important;
  text-shadow: none !important;
  outline: none !important;
}

.comparison-table {
  border-collapse: collapse !important;
  border: 1px solid rgba(107, 114, 128, 0.5) !important;
}

.comparison-table th,
.comparison-table td {
  border: 1px solid rgba(107, 114, 128, 0.3) !important;
}
</style>

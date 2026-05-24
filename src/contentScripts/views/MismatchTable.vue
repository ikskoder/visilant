<script setup lang="ts">
import { computed, inject, ref } from 'vue'
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

const isDark = inject('isDark', ref(true))

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
        <th class="font-medium text-left" :class="[pad, isDark ? 'text-gray-400' : 'text-gray-500']">
          {{ t('linkTooltipShowsDomain') }}
        </th>
        <th class="font-medium text-left" :class="[pad, isDark ? 'text-gray-400' : 'text-gray-500']">
          {{ t('linkTooltipLeadsTo') }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td :class="[pad, isDark ? 'text-gray-500' : 'text-gray-400']">
          {{ t('linkInterceptDomain') }}
        </td>
        <td class="font-medium" :class="[pad, isDark ? 'text-white' : 'text-gray-900']">
          <SecureText :text="textDomain" :force-highlight="true" :danger-only="true" />
        </td>
        <td class="font-medium" :class="[pad, isDark ? 'text-white' : 'text-gray-900']">
          <SecureText :text="destDomain" :force-highlight="true" :danger-only="true" />
        </td>
      </tr>
      <tr>
        <td :class="[pad, isDark ? 'text-gray-500' : 'text-gray-400']">
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
        <td :class="[pad, isDark ? 'text-gray-500' : 'text-gray-400']">
          {{ t('linkTooltipVisits') }}
        </td>
        <td :class="[pad, shouldShowCount(textDomainIsSafe) ? (isDark ? 'text-white font-medium' : 'text-gray-900 font-medium') : 'text-gray-500 italic']">
          {{ shouldShowCount(textDomainIsSafe) ? textDomainCount : t('mismatchVisitsHidden') }}
        </td>
        <td :class="[pad, shouldShowCount(destIsSafe) ? (isDark ? 'text-white font-medium' : 'text-gray-900 font-medium') : 'text-gray-500 italic']">
          {{ shouldShowCount(destIsSafe) ? destCount : t('mismatchVisitsHidden') }}
        </td>
      </tr>
      <tr>
        <td :class="pad" />
        <td :class="pad">
          <button
            class="w-full px-2 py-1 rounded-lg border transition-colors text-center"
            :class="isDark ? 'bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 border-gray-600' : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300'"
            @click="emit('details', textDomain)"
          >
            {{ t('linkTooltipDetails') }}
          </button>
        </td>
        <td :class="pad">
          <button
            class="w-full px-2 py-1 rounded-lg border transition-colors text-center"
            :class="isDark ? 'bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 border-gray-600' : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300'"
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
  border: 1px solid rgba(107, 114, 128, 0.4) !important;
}

.comparison-table th,
.comparison-table td {
  border: 1px solid rgba(107, 114, 128, 0.25) !important;
}
</style>

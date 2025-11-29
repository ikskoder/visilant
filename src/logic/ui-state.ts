import { ref } from 'vue'

export const showWarning = ref(false)
export const warningType = ref<'input' | 'copy'>('input')
export const safetyLevel = ref<boolean | null>(null)
export const isIgnored = ref(false)
export const hasNotifiedOnThisPage = ref(false)

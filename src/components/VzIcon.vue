<script setup lang="ts">
import type { Component } from 'vue'
import IconArrowRight from '~icons/carbon/arrow-right'
import IconCalendar from '~icons/carbon/calendar'
import IconCheckmark from '~icons/carbon/checkmark'
import IconCheckmarkFilled from '~icons/carbon/checkmark-filled'
import IconChevronDown from '~icons/carbon/chevron-down'
import IconChevronRight from '~icons/carbon/chevron-right'
import IconCircleDash from '~icons/carbon/circle-dash'
import IconClose from '~icons/carbon/close'
import IconCopy from '~icons/carbon/copy'
import IconEmail from '~icons/carbon/email'
import IconFlagFilled from '~icons/carbon/flag-filled'
import IconHelp from '~icons/carbon/help'
import IconInformationFilled from '~icons/carbon/information-filled'
import IconLabel from '~icons/carbon/label'
import IconLaunch from '~icons/carbon/launch'
import IconLink from '~icons/carbon/link'
import IconMisuse from '~icons/carbon/misuse'
import IconNotificationOff from '~icons/carbon/notification-off'
import IconPending from '~icons/carbon/pending'
import IconQrCode from '~icons/carbon/qr-code'
import IconReset from '~icons/carbon/reset'
import IconSettings from '~icons/carbon/settings'
import IconSortAscending from '~icons/carbon/sort-ascending'
import IconSortDescending from '~icons/carbon/sort-descending'
import IconTextFont from '~icons/carbon/text-font'
import IconTime from '~icons/carbon/time'
import IconTranslate from '~icons/carbon/translate'
import IconView from '~icons/carbon/view'
import IconWarningAltFilled from '~icons/carbon/warning-alt-filled'
import { ShieldAlert, ShieldFail, ShieldFlag, ShieldInfo, ShieldPass, ShieldPending, ShieldUnknown } from './shield-icons'

const props = defineProps<{
  name: IconName
  /** Said aloud for an icon that carries a result on its own ("Passed"). Without it the icon is decoration. */
  label?: string
  large?: boolean
}>()

/**
 * Every icon the interface draws, by the name the design system gives it.
 *
 * Inline SVG in `currentColor`, never a CSS mask: the in-page surfaces are drawn
 * on pages whose content security policy may refuse a `data:` image, and an icon
 * that silently fails to appear there is a warning without its sign. The table
 * is written out import by import because a computed `~icons/...` path would not
 * survive the content script's single-file build.
 */
const ICONS = {
  'alert': IconWarningAltFilled,
  'pass': IconCheckmarkFilled,
  'fail': IconMisuse,
  'unknown': IconCircleDash,
  'info': IconInformationFilled,
  'close': IconClose,
  'chevron-right': IconChevronRight,
  'chevron-down': IconChevronDown,
  'arrow-right': IconArrowRight,
  'silenced': IconNotificationOff,
  'link': IconLink,
  'email': IconEmail,
  'qr-code': IconQrCode,
  'settings': IconSettings,
  'reset': IconReset,
  'launch': IconLaunch,
  'copy': IconCopy,
  'view': IconView,
  'case': IconTextFont,
  'script': IconTranslate,
  'frames': IconLabel,
  'time': IconTime,
  'calendar': IconCalendar,
  'sort-asc': IconSortAscending,
  'sort-desc': IconSortDescending,
  'check-mark': IconCheckmark,
  'pending': IconPending,
  'help': IconHelp,
  'shield-pass': ShieldPass,
  'shield-fail': ShieldFail,
  'shield-unknown': ShieldUnknown,
  // The sign at the head of a box drawn over a page, which is the signature
  // too. Drawn through VzSig, never beside it
  'shield-alert': ShieldAlert,
  'shield-flag': ShieldFlag,
  'shield-info': ShieldInfo,
  'shield-pending': ShieldPending,
  // A red flag, and only that: one of the few findings that are a reason to
  // stop on their own (see logic/red-flags.ts). Every other warning keeps the
  // triangle.
  'flag': IconFlagFilled,
} satisfies Record<string, Component>

export type IconName = keyof typeof ICONS
</script>

<template>
  <component
    :is="ICONS[props.name]"
    class="vz-icon"
    :class="[`vz-icon--${props.name}`, { 'vz-icon--lg': props.large }]"
    focusable="false"
    :role="props.label ? 'img' : undefined"
    :aria-label="props.label"
    :aria-hidden="props.label ? undefined : 'true'"
  />
</template>

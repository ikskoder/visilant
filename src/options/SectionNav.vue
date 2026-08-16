<script setup lang="ts">
/**
 * Contents of the settings page.
 *
 * Rendered twice – as a column beside the settings on a wide window, and as a
 * card above them on a narrow one – so it lives in its own file rather than
 * being written out twice. Which sections exist and which one is in view are
 * both decided by the page, since the page is what owns the sections.
 */
defineProps<{
  sections: { id: string, title: string }[]
  activeId: string
  heading: string
}>()

/**
 * Scroll there, rather than letting the link do it.
 *
 * Clicking a fragment link does nothing at all on an extension page – the hash
 * is never even set, though assigning `location.hash` by hand still scrolls. The
 * `href` stays for what it is worth as markup, and the scrolling is done here.
 */
function goTo(id: string) {
  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <nav :aria-label="heading">
    <div class="text-xs uppercase tracking-wider opacity-50 mb-2">
      {{ heading }}
    </div>
    <ul class="space-y-0.5">
      <li v-for="section in sections" :key="section.id">
        <!-- A real link rather than a button, so it is reached by keyboard and
             read out as navigation -->
        <a
          :href="`#section-${section.id}`"
          class="block px-2 py-1 rounded-lg text-sm transition-colors border-l-2"
          :class="activeId === section.id
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'"
          :aria-current="activeId === section.id ? 'true' : undefined"
          @click.prevent="goTo(section.id)"
        >
          {{ section.title }}
        </a>
      </li>
    </ul>
  </nav>
</template>

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
  <nav :aria-label="heading" class="section-nav">
    <span class="vz-eyebrow">{{ heading }}</span>
    <ul class="grid gap-0.5 mt-2">
      <li v-for="section in sections" :key="section.id">
        <!-- A real link rather than a button, so it is reached by keyboard and
             read out as navigation. The current section is a tinted row in the
             interface colour, not a border on a rounded box. -->
        <a
          :href="`#section-${section.id}`"
          class="section-nav__link"
          :class="{ 'section-nav__link--current': activeId === section.id }"
          :aria-current="activeId === section.id ? 'true' : undefined"
          @click.prevent="goTo(section.id)"
        >
          {{ section.title }}
        </a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.section-nav__link {
  display: block;
  padding: 6px var(--space-2);
  border-radius: var(--radius-md);
  font-size: 14px;
  line-height: 20px;
  color: var(--ink-2);
  text-decoration: none;
  transition: background-color 120ms ease;
}

.section-nav__link:hover {
  background: var(--surface-hover);
  color: var(--ink);
}

.section-nav__link--current,
.section-nav__link--current:hover {
  background: var(--brand-tint);
  color: var(--brand);
  font-weight: 600;
}
</style>

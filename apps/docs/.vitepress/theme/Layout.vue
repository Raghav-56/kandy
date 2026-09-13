<script setup lang="ts">
import DefaultTheme from "vitepress/theme"
import Backdrop from "./Backdrop.vue"
import Hero from "./Hero.vue"

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <!-- The whole hero is ours: VitePress's `hero` frontmatter is unset, so its
         own hero renders nothing and this stands in its place. -->
    <template #home-hero-before>
      <Backdrop />
      <Hero />
    </template>
  </Layout>
</template>

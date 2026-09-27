<script setup lang="ts">
import DefaultTheme from "vitepress/theme"
import Backdrop from "./Backdrop.vue"
import Hero from "./Hero.vue"

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <!-- On every page, above everything: kandy changes daily, and anyone
         arriving from a search result deserves to know that before they
         depend on it. -->
    <template #layout-top>
      <div class="k-banner">
        <strong>Extremely experimental.</strong>
        <span class="k-banner-more">kandy changes daily — expect breaking changes, rough edges, and boards you may have to wipe.</span>
        <a href="/status">What that means →</a>
      </div>
    </template>
    <!-- The whole hero is ours: VitePress's `hero` frontmatter is unset, so its
         own hero renders nothing and this stands in its place. -->
    <template #home-hero-before>
      <Backdrop />
      <Hero />
    </template>
  </Layout>
</template>

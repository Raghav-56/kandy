<script setup lang="ts">
import DefaultTheme from "vitepress/theme"
import Backdrop from "./Backdrop.vue"
import HeroBoard from "./HeroBoard.vue"

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <!-- The app's own atmosphere, behind the hero and gone by the prose. -->
    <template #home-hero-before>
      <Backdrop />
    </template>

    <!-- Beneath the hero copy, before the feature cards: the product itself. -->
    <template #home-hero-after>
      <HeroBoard />
    </template>
  </Layout>
</template>

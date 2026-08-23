<template>
  <main class="app-shell">

    <nav class="switcher">
      <a
        href="#"
        :class="{ active: mode === 'manager' }"
      >
        Manager
      </a>

      <a
        href="#phone"
        :class="{ active: mode === 'phone' }"
      >
        Telefono
      </a>
    </nav>

    <ManagerView
      v-if="mode === 'manager'"
    />

    <PhoneView
      v-else
    />

  </main>
</template>

<script setup>
import { provide } from 'vue';

import ManagerView from './components/Manager.vue';
import PhoneView from './components/Phone.vue';

import { useTournament } from './composables/useTournament';

const tournamentApp = useTournament();

provide('tournamentApp', tournamentApp);

const {
  mode
} = tournamentApp;
</script>
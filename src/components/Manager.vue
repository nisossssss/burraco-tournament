<template>
    <section class="manager-panel">
      <header class="manager-header">
        <div>
          <p class="eyebrow">
            Gestione torneo
          </p>

          <h1>
            {{ tournament.config?.tournamentName || 'Torneo Burraco' }}
          </h1>
        </div>

        <span class="phase-badge">
          {{ phaseLabel }}
        </span>
      </header>

      <!-- STATISTICHE -->
      <section class="stats-grid">
        <article class="stat-card">
          <span class="stat-label">
            Squadre connesse
          </span>

          <strong class="stat-value">
            {{ tournament.state.connectedTeams.length }}
            /
            {{ tournament.state.expectedTeams }}
          </strong>
        </article>

        <article class="stat-card">
          <span class="stat-label">
            Turno attivo
          </span>

          <strong class="stat-value">
            {{ activeRoundLabel }}
          </strong>
        </article>

        <article class="stat-card">
          <span class="stat-label">
            Partite completate
          </span>

          <strong class="stat-value">
            {{ completedMatchesCount }}
            /
            {{ tournament.state.groupMatches.length }}
          </strong>
        </article>
      </section>

      <!-- IMPOSTAZIONI -->
      <section class="manager-card">
        <div class="settings-row">
          <form
            class="settings-form"
            @submit.prevent="saveSettings"
          >
            <div class="input-group">
              <label for="expectedTeams">
                Squadre previste
              </label>

              <input
                id="expectedTeams"
                v-model.number="expectedTeams"
                type="number"
                min="2"
                required
              />
            </div>

            <button
              class="button primary"
              type="submit"
            >
              Salva
            </button>
          </form>

          <button
            class="button danger"
            type="button"
            @click="resetTournament"
          >
            Reset torneo
          </button>
        </div>

        <button
          class="button generate"
          type="button"
          @click="generateGroupMatches"
        >
          Sorteggia partite gironi
        </button>
      </section>

      <!-- CONTROLLO TURNI -->
      <section
        v-if="roundNumbers.length"
        class="manager-card"
      >
        <div class="section-heading">
          <div>
            <p class="eyebrow">
              Controllo turni
            </p>

            <h2>
              Fase a gironi
            </h2>
          </div>

          <p>
            Avviando un turno, ogni squadra riceve automaticamente
            sul proprio telefono la partita da giocare.
          </p>
        </div>

        <div class="round-buttons">
          <button
            v-for="round in roundNumbers"
            :key="round"
            type="button"
            class="round-button"
            :class="{
              active: tournament.state.activeGroupRound === round,
              completed: isRoundComplete(round)
            }"
            @click="startRound(round)"
          >
            <strong>
              Turno {{ round }}
            </strong>

            <span v-if="isRoundComplete(round)">
              Completato
            </span>

            <span
              v-else-if="
                tournament.state.activeGroupRound === round
              "
            >
              In corso
            </span>

            <span v-else>
              Avvia
            </span>
          </button>
        </div>
      </section>

      <!-- SQUADRE CONNESSE -->
      <section class="manager-card">
        <h2>
          Squadre connesse
        </h2>

        <div class="connected-teams">
          <span
            v-for="team in tournament.state.connectedTeams"
            :key="team.id"
            class="team-chip"
          >
            <span class="online-dot"></span>

            {{ team.name }}
          </span>

          <p
            v-if="!tournament.state.connectedTeams.length"
            class="muted"
          >
            Nessuna squadra connessa.
          </p>
        </div>
      </section>

      <!-- TORNEO -->
      <section
        v-if="
          tournament.state.groups?.G1?.length ||
          tournament.state.groups?.G2?.length
        "
        class="tournament-layout"
      >
        <!-- CLASSIFICA G1 -->
        <aside class="standings-card">
          <div class="standings-header">
            <h2>
              Girone 1
            </h2>

            <span>
              Classifica
            </span>
          </div>

          <div
            v-for="(team, index) in computedStandings.G1"
            :key="team.name"
            class="standing-row"
          >
            <span class="standing-position">
              {{ index + 1 }}
            </span>

            <div class="standing-team">
              <strong>
                {{ team.name }}
              </strong>

              <small>
                Diff. {{ signedNumber(team.difference) }}
              </small>
            </div>

            <strong class="standing-points">
              {{ team.points }}
            </strong>
          </div>
        </aside>

        <!-- PARTITE -->
        <section class="matches-area">
          <header class="matches-header">
            <div>
              <p class="eyebrow">
                Calendario
              </p>

              <h2>
                Partite gironi
              </h2>
            </div>
          </header>

          <div class="groups-grid">
            <!-- G1 -->
            <div class="group-column">
              <h3>
                Girone 1
              </h3>

              <section
                v-for="round in groupedMatchesByGroup.G1"
                :key="`G1-${round.round}`"
                class="round-card"
                :class="{
                  active:
                    tournament.state.activeGroupRound === round.round
                }"
              >
                <header class="round-header">
                  <strong>
                    Turno {{ round.round }}
                  </strong>

                  <span
                    v-if="
                      tournament.state.activeGroupRound === round.round
                    "
                    class="live-label"
                  >
                    IN CORSO
                  </span>

                  <span
                    v-else-if="isRoundCompleteForGroup('G1', round.round)"
                    class="completed-label"
                  >
                    COMPLETO
                  </span>
                </header>

                <article
                  v-for="match in round.matches"
                  :key="match.id"
                  class="match-row"
                  :class="{
                    completed: match.played
                  }"
                >
                  <div class="match-main">
                    <div class="match-team-row">
                      <strong>
                        {{ match.home }}
                      </strong>

                      <span class="match-score">
                        {{ formatScore(match.scoreHome) }}
                      </span>
                    </div>

                    <div class="match-team-row">
                      <strong>
                        {{ match.away }}
                      </strong>

                      <span class="match-score">
                        {{ formatScore(match.scoreAway) }}
                      </span>
                    </div>
                  </div>

                  <div class="match-footer">
                    <span
                      class="match-status"
                      :class="matchStatusClass(match)"
                    >
                      {{ matchStatusLabel(match) }}
                    </span>

                    <button
                      class="edit-button"
                      type="button"
                      @click="beginManagerEdit(match)"
                    >
                      {{
                        match.played
                          ? 'Correggi'
                          : 'Inserisci / correggi'
                      }}
                    </button>
                  </div>

                  <!-- MODIFICA MANAGER -->
                  <div
                    v-if="editingMatchId === match.id"
                    class="manager-score-editor"
                  >
                    <label>
                      {{ match.home }}

                      <input
                        v-model="
                          managerScoreDrafts[match.id].home
                        "
                        type="number"
                        step="1"
                      />
                    </label>

                    <label>
                      {{ match.away }}

                      <input
                        v-model="
                          managerScoreDrafts[match.id].away
                        "
                        type="number"
                        step="1"
                      />
                    </label>

                    <div class="editor-buttons">
                      <button
                        class="small-button save"
                        type="button"
                        @click="saveManagerScore(match)"
                      >
                        Salva
                      </button>

                      <button
                        class="small-button"
                        type="button"
                        @click="cancelManagerEdit"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>

                  <small
                    v-if="match.managerEditedAt"
                    class="manager-edited"
                  >
                    Risultato corretto dal manager
                  </small>
                </article>
              </section>
            </div>

            <!-- G2 -->
            <div class="group-column">
              <h3>
                Girone 2
              </h3>

              <section
                v-for="round in groupedMatchesByGroup.G2"
                :key="`G2-${round.round}`"
                class="round-card"
                :class="{
                  active:
                    tournament.state.activeGroupRound === round.round
                }"
              >
                <header class="round-header">
                  <strong>
                    Turno {{ round.round }}
                  </strong>

                  <span
                    v-if="
                      tournament.state.activeGroupRound === round.round
                    "
                    class="live-label"
                  >
                    IN CORSO
                  </span>

                  <span
                    v-else-if="isRoundCompleteForGroup('G2', round.round)"
                    class="completed-label"
                  >
                    COMPLETO
                  </span>
                </header>

                <article
                  v-for="match in round.matches"
                  :key="match.id"
                  class="match-row"
                  :class="{
                    completed: match.played
                  }"
                >
                  <div class="match-main">
                    <div class="match-team-row">
                      <strong>
                        {{ match.home }}
                      </strong>

                      <span class="match-score">
                        {{ formatScore(match.scoreHome) }}
                      </span>
                    </div>

                    <div class="match-team-row">
                      <strong>
                        {{ match.away }}
                      </strong>

                      <span class="match-score">
                        {{ formatScore(match.scoreAway) }}
                      </span>
                    </div>
                  </div>

                  <div class="match-footer">
                    <span
                      class="match-status"
                      :class="matchStatusClass(match)"
                    >
                      {{ matchStatusLabel(match) }}
                    </span>

                    <button
                      class="edit-button"
                      type="button"
                      @click="beginManagerEdit(match)"
                    >
                      {{
                        match.played
                          ? 'Correggi'
                          : 'Inserisci / correggi'
                      }}
                    </button>
                  </div>

                  <div
                    v-if="editingMatchId === match.id"
                    class="manager-score-editor"
                  >
                    <label>
                      {{ match.home }}

                      <input
                        v-model="
                          managerScoreDrafts[match.id].home
                        "
                        type="number"
                        step="1"
                      />
                    </label>

                    <label>
                      {{ match.away }}

                      <input
                        v-model="
                          managerScoreDrafts[match.id].away
                        "
                        type="number"
                        step="1"
                      />
                    </label>

                    <div class="editor-buttons">
                      <button
                        class="small-button save"
                        type="button"
                        @click="saveManagerScore(match)"
                      >
                        Salva
                      </button>

                      <button
                        class="small-button"
                        type="button"
                        @click="cancelManagerEdit"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>

                  <small
                    v-if="match.managerEditedAt"
                    class="manager-edited"
                  >
                    Risultato corretto dal manager
                  </small>
                </article>
              </section>
            </div>
          </div>
        </section>

        <!-- CLASSIFICA G2 -->
        <aside class="standings-card">
          <div class="standings-header">
            <h2>
              Girone 2
            </h2>

            <span>
              Classifica
            </span>
          </div>

          <div
            v-for="(team, index) in computedStandings.G2"
            :key="team.name"
            class="standing-row"
          >
            <span class="standing-position">
              {{ index + 1 }}
            </span>

            <div class="standing-team">
              <strong>
                {{ team.name }}
              </strong>

              <small>
                Diff. {{ signedNumber(team.difference) }}
              </small>
            </div>

            <strong class="standing-points">
              {{ team.points }}
            </strong>
          </div>
        </aside>
      </section>
    </section>
</template>

<script setup>
import { inject } from 'vue';

const app = inject('tournamentApp');

const {
  tournament,
  expectedTeams,

  phaseLabel,
  activeRoundLabel,
  completedMatchesCount,

  roundNumbers,
  computedStandings,
  groupedMatchesByGroup,

  editingMatchId,
  managerScoreDrafts,

  saveSettings,
  generateGroupMatches,
  startRound,
  resetTournament,

  isRoundComplete,
  isRoundCompleteForGroup,

  beginManagerEdit,
  cancelManagerEdit,
  saveManagerScore,

  formatScore,
  signedNumber,

  matchStatusLabel,
  matchStatusClass
} = app;
</script>
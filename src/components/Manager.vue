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

    <!-- RESET -->
    <div
      v-if="resetModalOpen"
      class="modal-backdrop"
      @click.self="closeResetModal"
    >
      <div class="modal-card">
        <p class="eyebrow">
          Reset torneo
        </p>

        <h2>
          Resettare il torneo?
        </h2>

        <p>
          Verranno cancellati sorteggio, calendario,
          risultati e stato corrente del torneo.
        </p>

        <div class="modal-actions">
          <button
            class="button"
            type="button"
            @click="closeResetModal"
          >
            Annulla
          </button>

          <button
            class="button danger"
            type="button"
            @click="confirmResetTournament"
          >
            Reset torneo
          </button>
        </div>
      </div>
    </div>

    <!-- CONFERMA SORTEGGIO -->
    <div
      v-if="drawModalOpen"
      class="modal-backdrop"
      @click.self="closeDrawModal"
    >
      <div class="modal-card">
        <p class="eyebrow">
          Sorteggio gironi
        </p>

        <h2>
          Iniziare il sorteggio?
        </h2>

        <p>
          Le 12 squadre configurate verranno mescolate
          casualmente e divise in due gironi da 6.
        </p>

        <p>
          Dopo la generazione, per effettuare un nuovo
          sorteggio sarà necessario resettare il torneo.
        </p>

        <div class="modal-actions">
          <button
            class="button"
            type="button"
            @click="closeDrawModal"
          >
            Annulla
          </button>

          <button
            class="button primary"
            type="button"
            @click="confirmGenerateGroupMatches"
          >
            Sorteggia
          </button>
        </div>
      </div>
    </div>

    <!-- CONFERMA AVVIO PARTITA -->
    <div
      v-if="matchStartModalOpen"
      class="modal-backdrop"
      @click.self="closeMatchStartModal"
    >
      <div class="modal-card">
        <p class="eyebrow">
          Avvio partita
        </p>

        <h2>
          Iniziare questa partita?
        </h2>

        <p v-if="pendingMatchStart">
          <strong>{{ pendingMatchStart.home }}</strong>
          contro
          <strong>{{ pendingMatchStart.away }}</strong>.
        </p>

        <p>
          La partita diventerà immediatamente disponibile
          sui telefoni delle due squadre.
        </p>

        <div class="modal-actions">
          <button
            class="button"
            type="button"
            @click="closeMatchStartModal"
          >
            Annulla
          </button>

          <button
            class="button primary"
            type="button"
            @click="confirmStartMatch"
          >
            Gioca
          </button>
        </div>
      </div>
    </div>

    <!-- CONFERMA ANNULLAMENTO PARTITA -->
    <div
      v-if="matchCancelModalOpen"
      class="modal-backdrop"
      @click.self="closeMatchCancelModal"
    >
      <div class="modal-card">
        <p class="eyebrow">
          Annulla partita
        </p>

        <h2>
          Annullare questa partita?
        </h2>

        <p v-if="pendingMatchCancel">
          <strong>{{ pendingMatchCancel.home }}</strong>
          contro
          <strong>{{ pendingMatchCancel.away }}</strong>.
        </p>

        <p>
          La partita tornerà "Da giocare". Verranno azzerati
          eventuali punteggi già inviati e lo stato di fine partita.
          Al prossimo avvio, anche il conteggio locale delle mani
          ripartirà da zero sui telefoni.
        </p>

        <div class="modal-actions">
          <button
            class="button"
            type="button"
            @click="closeMatchCancelModal"
          >
            Torna indietro
          </button>

          <button
            class="button danger"
            type="button"
            @click="confirmCancelMatch"
          >
            Annulla e resetta
          </button>
        </div>
      </div>
    </div>

    <!-- AVVISI -->
    <div
      v-if="noticeModalOpen"
      class="modal-backdrop"
      @click.self="closeNoticeModal"
    >
      <div class="modal-card">
        <p class="eyebrow">
          Avviso
        </p>

        <h2>
          {{ noticeModalTitle }}
        </h2>

        <p>
          {{ noticeModalMessage }}
        </p>

        <div class="modal-actions">
          <button
            class="button primary"
            type="button"
            @click="closeNoticeModal"
          >
            OK
          </button>
        </div>
      </div>
    </div>

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
          Partite in corso
        </span>

        <strong class="stat-value">
          {{ activeMatchesCount }}
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
          @click="openResetModal"
        >
          Reset torneo
        </button>
      </div>

      <button
        class="button generate"
        type="button"
        @click="generateGroupMatches"
      >
        Sorteggia gironi e genera calendario
      </button>
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
            {{ standingsFinalized ? 'Classifica definitiva' : 'Classifica provvisoria' }}
          </span>
        </div>

        <div
          v-for="(team, index) in computedStandings.G1"
          :key="team.name"
          class="standing-row"
          :class="{
            qualified: index < 4,
            eliminated: index >= 4,
            'qualification-cut': index === 3
          }"
        >
          <span class="standing-position">
            {{ index + 1 }}
          </span>

          <div class="standing-avatar">
            <img
              v-if="teamImage(team.name)"
              :src="teamImage(team.name)"
              :alt="`Logo ${team.name}`"
            />

            <span v-else>
              {{ teamInitial(team.name) }}
            </span>
          </div>

          <div class="standing-team">
            <div class="standing-team-line">
              <strong>
                {{ team.name }}
              </strong>

              <span
                class="standing-outcome"
                :class="index < 4 ? 'qualified' : 'eliminated'"
              >
                {{ index < 4 ? 'Qualifica' : 'Eliminata' }}
              </span>
            </div>

            <small>
              Diff. {{ signedNumber(team.difference) }}
              · {{ team.wins }}V / {{ team.losses }}P
            </small>

            <small
              v-if="standingsFinalized && team.decidedBy === 'draw_lots'"
              class="standing-tiebreak-note"
            >
              Posizione definita tramite sorteggio
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

            <p class="muted">
              Le partite possono essere avviate in qualsiasi ordine.
              Una squadra non può giocare due partite contemporaneamente.
            </p>
          </div>
        </header>

        <div class="groups-grid">
          <!-- G1 -->
          <div class="group-column">
            <h3>
              Girone 1
            </h3>

            <article
              v-for="match in matchesByGroup.G1"
              :key="match.id"
              class="match-row"
              :class="{
                completed: match.played
              }"
            >
              <div class="match-card-header">
                <span
                  class="match-status"
                  :class="matchStatusClass(match)"
                >
                  {{ matchStatusLabel(match) }}
                </span>

                <div class="match-top-actions">
                  <button
                    v-if="!match.played && match.status !== 'active'"
                    class="play-button"
                    type="button"
                    @click="startMatch(match)"
                  >
                    Gioca
                  </button>

                  <button
                    v-else-if="match.status === 'active'"
                    class="cancel-match-button"
                    type="button"
                    @click="cancelMatch(match)"
                  >
                    Annulla partita
                  </button>
                </div>
              </div>

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
                    v-model="managerScoreDrafts[match.id].home"
                    type="number"
                    step="1"
                  />
                </label>

                <label>
                  {{ match.away }}

                  <input
                    v-model="managerScoreDrafts[match.id].away"
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
          </div>

          <!-- G2 -->
          <div class="group-column">
            <h3>
              Girone 2
            </h3>

            <article
              v-for="match in matchesByGroup.G2"
              :key="match.id"
              class="match-row"
              :class="{
                completed: match.played
              }"
            >
              <div class="match-card-header">
                <span
                  class="match-status"
                  :class="matchStatusClass(match)"
                >
                  {{ matchStatusLabel(match) }}
                </span>

                <div class="match-top-actions">
                  <button
                    v-if="!match.played && match.status !== 'active'"
                    class="play-button"
                    type="button"
                    @click="startMatch(match)"
                  >
                    Gioca
                  </button>

                  <button
                    v-else-if="match.status === 'active'"
                    class="cancel-match-button"
                    type="button"
                    @click="cancelMatch(match)"
                  >
                    Annulla partita
                  </button>
                </div>
              </div>

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
                    v-model="managerScoreDrafts[match.id].home"
                    type="number"
                    step="1"
                  />
                </label>

                <label>
                  {{ match.away }}

                  <input
                    v-model="managerScoreDrafts[match.id].away"
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
            {{ standingsFinalized ? 'Classifica definitiva' : 'Classifica provvisoria' }}
          </span>
        </div>

        <div
          v-for="(team, index) in computedStandings.G2"
          :key="team.name"
          class="standing-row"
          :class="{
            qualified: index < 4,
            eliminated: index >= 4,
            'qualification-cut': index === 3
          }"
        >
          <span class="standing-position">
            {{ index + 1 }}
          </span>

          <div class="standing-avatar">
            <img
              v-if="teamImage(team.name)"
              :src="teamImage(team.name)"
              :alt="`Logo ${team.name}`"
            />

            <span v-else>
              {{ teamInitial(team.name) }}
            </span>
          </div>

          <div class="standing-team">
            <div class="standing-team-line">
              <strong>
                {{ team.name }}
              </strong>

              <span
                class="standing-outcome"
                :class="index < 4 ? 'qualified' : 'eliminated'"
              >
                {{ index < 4 ? 'Qualifica' : 'Eliminata' }}
              </span>
            </div>

            <small>
              Diff. {{ signedNumber(team.difference) }}
              · {{ team.wins }}V / {{ team.losses }}P
            </small>

            <small
              v-if="standingsFinalized && team.decidedBy === 'draw_lots'"
              class="standing-tiebreak-note"
            >
              Posizione definita tramite sorteggio
            </small>
          </div>

          <strong class="standing-points">
            {{ team.points }}
          </strong>
        </div>
      </aside>
    </section>

    <!-- QUARTI DI FINALE -->
    <section
      v-if="quarterFinalMatches.length"
      class="knockout-section"
    >
      <header class="knockout-header">
        <div>
          <p class="eyebrow">
            Fase a eliminazione diretta
          </p>

          <h2>
            Quarti di finale
          </h2>

          <p>
            Le prime quattro di ogni girone sono qualificate.
            Gli accoppiamenti incrociano le posizioni dei due gironi.
          </p>
        </div>

        <span class="knockout-badge">
          8 squadre
        </span>
      </header>

      <div class="quarterfinal-grid">
        <article
          v-for="match in quarterFinalMatches"
          :key="match.id"
          class="quarterfinal-card"
          :class="{
            active: match.status === 'active',
            completed: match.played
          }"
        >
          <div class="quarterfinal-topline">
            <div>
              <span class="quarterfinal-slot">
                {{ match.slot }}
              </span>

              <small>
                {{ match.sourceHome }} vs {{ match.sourceAway }}
              </small>
            </div>

            <div class="match-top-actions">
              <button
                v-if="!match.played && match.status !== 'active'"
                class="play-button"
                type="button"
                @click="startMatch(match)"
              >
                Gioca
              </button>

              <button
                v-else-if="match.status === 'active'"
                class="cancel-match-button"
                type="button"
                @click="cancelMatch(match)"
              >
                Annulla partita
              </button>
            </div>
          </div>

          <div class="quarterfinal-teams">
            <div class="quarterfinal-team">
              <div class="quarterfinal-team-identity">
                <div class="team-avatar small">
                  <img
                    v-if="teamImage(match.home)"
                    :src="teamImage(match.home)"
                    :alt="`Logo ${match.home}`"
                  />
                  <span v-else>{{ teamInitial(match.home) }}</span>
                </div>

                <div>
                  <span>
                    {{ match.sourceHome }}
                  </span>
                  <strong>
                    {{ match.home }}
                  </strong>
                </div>
              </div>

              <strong class="quarterfinal-score">
                {{ formatScore(match.scoreHome) }}
              </strong>
            </div>

            <div class="quarterfinal-team">
              <div class="quarterfinal-team-identity">
                <div class="team-avatar small">
                  <img
                    v-if="teamImage(match.away)"
                    :src="teamImage(match.away)"
                    :alt="`Logo ${match.away}`"
                  />
                  <span v-else>{{ teamInitial(match.away) }}</span>
                </div>

                <div>
                  <span>
                    {{ match.sourceAway }}
                  </span>
                  <strong>
                    {{ match.away }}
                  </strong>
                </div>
              </div>

              <strong class="quarterfinal-score">
                {{ formatScore(match.scoreAway) }}
              </strong>
            </div>
          </div>

          <div class="quarterfinal-footer">
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
              {{ match.played ? 'Correggi' : 'Inserisci / correggi' }}
            </button>
          </div>

          <div
            v-if="editingMatchId === match.id"
            class="manager-score-editor"
          >
            <label>
              {{ match.home }}

              <input
                v-model="managerScoreDrafts[match.id].home"
                type="number"
                step="1"
              />
            </label>

            <label>
              {{ match.away }}

              <input
                v-model="managerScoreDrafts[match.id].away"
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
        </article>
      </div>
    </section>
  </section>
</template>

<script setup>
import { inject } from 'vue';

const app = inject('tournamentApp');

if (!app) {
  throw new Error(
    'Tournament context non disponibile'
  );
}

const {
  tournament,
  expectedTeams,

  phaseLabel,
  activeMatchesCount,
  completedMatchesCount,

  computedStandings,
  standingsFinalized,
  quarterFinalMatches,
  matchesByGroup,

  editingMatchId,
  managerScoreDrafts,

  saveSettings,

  generateGroupMatches,
  drawModalOpen,
  closeDrawModal,
  confirmGenerateGroupMatches,

  startMatch,
  matchStartModalOpen,
  pendingMatchStart,
  closeMatchStartModal,
  confirmStartMatch,

  cancelMatch,
  matchCancelModalOpen,
  pendingMatchCancel,
  closeMatchCancelModal,
  confirmCancelMatch,

  noticeModalOpen,
  noticeModalTitle,
  noticeModalMessage,
  closeNoticeModal,

  resetModalOpen,
  openResetModal,
  closeResetModal,
  confirmResetTournament,

  beginManagerEdit,
  cancelManagerEdit,
  saveManagerScore,

  teamImage,
  teamInitial,
  formatScore,
  signedNumber,

  matchStatusLabel,
  matchStatusClass
} = app;
</script>

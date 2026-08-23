<template>
  <section class="phone-page">
    <div class="phone-card">

      <!-- LOGIN -->
      <template v-if="!isPhoneConnected">
        <header class="phone-login-header">
          <div class="logo-circle">♣</div>
          <p class="eyebrow">Torneo Burraco</p>
          <h1>Entra al torneo</h1>
          <p>
            Inserisci il nome della tua squadra
            e il codice ricevuto dal manager.
          </p>
        </header>

        <form
          class="phone-form"
          @submit.prevent="joinTeam"
        >
          <label>
            Squadra
            <input
              v-model="teamName"
              type="text"
              maxlength="40"
              placeholder="Es. Squadra 4"
              autocomplete="off"
              required
            />
          </label>

          <label v-if="needsTeamCode">
            Codice
            <input
              v-model="teamCode"
              type="text"
              maxlength="20"
              placeholder="Es. A4"
              autocomplete="off"
              required
            />
          </label>

          <button
            class="button primary phone-main-button"
            type="submit"
          >
            Entra nel torneo
          </button>
        </form>

        <p
          class="phone-status"
          :class="{ error: phoneHasError }"
        >
          {{ statusMessage }}
        </p>
      </template>

      <!-- SQUADRA CONNESSA -->
      <template v-else>
        <header class="phone-team-header">
          <div>
            <p class="eyebrow">Squadra</p>
            <h1>{{ joinedTeamName }}</h1>
          </div>

          <button
            class="logout-button"
            type="button"
            @click="disconnectTeam"
          >
            Esci
          </button>
        </header>

        <!-- CALENDARIO NON GENERATO -->
        <section
          v-if="!tournament.state.groupMatches.length"
          class="phone-state waiting"
        >
          <div class="state-icon">⏳</div>
          <h2>In attesa</h2>
          <p>
            Il manager deve ancora effettuare
            il sorteggio e generare il calendario.
          </p>
        </section>

        <!-- NESSUN TURNO ATTIVO -->
        <section
          v-else-if="!tournament.state.activeGroupRound"
          class="phone-state waiting"
        >
          <div class="state-icon">✓</div>
          <h2>Calendario pronto</h2>
          <p>
            Attendi che il manager avvii il turno.
          </p>

          <div
            v-if="nextScheduledMatch"
            class="next-match"
          >
            <span>Prossima partita</span>
            <strong>
              vs {{ opponentFor(nextScheduledMatch) }}
            </strong>
          </div>
        </section>

        <!-- PARTITA ATTIVA -->
        <section
          v-else-if="currentTeamMatch"
          class="active-phone-match"
        >
          <header class="phone-match-header">
            <span>
              Turno {{ currentTeamMatch.round }}
            </span>

            <span
              class="phone-match-status"
              :class="matchStatusClass(currentTeamMatch)"
            >
              {{ matchStatusLabel(currentTeamMatch) }}
            </span>
          </header>

          <div class="phone-versus">
            <div class="phone-team mine">
              <span>Tu</span>
              <strong>{{ joinedTeamName }}</strong>
            </div>

            <div class="vs">VS</div>

            <div class="phone-team">
              <span>Avversario</span>
              <strong>
                {{ opponentFor(currentTeamMatch) }}
              </strong>
            </div>
          </div>

          <!-- NON HO ANCORA INVIATO -->
          <template
            v-if="myScore(currentTeamMatch) === null"
          >
            <section class="score-method">
              <p class="eyebrow">Segnapunti</p>
              <h2>Come vuoi segnare i punti?</h2>

              <div class="score-method-tabs">
                <button
                  type="button"
                  :class="{
                    active: scoreEntryMode === 'hands'
                  }"
                  @click="setScoreEntryMode('hands')"
                >
                  Conta le mani
                </button>

                <button
                  type="button"
                  :class="{
                    active: scoreEntryMode === 'manual'
                  }"
                  @click="setScoreEntryMode('manual')"
                >
                  Inserisci totale
                </button>
              </div>
            </section>

            <!-- CONTEGGIO MANI -->
            <section
              v-if="scoreEntryMode === 'hands'"
              class="hands-counter"
            >
              <div class="hands-total-card">
                <span>Totale partita</span>
                <strong>{{ formatScore(handTotal) }}</strong>
                <small>
                  / {{ formatScore(groupTargetScore) }} punti
                </small>

                <div class="score-progress-track">
                  <div
                    class="score-progress-fill"
                    :style="{
                      width: `${scoreProgress}%`
                    }"
                  ></div>
                </div>
              </div>

              <!-- STATO FINE PARTITA -->
              <div
                v-if="targetReached"
                class="target-message success"
              >
                ✓ Obiettivo raggiunto. La partita è conclusa.
              </div>

              <div
                v-else-if="
                  matchFinishTriggered &&
                  finishHandCount !== null
                "
                class="target-message"
              >
                <template
                  v-if="handScores.length < finishHandCount"
                >
                  L'avversario ha raggiunto l'obiettivo.
                  Completa il conteggio della Mano
                  {{ finishHandCount }}.
                </template>

                <template
                  v-else-if="handScores.length === finishHandCount"
                >
                  ✓ Partita conclusa. Hai registrato anche tu
                  la Mano {{ finishHandCount }}: puoi inviare
                  il tuo totale.
                </template>

                <template v-else>
                  La partita è terminata alla Mano
                  {{ finishHandCount }}, ma nel tuo conteggio
                  risultano {{ handScores.length }} mani.
                  Elimina le mani successive prima di inviare.
                </template>
              </div>

              <div
                v-else-if="opponentHasSubmitted"
                class="target-message"
              >
                L'avversario ha già inviato il risultato finale.
                Puoi inviare anche il tuo totale.
              </div>

              <!-- STORICO MANI -->
              <div
                v-if="handScores.length"
                class="hands-list"
              >
                <article
                  v-for="(hand, index) in handScores"
                  :key="hand.id"
                  class="hand-row"
                >
                  <div class="hand-info">
                    <span>Mano {{ index + 1 }}</span>

                    <strong
                      :class="{
                        negative: hand.total < 0
                      }"
                    >
                      {{ hand.total > 0 ? '+' : '' }}
                      {{ formatScore(hand.total) }}
                    </strong>

                    <small class="hand-summary">
                      Base {{ formatScore(hand.basePoints) }}
                      · Tavolo +{{ formatScore(hand.tablePoints) }}
                      · Mano -{{ formatScore(hand.handPoints) }}

                      <template v-if="hand.pozzettoPenalty">
                        · Pozzetto -{{ formatScore(hand.pozzettoPenalty) }}
                      </template>
                    </small>
                  </div>

                  <div
                    v-if="pendingDeleteHandId !== hand.id"
                    class="hand-actions"
                  >
                    <button
                      type="button"
                      @click="startEditHand(hand)"
                    >
                      Modifica
                    </button>

                    <button
                      type="button"
                      class="delete"
                      @click="requestDeleteHand(hand.id)"
                    >
                      Elimina
                    </button>
                  </div>

                  <div
                    v-else
                    class="hand-delete-confirm"
                  >
                    <span>Eliminare?</span>

                    <button
                      type="button"
                      @click="cancelDeleteHand"
                    >
                      No
                    </button>

                    <button
                      type="button"
                      class="danger"
                      @click="confirmDeleteHand(hand.id)"
                    >
                      Sì
                    </button>
                  </div>
                </article>
              </div>

              <!-- EDITOR MANO -->
              <section
                v-if="!handEntryLocked || editingHandId"
                class="hand-editor-card"
              >
                <header class="hand-editor-header">
                  <div>
                    <p class="eyebrow">
                      {{ editingHandId ? 'Modifica' : 'Mano corrente' }}
                    </p>

                    <h3>
                      {{
                        editingHandId
                          ? 'Modifica mano'
                          : `Mano ${handScores.length + 1}`
                      }}
                    </h3>
                  </div>

                  <strong
                    class="current-hand-total"
                    :class="{
                      negative: currentHandTotal < 0
                    }"
                  >
                    {{ currentHandTotal > 0 ? '+' : '' }}
                    {{ formatScore(currentHandTotal) }}
                  </strong>
                </header>

                <!-- BASE -->
                <label class="hand-field">
                  <div class="hand-field-heading">
                    <span>Base / bonus</span>
                    <small>+</small>
                  </div>

                  <input
                    v-model.number="handDraft.basePoints"
                    type="number"
                    min="0"
                    step="1"
                    inputmode="numeric"
                    placeholder="0"
                  />

                  <small>
                    Bonus della mano: burraco, chiusura, ecc.
                  </small>
                </label>

                <!-- TAVOLO -->
                <label class="hand-field">
                  <div class="hand-field-heading">
                    <span>Punti sul tavolo</span>
                    <small class="positive-label">+</small>
                  </div>

                  <input
                    v-model.number="handDraft.tablePoints"
                    type="number"
                    min="0"
                    step="1"
                    inputmode="numeric"
                    placeholder="0"
                  />

                  <small>
                    Valore delle carte calate dalla squadra.
                  </small>
                </label>

                <!-- IN MANO -->
                <label class="hand-field">
                  <div class="hand-field-heading">
                    <span>Punti rimasti in mano</span>
                    <small class="negative-label">−</small>
                  </div>

                  <input
                    v-model.number="handDraft.handPoints"
                    type="number"
                    min="0"
                    step="1"
                    inputmode="numeric"
                    placeholder="0"
                  />

                  <small>
                    Comprende anche le carte del pozzetto
                    preso ma non giocato.
                  </small>
                </label>

                <!-- POZZETTO -->
                <div class="pozzetto-section">
                  <div class="hand-field-heading">
                    <span>Pozzetto</span>
                  </div>

                  <div class="pozzetto-options">
                    <button
                      type="button"
                      :class="{
                        active:
                          handDraft.pozzettoStatus === 'taken'
                      }"
                      @click="handDraft.pozzettoStatus = 'taken'"
                    >
                      <strong>Preso</strong>
                      <small>Nessuna penalità</small>
                    </button>

                    <button
                      type="button"
                      :class="{
                        active:
                          handDraft.pozzettoStatus === 'not_taken'
                      }"
                      @click="handDraft.pozzettoStatus = 'not_taken'"
                    >
                      <strong>Non preso</strong>
                      <small>−100</small>
                    </button>
                  </div>
                </div>

                <!-- RIEPILOGO -->
                <div class="hand-breakdown">
                  <div>
                    <span>Base / bonus</span>
                    <strong>
                      +{{ formatScore(Number(handDraft.basePoints) || 0) }}
                    </strong>
                  </div>

                  <div>
                    <span>Tavolo</span>
                    <strong>
                      +{{ formatScore(Number(handDraft.tablePoints) || 0) }}
                    </strong>
                  </div>

                  <div>
                    <span>Mano</span>
                    <strong class="negative">
                      −{{ formatScore(Number(handDraft.handPoints) || 0) }}
                    </strong>
                  </div>

                  <div v-if="currentPozzettoPenalty">
                    <span>Pozzetto</span>
                    <strong class="negative">
                      −{{ formatScore(currentPozzettoPenalty) }}
                    </strong>
                  </div>

                  <div class="hand-breakdown-total">
                    <span>Totale mano</span>
                    <strong
                      :class="{
                        negative: currentHandTotal < 0
                      }"
                    >
                      {{ currentHandTotal > 0 ? '+' : '' }}
                      {{ formatScore(currentHandTotal) }}
                    </strong>
                  </div>
                </div>

                <div class="hand-editor-actions">
                  <button
                    v-if="editingHandId"
                    class="button"
                    type="button"
                    @click="cancelEditHand"
                  >
                    Annulla
                  </button>

                  <button
                    class="button primary"
                    type="button"
                    @click="saveCurrentHand"
                  >
                    {{
                      editingHandId
                        ? 'Salva modifiche'
                        : 'Aggiungi mano'
                    }}
                  </button>
                </div>
              </section>

              <!-- AZZERA -->
              <div
                v-if="handScores.length"
                class="hands-bottom-actions"
              >
                <button
                  v-if="!clearHandsConfirmOpen"
                  class="clear-hands-button"
                  type="button"
                  @click="requestClearHands"
                >
                  Azzera conteggio
                </button>

                <div
                  v-else
                  class="clear-confirm-box"
                >
                  <span>
                    Cancellare tutte le mani?
                  </span>

                  <div>
                    <button
                      type="button"
                      @click="cancelClearHands"
                    >
                      Annulla
                    </button>

                    <button
                      type="button"
                      class="danger"
                      @click="confirmClearHands"
                    >
                      Azzera
                    </button>
                  </div>
                </div>
              </div>

              <!-- INVIO FINALE -->
              <section
                v-if="canSubmitHandTotal"
                class="finish-match-card"
              >
                <span>Risultato finale</span>

                <strong>
                  {{ formatScore(handTotal) }}
                </strong>

                <p v-if="targetReached">
                  Hai raggiunto o superato
                  {{ formatScore(groupTargetScore) }} punti.
                </p>

                <p
                  v-else-if="finishHandCount !== null"
                >
                  L'altra squadra ha raggiunto l'obiettivo
                  alla Mano {{ finishHandCount }}.
                  Avete registrato lo stesso numero di mani.
                </p>

                <p v-else>
                  L'avversario ha già concluso la partita.
                </p>

                <button
                  class="button primary phone-main-button"
                  type="button"
                  @click="submitHandTotal"
                >
                  Invia {{ formatScore(handTotal) }} punti
                </button>
              </section>

              <!-- PARTITA ANCORA IN CORSO -->
              <div
                v-else-if="
                  handScores.length &&
                  !matchFinishTriggered
                "
                class="continue-match-message"
              >
                Mancano
                <strong>
                  {{
                    formatScore(
                      Math.max(
                        0,
                        groupTargetScore - handTotal
                      )
                    )
                  }}
                </strong>
                punti all'obiettivo.
              </div>
            </section>

            <!-- INSERIMENTO MANUALE -->
            <section
              v-else
              class="score-entry"
            >
              <h2>Risultato finale</h2>

              <p>
                Inserisci direttamente il totale
                della tua squadra.
              </p>

              <label for="phoneScore">
                I tuoi punti
              </label>

              <input
                id="phoneScore"
                v-model.number="scoreInput"
                class="score-input"
                type="number"
                inputmode="numeric"
                step="1"
                placeholder="Es. 1080"
              />

              <button
                class="button primary phone-main-button"
                type="button"
                @click="submitMyScore"
              >
                Invia punteggio
              </button>

              <small>
                Dopo l'invio il risultato potrà essere
                corretto soltanto dal manager.
              </small>
            </section>
          </template>

          <!-- IO HO INVIATO, AVVERSARIO NO -->
          <section
            v-else-if="opponentScore(currentTeamMatch) === null"
            class="phone-state submitted"
          >
            <div class="state-icon success">✓</div>
            <h2>Punteggio inviato</h2>

            <strong class="big-score">
              {{ formatScore(myScore(currentTeamMatch)) }}
            </strong>

            <p>
              In attesa che
              <strong>
                {{ opponentFor(currentTeamMatch) }}
              </strong>
              inserisca il proprio risultato.
            </p>

            <small>
              Se hai commesso un errore,
              avvisa direttamente il manager.
            </small>
          </section>

          <!-- RISULTATO COMPLETO -->
          <section
            v-else
            class="final-result"
          >
            <p class="eyebrow">
              Risultato registrato
            </p>

            <div class="final-score-row mine">
              <span>{{ joinedTeamName }}</span>
              <strong>
                {{ formatScore(myScore(currentTeamMatch)) }}
              </strong>
            </div>

            <div class="final-score-row">
              <span>
                {{ opponentFor(currentTeamMatch) }}
              </span>
              <strong>
                {{ formatScore(opponentScore(currentTeamMatch)) }}
              </strong>
            </div>

            <div
              class="result-banner"
              :class="phoneResultClass(currentTeamMatch)"
            >
              {{ phoneResultText(currentTeamMatch) }}
            </div>

            <p class="result-help">
              Se il risultato non è corretto,
              comunicalo al manager.
            </p>
          </section>
        </section>

        <!-- NESSUNA PARTITA -->
        <section
          v-else
          class="phone-state waiting"
        >
          <div class="state-icon">⏳</div>
          <h2>Nessuna partita attiva</h2>
          <p>
            Attendi l'avvio del prossimo turno.
          </p>
        </section>

        <!-- CALENDARIO -->
        <section
          v-if="teamSchedule.length"
          class="phone-calendar"
        >
          <header>
            <p class="eyebrow">Calendario</p>
            <h2>Le tue partite</h2>
          </header>

          <article
            v-for="match in teamSchedule"
            :key="`phone-${match.id}`"
            class="calendar-match"
            :class="{
              current:
                match.round ===
                tournament.state.activeGroupRound,
              completed: match.played
            }"
          >
            <div>
              <span>Turno {{ match.round }}</span>
              <strong>
                vs {{ opponentFor(match) }}
              </strong>
            </div>

            <strong
              v-if="match.played"
              class="calendar-score"
            >
              {{ formatScore(myScore(match)) }}
              -
              {{ formatScore(opponentScore(match)) }}
            </strong>

            <span
              v-else-if="
                match.round ===
                tournament.state.activeGroupRound
              "
              class="calendar-live"
            >
              In corso
            </span>

            <span
              v-else
              class="muted"
            >
              Da giocare
            </span>
          </article>
        </section>

        <p
          class="phone-status"
          :class="{ error: phoneHasError }"
        >
          {{ statusMessage }}
        </p>

        <!-- MODALE CONFERMA RISULTATO -->
        <div
          v-if="scoreConfirmOpen"
          class="modal-backdrop"
          @click.self="cancelScoreConfirmation"
        >
          <div class="modal-card">
            <p class="eyebrow">
              Conferma risultato
            </p>

            <h2 class="confirmation-score">
              {{ formatScore(pendingFinalScore) }} punti
            </h2>

            <p>
              Questo sarà il risultato ufficiale della tua
              squadra inviato al torneo.
            </p>

            <p>
              Dopo l'invio non potrai modificarlo dal telefono.
              In caso di errore potrà correggerlo il manager.
            </p>

            <div class="modal-actions">
              <button
                class="button"
                type="button"
                @click="cancelScoreConfirmation"
              >
                Torna indietro
              </button>

              <button
                class="button primary"
                type="button"
                @click="confirmSubmitMyScore"
              >
                Conferma e invia
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
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

  teamName,
  teamCode,
  joinedTeamName,
  isPhoneConnected,
  statusMessage,
  needsTeamCode,
  phoneHasError,
  joinTeam,
  disconnectTeam,

  teamSchedule,
  currentTeamMatch,
  nextScheduledMatch,
  myScore,
  opponentScore,
  opponentFor,
  formatScore,
  matchStatusLabel,
  matchStatusClass,
  phoneResultText,
  phoneResultClass,

  scoreEntryMode,
  setScoreEntryMode,
  scoreInput,
  submitMyScore,

  handScores,
  handDraft,
  editingHandId,
  pendingDeleteHandId,
  clearHandsConfirmOpen,

  groupTargetScore,
  currentPozzettoPenalty,
  currentHandTotal,
  handTotal,
  scoreProgress,

  targetReached,
  opponentHasSubmitted,
  matchFinishTriggered,
  finishHandCount,
  hasCompletedFinalHand,
  canSubmitHandTotal,
  handEntryLocked,

  saveCurrentHand,
  startEditHand,
  cancelEditHand,
  requestDeleteHand,
  cancelDeleteHand,
  confirmDeleteHand,
  requestClearHands,
  cancelClearHands,
  confirmClearHands,
  submitHandTotal,

  scoreConfirmOpen,
  pendingFinalScore,
  cancelScoreConfirmation,
  confirmSubmitMyScore
} = app;
</script>

<template>
     <section class="phone-page">
      <div class="phone-card">
        <!-- LOGIN -->
        <template v-if="!isPhoneConnected">
          <header class="phone-login-header">
            <div class="logo-circle">
              ♣
            </div>

            <p class="eyebrow">
              Torneo Burraco
            </p>

            <h1>
              Entra al torneo
            </h1>

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
            :class="{
              error: phoneHasError
            }"
          >
            {{ statusMessage }}
          </p>
        </template>

        <!-- LOGGATO -->
        <template v-else>
          <header class="phone-team-header">
            <div>
              <p class="eyebrow">
                Squadra
              </p>

              <h1>
                {{ joinedTeamName }}
              </h1>
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
            <div class="state-icon">
              ⏳
            </div>

            <h2>
              In attesa
            </h2>

            <p>
              Il manager deve ancora generare
              il calendario del torneo.
            </p>
          </section>

          <!-- CALENDARIO GENERATO MA NESSUN TURNO -->
          <section
            v-else-if="!tournament.state.activeGroupRound"
            class="phone-state waiting"
          >
            <div class="state-icon">
              ✓
            </div>

            <h2>
              Calendario pronto
            </h2>

            <p>
              Attendi che il manager avvii il primo turno.
            </p>

            <div
              v-if="nextScheduledMatch"
              class="next-match"
            >
              <span>
                Prima partita
              </span>

              <strong>
                vs {{ opponentFor(nextScheduledMatch) }}
              </strong>
            </div>
          </section>

          <!-- PARTITA DEL TURNO ATTIVO -->
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

            <!-- VS -->
            <div class="phone-versus">
              <div class="phone-team mine">
                <span>
                  Tu
                </span>

                <strong>
                  {{ joinedTeamName }}
                </strong>
              </div>

              <div class="vs">
                VS
              </div>

              <div class="phone-team">
                <span>
                  Avversario
                </span>

                <strong>
                  {{ opponentFor(currentTeamMatch) }}
                </strong>
              </div>
            </div>

            <!-- NON HO ANCORA INVIATO -->
            <section
              v-if="myScore(currentTeamMatch) === null"
              class="score-entry"
            >
              <h2>
                Risultato della partita
              </h2>

              <p>
                Inserisci esclusivamente il punteggio
                finale della tua squadra.
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
                placeholder="1640"
              />

              <button
                class="button primary phone-main-button"
                type="button"
                @click="submitMyScore"
              >
                Invia punteggio
              </button>

              <small>
                Controlla il numero prima di inviarlo.
                Dopo l'invio può modificarlo soltanto il manager.
              </small>
            </section>

            <!-- IO HO INVIATO, AVVERSARIO NO -->
            <section
              v-else-if="
                opponentScore(currentTeamMatch) === null
              "
              class="phone-state submitted"
            >
              <div class="state-icon success">
                ✓
              </div>

              <h2>
                Punteggio inviato
              </h2>

              <strong class="big-score">
                {{
                  formatScore(
                    myScore(currentTeamMatch)
                  )
                }}
              </strong>

              <p>
                In attesa che
                <strong>
                  {{ opponentFor(currentTeamMatch) }}
                </strong>
                inserisca il proprio punteggio.
              </p>

              <small>
                Se hai commesso un errore,
                avvisa direttamente il manager.
              </small>
            </section>

            <!-- ENTRAMBI HANNO INVIATO -->
            <section
              v-else
              class="final-result"
            >
              <p class="eyebrow">
                Risultato registrato
              </p>

              <div class="final-score-row mine">
                <span>
                  {{ joinedTeamName }}
                </span>

                <strong>
                  {{
                    formatScore(
                      myScore(currentTeamMatch)
                    )
                  }}
                </strong>
              </div>

              <div class="final-score-row">
                <span>
                  {{ opponentFor(currentTeamMatch) }}
                </span>

                <strong>
                  {{
                    formatScore(
                      opponentScore(currentTeamMatch)
                    )
                  }}
                </strong>
              </div>

              <div
                class="result-banner"
                :class="
                  phoneResultClass(
                    currentTeamMatch
                  )
                "
              >
                {{
                  phoneResultText(
                    currentTeamMatch
                  )
                }}
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
            <div class="state-icon">
              ⏳
            </div>

            <h2>
              Nessuna partita attiva
            </h2>

            <p>
              Attendi l'avvio del prossimo turno.
            </p>
          </section>

          <!-- CALENDARIO PERSONALE -->
          <section
            v-if="teamSchedule.length"
            class="phone-calendar"
          >
            <header>
              <p class="eyebrow">
                Calendario
              </p>

              <h2>
                Le tue partite
              </h2>
            </header>

            <article
              v-for="match in teamSchedule"
              :key="`phone-${match.id}`"
              class="calendar-match"
              :class="{
                current:
                  match.round ===
                  tournament.state.activeGroupRound,
                completed:
                  match.played
              }"
            >
              <div>
                <span>
                  Turno {{ match.round }}
                </span>

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
            :class="{
              error: phoneHasError
            }"
          >
            {{ statusMessage }}
          </p>
        </template>
      </div>
    </section>
</template>

<script setup>
import { inject } from 'vue';

const app = inject('tournamentApp');

const {
  tournament,

  teamName,
  teamCode,
  joinedTeamName,
  scoreInput,

  isPhoneConnected,
  statusMessage,

  needsTeamCode,
  phoneHasError,

  teamSchedule,
  currentTeamMatch,
  nextScheduledMatch,

  joinTeam,
  disconnectTeam,
  submitMyScore,

  myScore,
  opponentScore,
  opponentFor,

  formatScore,

  matchStatusLabel,
  matchStatusClass,

  phoneResultText,
  phoneResultClass
} = app;
</script>
<template>
  <main class="app-shell">
    <nav class="switcher">
      <a href="#" :class="{ active: mode === 'manager' }">Manager</a>
      <a href="#phone" :class="{ active: mode === 'phone' }">Telefono</a>
    </nav>

    <!-- SEZIONE MANAGER -->
    <section v-if="mode === 'manager'" class="panel-manager">
      <header class="panel-header">
        <h1>{{ tournament.config?.tournamentName || 'Manager Torneo' }}</h1>
        <span class="badge" :class="tournament.state.phase">{{ tournament.state.phase }}</span>
      </header>

      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">Squadre Connesse</span>
          <span class="stat-value">{{ tournament.state.connectedTeams.length }} / {{ tournament.state.expectedTeams }}</span>
        </div>
      </div>

      <!-- IMPOSTAZIONI & AZIONI -->
      <div class="actions-card">
        <form @submit.prevent="saveSettings" class="inline-form">
          <div class="input-group">
            <label for="expectedTeams">Squadre previste</label>
            <input
              id="expectedTeams"
              v-model.number="expectedTeams"
              type="number"
              min="4"
              required
            />
          </div>
          <button type="submit" class="btn btn-primary">Salva</button>
          <button type="button" class="btn btn-danger" @click="resetTournament">Reset</button>
        </form>

        <button
          type="button"
          class="btn btn-accent generate-btn"
          @click="generateGroupMatches"
        >
          Sorteggia Partite Gironi
        </button>
      </div>

      <!-- SQUADRE CONNESSE -->
      <div class="section-block">
        <h2>Squadre connesse</h2>
        <div class="teams-chips">
          <span v-for="team in tournament.state.connectedTeams" :key="team.id" class="team-chip">
            {{ team.name }}
          </span>
        </div>
      </div>

      <!-- LAYOUT FISSO CON 3 COLONNE (Classifica G1 | Partite Scroll | Classifica G2) -->
      <div v-if="tournament.state.groups?.G1?.length || tournament.state.groups?.G2?.length" class="tournament-layout">
        
        <!-- SIDEBAR SINISTRA: CLASSIFICA G1 -->
        <aside class="sidebar-box left-sidebar">
          <div class="sidebar-header">
            <h3>Classifica G1</h3>
          </div>
          <ul class="standings-list">
            <li v-for="(team, index) in computedStandings.G1" :key="`stand-g1-${index}`">
              <span class="team-rank"><strong>{{ index + 1 }}.</strong> {{ team.name }}</span>
              <span class="pts-badge">{{ team.points }} pt</span>
            </li>
          </ul>
        </aside>

        <!-- AREA CENTRALE SCORREVOLE: CALENDARIO PARTITE -->
        <div class="matches-scroll-container">
          <h2>Calendario Partite</h2>
          <div class="matches-flex-container">
            <!-- PARTITE G1 -->
            <div class="group-matches-column" v-if="groupedMatchesByGroup.G1.length">
              <h3>Partite G1</h3>
              <div v-for="round in groupedMatchesByGroup.G1" :key="`g1-round-${round.round}`" class="round-card">
                <h4>Turno {{ round.round }}</h4>
                <ul>
                  <li v-for="m in round.matches" :key="m.id" :class="{ 'played': m.played }">
                    <span class="match-teams"><strong>{{ m.home }}</strong> vs <strong>{{ m.away }}</strong></span>
                    <span v-if="m.played" class="winner-tag">Vince: {{ m.winner }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- PARTITE G2 -->
            <div class="group-matches-column" v-if="groupedMatchesByGroup.G2.length">
              <h3>Partite G2</h3>
              <div v-for="round in groupedMatchesByGroup.G2" :key="`g2-round-${round.round}`" class="round-card">
                <h4>Turno {{ round.round }}</h4>
                <ul>
                  <li v-for="m in round.matches" :key="m.id" :class="{ 'played': m.played }">
                    <span class="match-teams"><strong>{{ m.home }}</strong> vs <strong>{{ m.away }}</strong></span>
                    <span v-if="m.played" class="winner-tag">Vince: {{ m.winner }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- SIDEBAR DESTRA: CLASSIFICA G2 -->
        <aside class="sidebar-box right-sidebar">
          <div class="sidebar-header">
            <h3>Classifica G2</h3>
          </div>
          <ul class="standings-list">
            <li v-for="(team, index) in computedStandings.G2" :key="`stand-g2-${index}`">
              <span class="team-rank"><strong>{{ index + 1 }}.</strong> {{ team.name }}</span>
              <span class="pts-badge">{{ team.points }} pt</span>
            </li>
          </ul>
        </aside>

      </div>
    </section>

    <!-- SEZIONE TELEFONO -->
    <section v-else class="panel phone-panel">
      <h1>Entra al Torneo</h1>
      <p class="subtitle">Inserisci i dati per connetterti alla partita.</p>

      <form @submit.prevent="joinTeam" class="phone-form">
        <input
          v-model="teamName"
          type="text"
          placeholder="Nome squadra"
          maxlength="40"
          :disabled="isPhoneConnected"
          required
        />

        <input
          v-if="tournament.config?.groupAssignmentMode === 'manual' || tournament.config?.groupAssignmentMode === 'fixed'"
          v-model="teamCode"
          type="text"
          placeholder="Codice squadra"
          maxlength="20"
          :disabled="isPhoneConnected"
          required
        />

        <button type="submit" class="btn btn-primary" :disabled="isPhoneConnected">Connettiti</button>
        <button type="button" class="btn btn-secondary" @click="disconnectTeam">Disconnetti</button>
      </form>

      <p class="status" :class="{ error: statusMessage.includes('Errore') }">{{ statusMessage }}</p>
    </section>
  </main>
</template>

<script setup>
import { io } from 'socket.io-client';
import { computed, onMounted, onUnmounted, ref } from 'vue';

const DEFAULT_EXPECTED_TEAMS = 12;

const mode = ref(window.location.hash === '#phone' ? 'phone' : 'manager');
const tournament = ref({
  config: {
    tournamentName: 'Torneo Burraco',
    groupAssignmentMode: 'fixed',
    pointsSystem: { win: 1, loss: 0 },
    manualGroups: { G1: [], G2: [] }
  },
  state: {
    phase: 'waiting-room',
    expectedTeams: DEFAULT_EXPECTED_TEAMS,
    connectedTeams: [],
    groups: { G1: [], G2: [] },
    groupMatches: [],
    knockoutMatches: []
  }
});

const expectedTeams = ref(DEFAULT_EXPECTED_TEAMS);
const teamName = ref('');
const teamCode = ref('');
const statusMessage = ref('In attesa di connessione');
const isPhoneConnected = ref(false);

let socket = null;

// Calcolo Punti e Classifica dinamica
const computedStandings = computed(() => {
  const standings = { G1: [], G2: [] };
  const pointsConfig = tournament.value.config?.pointsSystem || { win: 1, loss: 0 };
  const matches = Array.isArray(tournament.value.state?.groupMatches) ? tournament.value.state.groupMatches : [];

  ['G1', 'G2'].forEach(group => {
    const teams = tournament.value.state?.groups?.[group] || [];
    const teamStats = {};
    
    teams.forEach(t => { 
      teamStats[t] = { name: t, points: 0 }; 
    });

    matches.filter(m => m.group === group && m.played).forEach(m => {
      if (m.winner && teamStats[m.winner]) {
        teamStats[m.winner].points += pointsConfig.win;
      }
    });

    standings[group] = Object.values(teamStats).sort((a, b) => b.points - a.points);
  });

  return standings;
});

const groupedMatchesByGroup = computed(() => {
  const all = Array.isArray(tournament.value.state?.groupMatches)
    ? tournament.value.state.groupMatches
    : [];

  function groupByRound(groupName) {
    const filtered = all
      .filter((m) => m.group === groupName)
      .sort((a, b) => a.round - b.round);

    const roundsMap = new Map();
    for (const match of filtered) {
      if (!roundsMap.has(match.round)) {
        roundsMap.set(match.round, []);
      }
      roundsMap.get(match.round).push(match);
    }

    return Array.from(roundsMap.entries()).map(([round, matches]) => ({
      round,
      matches
    }));
  }

  return {
    G1: groupByRound('G1'),
    G2: groupByRound('G2')
  };
});

function updateModeFromHash() {
  mode.value = window.location.hash === '#phone' ? 'phone' : 'manager';
}

async function loadTournament() {
  try {
    const response = await fetch('/api/tournament');
    const data = await response.json();
    tournament.value = data;
    expectedTeams.value = data.state?.expectedTeams || DEFAULT_EXPECTED_TEAMS;
  } catch (e) {
    console.error(e);
  }
}

async function saveSettings() {
  const response = await fetch('/api/tournament/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedTeams: expectedTeams.value })
  });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || 'Errore nel salvataggio impostazioni');
    return;
  }
  tournament.value = data;
}

async function generateGroupMatches() {
  const response = await fetch('/api/tournament/group-matches/generate', { method: 'POST' });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || 'Errore nella generazione partite gironi');
    return;
  }
  tournament.value = data;
}

async function resetTournament() {
  const response = await fetch('/api/tournament/reset', { method: 'POST' });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || 'Errore nel reset');
    return;
  }
  tournament.value = data;
  expectedTeams.value = DEFAULT_EXPECTED_TEAMS;
  teamCode.value = '';
}

function connectSocket() {
  if (socket) return;
  socket = io();

  socket.on('tournament:update', (nextTournament) => {
    tournament.value = nextTournament;
  });

  socket.on('team:joined', (team) => {
    statusMessage.value = `Connesso: ${team.name}`;
    isPhoneConnected.value = true;
  });

  socket.on('team:join:error', (message) => {
    statusMessage.value = message;
  });

  socket.on('connect_error', () => {
    statusMessage.value = 'Errore di connessione al server';
    isPhoneConnected.value = false;
  });

  socket.on('disconnect', () => {
    isPhoneConnected.value = false;
  });
}

function disconnectTeam() {
  if (socket) {
    socket.disconnect();
    socket = null;
    statusMessage.value = 'Disconnesso';
    isPhoneConnected.value = false;
  }
}

function joinTeam() {
  if (!socket) connectSocket();
  if (!socket) {
    statusMessage.value = 'Connessione non pronta';
    return;
  }

  const value = teamName.value.trim();
  if (!value) {
    statusMessage.value = 'Inserisci il nome della squadra';
    return;
  }

  const modeValue = tournament.value.config?.groupAssignmentMode;
  if ((modeValue === 'manual' || modeValue === 'fixed') && !teamCode.value.trim()) {
    statusMessage.value = 'Inserisci il codice squadra';
    return;
  }

  socket.emit('team:join', { name: value, code: teamCode.value.trim() });
  statusMessage.value = 'Connessione in corso...';
}

onMounted(() => {
  loadTournament();
  connectSocket();
  window.addEventListener('hashchange', updateModeFromHash);
});

onUnmounted(() => {
  window.removeEventListener('hashchange', updateModeFromHash);
  if (socket) socket.disconnect();
  socket = null;
});
</script>

<style scoped>
/* RESET & LAYOUT PRINCIPALE ESTESO */
.app-shell {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  width: 100%;
  max-width: 1400px; /* Esteso la larghezza per accogliere 3 colonne affiancate */
  margin: 0 auto;
  padding: 16px;
  color: #2d3748;
  background-color: #f7fafc;
  min-height: 100vh;
  box-sizing: border-box;
}

.switcher {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  border-bottom: 2px solid #e2e8f0;
  padding-bottom: 8px;
}

.switcher a {
  text-decoration: none;
  color: #4a5568;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 6px;
}

.switcher a.active {
  background-color: #3182ce;
  color: #ffffff;
}

.panel-manager {
  background: #ffffff;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #edf2f7;
  padding-bottom: 12px;
}

/* STATS & ACTIONS */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 16px 0;
}

.stat-card {
  background: #ebf8ff;
  border: 1px solid #bee3f8;
  padding: 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

.stat-label { font-size: 0.85rem; color: #2b6cb0; font-weight: 600; }
.stat-value { font-size: 1.2rem; color: #2c5282; font-weight: bold; }

.actions-card {
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.inline-form {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

input {
  padding: 8px 12px;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
}

.btn {
  padding: 8px 16px;
  font-weight: 600;
  border-radius: 6px;
  border: none;
  cursor: pointer;
}

.btn-primary { background: #3182ce; color: white; }
.btn-danger { background: #e53e3e; color: white; }
.btn-accent { background: #38a169; color: white; width: 100%; margin-top: 10px; }

/* LAYOUT FISSO A 3 COLONNE PER LE CLASSIFICHE */
.tournament-layout {
  display: grid;
  grid-template-columns: 280px 1fr 280px; /* 280px fissa SX | Centro Flessibile | 280px fissa DX */
  gap: 16px;
  margin-top: 24px;
  align-items: start;
}

/* BOX SIDEBARS (CLASSIFICHE) */
.sidebar-box {
  background: #fffaf0;
  border: 1px solid #feebc8;
  border-radius: 8px;
  padding: 16px;
  position: sticky;
  top: 16px; /* Mantiene la classifica in alto durante lo scroll */
}

.sidebar-header h3 {
  color: #c05621;
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 2px solid #feebc8;
}

.standings-list {
  list-style: none;
  padding: 0;
  margin: 12px 0 0 0;
}

.standings-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #fbd38d;
}

.pts-badge {
  background-color: #dd6b20;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: bold;
}

/* AREA CENTRALE PARTITE CON SCROLL DEDICATO */
.matches-scroll-container {
  max-height: 75vh; /* Limita l'altezza massima per attivare lo scroll */
  overflow-y: auto; /* Attiva lo scroll interno verticale */
  padding-right: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  padding: 16px;
}

.matches-flex-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.group-matches-column {
  background: #f8fafc;
  border: 1px solid #cbd5e0;
  border-radius: 8px;
  padding: 12px;
}

.round-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px;
  margin-top: 8px;
}

.round-card ul {
  padding: 0;
  list-style: none;
  margin: 0;
}

.round-card li {
  padding: 6px 0;
  border-bottom: 1px solid #edf2f7;
  font-size: 0.9rem;
}

.round-card li.played {
  background: #f0fff4;
  padding: 6px;
  border-radius: 4px;
}

.winner-tag {
  display: block;
  font-size: 0.75rem;
  color: #2f855a;
  font-weight: bold;
}

/* SQUADRE CHIPS */
.section-block {
  margin-top: 16px;
}

.teams-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.team-chip {
  background: #edf2f7;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.85rem;
}

/* PHONE PANEL */
.phone-panel {
  max-width: 400px;
  margin: 20px auto;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.phone-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* RESPONSIVE PER SCHERMI PICCOLI (Mobile/Tablet) */
@media (max-width: 1024px) {
  .tournament-layout {
    grid-template-columns: 1fr;
  }

  .sidebar-box {
    position: static;
  }

  .matches-scroll-container {
    max-height: none;
    overflow-y: visible;
  }
}
</style>
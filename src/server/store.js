const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'tournament.json');

const defaultTournament = {
  config: {
    tournamentName: 'Torneo Burraco',
    teamsCount: 12,
    playersPerTeam: 2,
    groupCount: 2,
    teamsPerGroup: 6,
    groupPhaseDay: 1,
    knockoutPhaseDay: 2,
    groupAssignmentMode: 'fixed',
    manualGroups: { G1: [], G2: [] },
    pointsSystem: { win: 1, loss: 0 },
    tiebreakRules: ['head_to_head', 'points_difference', 'draw_lots'],
    qualifiedPerGroup: 4,
    knockoutTemplate: [
      { slot: 'QF1', home: 'G1_1', away: 'G2_4' },
      { slot: 'QF2', home: 'G1_2', away: 'G2_3' },
      { slot: 'QF3', home: 'G2_1', away: 'G1_4' },
      { slot: 'QF4', home: 'G2_2', away: 'G1_3' }
    ]
  },
  state: {
    phase: 'waiting-room',
    expectedTeams: 12,
    connectedTeams: [],
    registeredTeams: [],
    groups: { G1: [], G2: [] },
    groupMatches: [],
    groupStandings: { G1: [], G2: [] },
    knockoutMatches: [],
    audit: {
      createdAt: null,
      updatedAt: null
    }
  }
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function saveTournamentData(tournament) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tournament, null, 2), 'utf-8');
}

function normalizeTournamentShape(raw) {
  if (raw && raw.config && raw.state) return raw;

  // Fallback se trovi ancora il vecchio formato piatto.
  return {
    config: deepClone(defaultTournament.config),
    state: {
      ...deepClone(defaultTournament.state),
      phase: raw?.phase || 'waiting-room',
      expectedTeams: Number.isInteger(raw?.expectedTeams) ? raw.expectedTeams : 12,
      registeredTeams: Array.isArray(raw?.teams) ? raw.teams.map(t => t.name || '').filter(Boolean) : [],
      knockoutMatches: Array.isArray(raw?.matches) ? raw.matches : []
    }
  };
}

function loadTournamentData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = deepClone(defaultTournament);
    saveTournamentData(initial);
    return initial;
  }

  try {
    const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(fileContent);
    const normalized = normalizeTournamentShape(parsed);
    saveTournamentData(normalized);
    return normalized;
  } catch (error) {
    const initial = deepClone(defaultTournament);
    saveTournamentData(initial);
    return initial;
  }
}

module.exports = {
  DATA_FILE,
  defaultTournament,
  loadTournamentData,
  saveTournamentData
};
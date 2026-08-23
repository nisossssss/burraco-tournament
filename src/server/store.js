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

    manualGroups: {
      G1: [],
      G2: []
    },

    manualAccessCodes: {},

    pointsSystem: {
      win: 1,
      loss: 0
    },

    tiebreakRules: [
      'head_to_head',
      'points_difference',
      'draw_lots'
    ],

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

    groups: {
      G1: [],
      G2: []
    },

    groupMatches: [],

    groupStandings: {
      G1: [],
      G2: []
    },

    // Turno dei gironi attualmente attivo.
    // null = nessun turno avviato.
    activeGroupRound: null,

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

function normalizeMatch(match) {
  const scoreHome = Number.isInteger(match?.scoreHome)
    ? match.scoreHome
    : null;

  const scoreAway = Number.isInteger(match?.scoreAway)
    ? match.scoreAway
    : null;

  const played =
    Boolean(match?.played) ||
    (scoreHome !== null && scoreAway !== null);

  let winner = null;

  if (played && scoreHome !== scoreAway) {
    winner = scoreHome > scoreAway
      ? match.home
      : match.away;
  }

  return {
    ...match,

    scoreHome,
    scoreAway,

    played,
    winner,

    status: played
      ? 'completed'
      : match?.status || 'scheduled',

    scoreHomeSubmittedAt:
      match?.scoreHomeSubmittedAt || null,

    scoreAwaySubmittedAt:
      match?.scoreAwaySubmittedAt || null,

    managerEditedAt:
      match?.managerEditedAt || null
  };
}

function saveTournamentData(tournament) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(tournament, null, 2),
    'utf-8'
  );
}

function normalizeTournamentShape(raw) {
 
  if (raw && raw.config && raw.state) {
    return {
      config: {
        ...deepClone(defaultTournament.config),
        ...raw.config,

        manualGroups: {
          ...deepClone(defaultTournament.config.manualGroups),
          ...(raw.config.manualGroups || {})
        },

        manualAccessCodes: {
          ...deepClone(defaultTournament.config.manualAccessCodes),

          /*
           * Compatibilità anche con l'eventuale vecchio typo:
           * manualAccesCodes
           */
          ...(
            raw.config.manualAccessCodes ||
            raw.config.manualAccesCodes ||
            {}
          )
        },

        pointsSystem: {
          ...deepClone(defaultTournament.config.pointsSystem),
          ...(raw.config.pointsSystem || {})
        }
      },

      state: {
        ...deepClone(defaultTournament.state),
        ...raw.state,

        groups: {
          ...deepClone(defaultTournament.state.groups),
          ...(raw.state.groups || {})
        },

        groupStandings: {
          ...deepClone(defaultTournament.state.groupStandings),
          ...(raw.state.groupStandings || {})
        },

        audit: {
          ...deepClone(defaultTournament.state.audit),
          ...(raw.state.audit || {})
        },

        activeGroupRound:
          Number.isInteger(raw.state.activeGroupRound)
            ? raw.state.activeGroupRound
            : null,

        groupMatches:
          Array.isArray(raw.state.groupMatches)
            ? raw.state.groupMatches.map(normalizeMatch)
            : []
      }
    };
  }

  return {
    config: deepClone(defaultTournament.config),

    state: {
      ...deepClone(defaultTournament.state),

      phase:
        raw?.phase || 'waiting-room',

      expectedTeams:
        Number.isInteger(raw?.expectedTeams)
          ? raw.expectedTeams
          : 12,

      registeredTeams:
        Array.isArray(raw?.teams)
          ? raw.teams
              .map(team => team.name || '')
              .filter(Boolean)
          : [],

      knockoutMatches:
        Array.isArray(raw?.matches)
          ? raw.matches
          : []
    }
  };
}

function loadTournamentData() {
  /*
   * Se tournament.json non esiste,
   * viene creato automaticamente.
   */
  if (!fs.existsSync(DATA_FILE)) {
    const initial = deepClone(defaultTournament);

    saveTournamentData(initial);

    return initial;
  }

  try {
    const fileContent =
      fs.readFileSync(DATA_FILE, 'utf-8');

    const parsed =
      JSON.parse(fileContent);

    const normalized =
      normalizeTournamentShape(parsed);

    saveTournamentData(normalized);

    return normalized;

  } catch (error) {
    console.error(
      'Errore durante il caricamento del torneo:',
      error
    );

    const initial =
      deepClone(defaultTournament);

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
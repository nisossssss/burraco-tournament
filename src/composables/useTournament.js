import { io } from 'socket.io-client';
import {
    computed,
    onMounted,
    onUnmounted,
    reactive,
    ref
} from 'vue';

const DEFAULT_EXPECTED_TEAMS = 12;
const STORAGE_KEY = 'burraco-team-session';

export function useTournament() {
  /* =========================================================
     STATO GENERALE
  ========================================================= */

  const mode = ref(
    window.location.hash === '#phone'
      ? 'phone'
      : 'manager'
  );

  const tournament = ref({
    config: {
      tournamentName: 'Torneo Burraco',
      groupAssignmentMode: 'fixed',

      pointsSystem: {
        win: 1,
        loss: 0
      },

      manualGroups: {
        G1: [],
        G2: []
      }
    },

    state: {
      phase: 'waiting-room',

      expectedTeams: DEFAULT_EXPECTED_TEAMS,

      connectedTeams: [],

      groups: {
        G1: [],
        G2: []
      },

      groupMatches: [],

      activeGroupRound: null,

      knockoutMatches: []
    }
  });

  const expectedTeams = ref(DEFAULT_EXPECTED_TEAMS);

  /* =========================================================
     TELEFONO
  ========================================================= */

  const teamName = ref('');
  const teamCode = ref('');
  const joinedTeamName = ref('');
  const scoreInput = ref(null);

  const isPhoneConnected = ref(false);

  const statusMessage = ref(
    'Connessione al server...'
  );

  /* =========================================================
     MANAGER
  ========================================================= */

  const editingMatchId = ref(null);

  const managerScoreDrafts = reactive({});

  /* =========================================================
     SOCKET
  ========================================================= */

  let socket = null;
  let manualDisconnect = false;

  /* =========================================================
     COMPUTED GENERALI
  ========================================================= */

  const needsTeamCode = computed(() => {
    const assignmentMode =
      tournament.value.config?.groupAssignmentMode;

    return (
      assignmentMode === 'manual' ||
      assignmentMode === 'fixed'
    );
  });

  const phoneHasError = computed(() =>
    /errore|non valido|non trovata|già|devi|persa/i.test(
      statusMessage.value
    )
  );

  const phaseLabel = computed(() => {
    switch (tournament.value.state.phase) {
      case 'waiting-room':
        return 'Waiting room';

      case 'groups_day_1':
        return 'Fase a gironi';

      default:
        return (
          tournament.value.state.phase ||
          '—'
        );
    }
  });

  const activeRoundLabel = computed(() => {
    const round =
      tournament.value.state.activeGroupRound;

    return Number.isInteger(round)
      ? `Turno ${round}`
      : 'Nessuno';
  });

  const completedMatchesCount = computed(() =>
    tournament.value.state.groupMatches.filter(
      match => match.played
    ).length
  );

  const roundNumbers = computed(() => {
    const rounds =
      tournament.value.state.groupMatches.map(
        match => match.round
      );

    return [
      ...new Set(rounds)
    ].sort(
      (a, b) => a - b
    );
  });

  /* =========================================================
     CLASSIFICHE
  ========================================================= */

  const computedStandings = computed(() => {
    const standings = {
      G1: [],
      G2: []
    };

    const pointsConfig =
      tournament.value.config?.pointsSystem || {
        win: 1,
        loss: 0
      };

    const matches = Array.isArray(
      tournament.value.state?.groupMatches
    )
      ? tournament.value.state.groupMatches
      : [];

    ['G1', 'G2'].forEach(group => {
      const teams =
        tournament.value.state?.groups?.[group] ||
        [];

      const stats = {};

      teams.forEach(team => {
        stats[team] = {
          name: team,
          points: 0,
          difference: 0,
          played: 0,
          wins: 0,
          losses: 0
        };
      });

      matches
        .filter(
          match =>
            match.group === group &&
            match.played
        )
        .forEach(match => {
          const home =
            stats[match.home];

          const away =
            stats[match.away];

          if (!home || !away) {
            return;
          }

          home.played += 1;
          away.played += 1;

          home.difference +=
            match.scoreHome -
            match.scoreAway;

          away.difference +=
            match.scoreAway -
            match.scoreHome;

          if (
            match.winner ===
            match.home
          ) {
            home.wins += 1;
            away.losses += 1;

            home.points +=
              pointsConfig.win;

            away.points +=
              pointsConfig.loss;
          }

          else if (
            match.winner ===
            match.away
          ) {
            away.wins += 1;
            home.losses += 1;

            away.points +=
              pointsConfig.win;

            home.points +=
              pointsConfig.loss;
          }
        });

      standings[group] =
        Object.values(stats)
          .sort(
            (a, b) =>
              b.points -
                a.points ||

              b.difference -
                a.difference ||

              a.name.localeCompare(
                b.name
              )
          );
    });

    return standings;
  });

  /* =========================================================
     PARTITE DIVISE PER GIRONE / TURNO
  ========================================================= */

  const groupedMatchesByGroup = computed(() => {
    const matches =
      tournament.value.state.groupMatches ||
      [];

    function buildGroup(groupName) {
      const groupMatches =
        matches
          .filter(
            match =>
              match.group ===
              groupName
          )
          .sort(
            (a, b) =>
              a.round -
              b.round
          );

      const map =
        new Map();

      groupMatches.forEach(match => {
        if (!map.has(match.round)) {
          map.set(
            match.round,
            []
          );
        }

        map
          .get(match.round)
          .push(match);
      });

      return Array
        .from(map.entries())
        .map(
          ([round, roundMatches]) => ({
            round,
            matches: roundMatches
          })
        );
    }

    return {
      G1: buildGroup('G1'),
      G2: buildGroup('G2')
    };
  });

  /* =========================================================
     CALENDARIO SQUADRA
  ========================================================= */

  const teamSchedule = computed(() => {
    if (!joinedTeamName.value) {
      return [];
    }

    const currentTeam =
      joinedTeamName.value.toLowerCase();

    return tournament.value.state.groupMatches
      .filter(match => {
        const home =
          String(match.home || '')
            .toLowerCase();

        const away =
          String(match.away || '')
            .toLowerCase();

        return (
          home === currentTeam ||
          away === currentTeam
        );
      })
      .sort(
        (a, b) =>
          a.round -
          b.round
      );
  });

  const currentTeamMatch = computed(() => {
    const activeRound =
      tournament.value.state.activeGroupRound;

    if (!activeRound) {
      return null;
    }

    return (
      teamSchedule.value.find(
        match =>
          match.round ===
          activeRound
      ) ||
      null
    );
  });

  const nextScheduledMatch = computed(() =>
    teamSchedule.value.find(
      match =>
        !match.played
    ) ||
    null
  );

  /* =========================================================
     NAVIGAZIONE MANAGER / TELEFONO
  ========================================================= */

  function updateModeFromHash() {
    mode.value =
      window.location.hash === '#phone'
        ? 'phone'
        : 'manager';

    if (
      mode.value === 'phone' &&
      socket?.connected &&
      !isPhoneConnected.value
    ) {
      tryAutoJoin();
    }
  }

  /* =========================================================
     API
  ========================================================= */

  async function apiRequest(
    url,
    options = {}
  ) {
    const response =
      await fetch(
        url,
        options
      );

    let data;

    try {
      data =
        await response.json();
    }

    catch {
      throw new Error(
        'Risposta non valida dal server.'
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
        'Errore nella richiesta.'
      );
    }

    return data;
  }

  async function loadTournament() {
    try {
      const data =
        await apiRequest(
          '/api/tournament'
        );

      tournament.value =
        data;

      expectedTeams.value =
        data.state?.expectedTeams ||
        DEFAULT_EXPECTED_TEAMS;
    }

    catch (error) {
      console.error(
        'Errore caricamento torneo:',
        error
      );
    }
  }

  async function saveSettings() {
    try {
      tournament.value =
        await apiRequest(
          '/api/tournament/settings',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                expectedTeams:
                  expectedTeams.value
              })
          }
        );
    }

    catch (error) {
      alert(
        error.message
      );
    }
  }

  async function generateGroupMatches() {
    try {
      tournament.value =
        await apiRequest(
          '/api/tournament/group-matches/generate',
          {
            method: 'POST'
          }
        );
    }

    catch (error) {
      alert(
        error.message
      );
    }
  }

  async function startRound(round) {
    try {
      tournament.value =
        await apiRequest(
          `/api/tournament/group-rounds/${round}/start`,
          {
            method: 'POST'
          }
        );
    }

    catch (error) {
      alert(
        error.message
      );
    }
  }

  async function resetTournament() {
    const confirmed =
      window.confirm(
        'Vuoi davvero resettare il torneo?\n\nCalendario e risultati verranno cancellati.'
      );

    if (!confirmed) {
      return;
    }

    try {
      tournament.value =
        await apiRequest(
          '/api/tournament/reset',
          {
            method: 'POST'
          }
        );

      expectedTeams.value =
        DEFAULT_EXPECTED_TEAMS;

      editingMatchId.value =
        null;
    }

    catch (error) {
      alert(
        error.message
      );
    }
  }

  /* =========================================================
     MANAGER - TURNI
  ========================================================= */

  function isRoundComplete(round) {
    const matches =
      tournament.value.state.groupMatches
        .filter(
          match =>
            match.round === round
        );

    return (
      matches.length > 0 &&
      matches.every(
        match =>
          match.played
      )
    );
  }

  function isRoundCompleteForGroup(
    group,
    round
  ) {
    const matches =
      tournament.value.state.groupMatches
        .filter(
          match =>
            match.group === group &&
            match.round === round
        );

    return (
      matches.length > 0 &&
      matches.every(
        match =>
          match.played
      )
    );
  }

  /* =========================================================
     MANAGER - MODIFICA PUNTEGGI
  ========================================================= */

  function beginManagerEdit(match) {
    editingMatchId.value =
      match.id;

    managerScoreDrafts[
      match.id
    ] = {
      home:
        match.scoreHome ??
        '',

      away:
        match.scoreAway ??
        ''
    };
  }

  function cancelManagerEdit() {
    editingMatchId.value =
      null;
  }

  async function saveManagerScore(match) {
    const draft =
      managerScoreDrafts[
        match.id
      ];

    if (!draft) {
      return;
    }

    if (
      String(draft.home).trim() === '' ||
      String(draft.away).trim() === ''
    ) {
      alert(
        'Inserisci entrambi i punteggi.'
      );

      return;
    }

    const home =
      Number(draft.home);

    const away =
      Number(draft.away);

    if (
      !Number.isInteger(home) ||
      !Number.isInteger(away)
    ) {
      alert(
        'I punteggi devono essere numeri interi.'
      );

      return;
    }

    try {
      tournament.value =
        await apiRequest(
          `/api/tournament/group-matches/${encodeURIComponent(
            match.id
          )}/score`,

          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                scoreHome: home,
                scoreAway: away
              })
          }
        );

      editingMatchId.value =
        null;
    }

    catch (error) {
      alert(
        error.message
      );
    }
  }

  /* =========================================================
     SOCKET.IO
  ========================================================= */

  function connectSocket() {
    if (socket) {
      return;
    }

    manualDisconnect =
      false;

    socket =
      io();

    socket.on(
      'connect',
      () => {
        if (
          mode.value === 'phone' &&
          !isPhoneConnected.value
        ) {
          tryAutoJoin();
        }
      }
    );

    socket.on(
      'tournament:update',
      nextTournament => {
        tournament.value =
          nextTournament;
      }
    );

    socket.on(
      'team:joined',
      team => {
        joinedTeamName.value =
          team.name;

        teamName.value =
          team.name;

        isPhoneConnected.value =
          true;

        statusMessage.value =
          `Connesso come ${team.name}`;

        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            name:
              teamName.value,

            code:
              teamCode.value
          })
        );
      }
    );

    socket.on(
      'team:join:error',
      message => {
        statusMessage.value =
          message;
      }
    );

    socket.on(
      'team:left',
      () => {
        joinedTeamName.value =
          '';

        isPhoneConnected.value =
          false;
      }
    );

    socket.on(
      'match:score:accepted',
      ({ score }) => {
        statusMessage.value =
          `Punteggio ${formatScore(score)} inviato.`;

        scoreInput.value =
          null;
      }
    );

    socket.on(
      'match:score:error',
      message => {
        statusMessage.value =
          message;
      }
    );

    socket.on(
      'connect_error',
      () => {
        statusMessage.value =
          'Errore di connessione al server.';

        isPhoneConnected.value =
          false;
      }
    );

    socket.on(
      'disconnect',
      () => {
        isPhoneConnected.value =
          false;

        if (!manualDisconnect) {
          statusMessage.value =
            'Connessione persa. Riconnessione automatica...';
        }
      }
    );
  }

  /* =========================================================
     LOGIN TELEFONO
  ========================================================= */

  function joinTeam() {
    if (!socket) {
      connectSocket();
    }

    if (!socket?.connected) {
      statusMessage.value =
        'Connessione al server non ancora pronta.';

      return;
    }

    const name =
      teamName.value.trim();

    const code =
      teamCode.value.trim();

    if (!name) {
      statusMessage.value =
        'Inserisci il nome della squadra.';

      return;
    }

    if (
      needsTeamCode.value &&
      !code
    ) {
      statusMessage.value =
        'Inserisci il codice squadra.';

      return;
    }

    socket.emit(
      'team:join',
      {
        name,
        code
      }
    );

    statusMessage.value =
      'Accesso in corso...';
  }

  /* =========================================================
     AUTO LOGIN
  ========================================================= */

  function tryAutoJoin() {
    const raw =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (
      !raw ||
      !socket?.connected
    ) {
      return;
    }

    try {
      const saved =
        JSON.parse(raw);

      if (
        !saved?.name ||
        !saved?.code
      ) {
        return;
      }

      teamName.value =
        saved.name;

      teamCode.value =
        saved.code;

      socket.emit(
        'team:join',
        {
          name:
            saved.name,

          code:
            saved.code
        }
      );

      statusMessage.value =
        'Ripristino sessione...';
    }

    catch {
      localStorage.removeItem(
        STORAGE_KEY
      );
    }
  }

  /* =========================================================
     LOGOUT
  ========================================================= */

  function disconnectTeam() {
    const confirmed =
      window.confirm(
        'Vuoi uscire dalla squadra?'
      );

    if (!confirmed) {
      return;
    }

    manualDisconnect =
      true;

    localStorage.removeItem(
      STORAGE_KEY
    );

    joinedTeamName.value =
      '';

    teamName.value =
      '';

    teamCode.value =
      '';

    scoreInput.value =
      null;

    isPhoneConnected.value =
      false;

    statusMessage.value =
      'Disconnesso.';

    if (socket?.connected) {
      socket.emit(
        'team:leave'
      );
    }

    manualDisconnect =
      false;
  }

  /* =========================================================
     INVIO PUNTEGGIO TELEFONO
  ========================================================= */

  function submitMyScore() {
    const match =
      currentTeamMatch.value;

    if (!match) {
      statusMessage.value =
        'Non hai una partita attiva.';

      return;
    }

    if (
      scoreInput.value === null ||
      scoreInput.value === ''
    ) {
      statusMessage.value =
        'Inserisci il tuo punteggio.';

      return;
    }

    const score =
      Number(
        scoreInput.value
      );

    if (
      !Number.isInteger(score)
    ) {
      statusMessage.value =
        'Inserisci un punteggio intero valido.';

      return;
    }

    const confirmed =
      window.confirm(
        `Confermi ${formatScore(score)} punti?\n\nDopo l'invio potrà correggerli soltanto il manager.`
      );

    if (!confirmed) {
      return;
    }

    if (!socket?.connected) {
      statusMessage.value =
        'Connessione al server non disponibile.';

      return;
    }

    socket.emit(
      'match:score:submit',
      {
        matchId:
          match.id,

        score
      }
    );

    statusMessage.value =
      'Invio del punteggio...';
  }

  /* =========================================================
     HELPERS PARTITA
  ========================================================= */

  function isMyTeam(name) {
    if (
      !name ||
      !joinedTeamName.value
    ) {
      return false;
    }

    return (
      String(name).toLowerCase() ===
      joinedTeamName.value.toLowerCase()
    );
  }

  function myScore(match) {
    if (!match) {
      return null;
    }

    return isMyTeam(
      match.home
    )
      ? match.scoreHome
      : match.scoreAway;
  }

  function opponentScore(match) {
    if (!match) {
      return null;
    }

    return isMyTeam(
      match.home
    )
      ? match.scoreAway
      : match.scoreHome;
  }

  function opponentFor(match) {
    if (!match) {
      return '—';
    }

    return isMyTeam(
      match.home
    )
      ? match.away
      : match.home;
  }

  function formatScore(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return '—';
    }

    return new Intl
      .NumberFormat('it-IT')
      .format(value);
  }

  function signedNumber(value) {
    if (value > 0) {
      return `+${formatScore(value)}`;
    }

    return formatScore(value);
  }

  function matchStatusLabel(match) {
    if (match.played) {
      return 'Completata';
    }

    if (
      match.round ===
      tournament.value.state.activeGroupRound
    ) {
      return 'In corso';
    }

    return 'Da giocare';
  }

  function matchStatusClass(match) {
    if (match.played) {
      return 'completed';
    }

    if (
      match.round ===
      tournament.value.state.activeGroupRound
    ) {
      return 'active';
    }

    return 'scheduled';
  }

  function phoneResultText(match) {
    const mine =
      myScore(match);

    const opponent =
      opponentScore(match);

    if (mine === opponent) {
      return 'Pareggio';
    }

    return mine > opponent
      ? 'Vittoria'
      : 'Sconfitta';
  }

  function phoneResultClass(match) {
    const mine =
      myScore(match);

    const opponent =
      opponentScore(match);

    if (mine === opponent) {
      return 'draw';
    }

    return mine > opponent
      ? 'win'
      : 'loss';
  }

  /* =========================================================
     LIFECYCLE
  ========================================================= */

  onMounted(async () => {
    await loadTournament();

    connectSocket();

    window.addEventListener(
      'hashchange',
      updateModeFromHash
    );
  });

  onUnmounted(() => {
    window.removeEventListener(
      'hashchange',
      updateModeFromHash
    );

    if (socket) {
      socket.disconnect();
    }

    socket =
      null;
  });

  /* =========================================================
     EXPORT DELLA COMPOSABLE
  ========================================================= */

  return {
    /* stato generale */
    mode,
    tournament,
    expectedTeams,

    /* telefono */
    teamName,
    teamCode,
    joinedTeamName,
    scoreInput,
    isPhoneConnected,
    statusMessage,

    /* manager */
    editingMatchId,
    managerScoreDrafts,

    /* computed */
    needsTeamCode,
    phoneHasError,
    phaseLabel,
    activeRoundLabel,
    completedMatchesCount,
    roundNumbers,

    computedStandings,
    groupedMatchesByGroup,

    teamSchedule,
    currentTeamMatch,
    nextScheduledMatch,

    /* API manager */
    saveSettings,
    generateGroupMatches,
    startRound,
    resetTournament,

    /* gestione turni */
    isRoundComplete,
    isRoundCompleteForGroup,

    /* modifica risultati */
    beginManagerEdit,
    cancelManagerEdit,
    saveManagerScore,

    /* telefono */
    joinTeam,
    disconnectTeam,
    submitMyScore,

    /* helpers */
    myScore,
    opponentScore,
    opponentFor,
    formatScore,
    signedNumber,

    matchStatusLabel,
    matchStatusClass,

    phoneResultText,
    phoneResultClass
  };
}
import { io } from 'socket.io-client';
import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch
} from 'vue';

const DEFAULT_EXPECTED_TEAMS = 12;
const DEFAULT_GROUP_TARGET_SCORE = 1005;
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
      groupTargetScore: DEFAULT_GROUP_TARGET_SCORE,
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
      knockoutMatches: [],
      audit: {
        createdAt: null,
        updatedAt: null
      }
    }
  });

  const expectedTeams = ref(
    DEFAULT_EXPECTED_TEAMS
  );

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
     CONTEGGIO MANI LOCALE
  ========================================================= */

  const scoreEntryMode = ref('hands');
  const handScores = ref([]);
  const editingHandId = ref(null);
  const pendingDeleteHandId = ref(null);
  const clearHandsConfirmOpen = ref(false);

  const scoreConfirmOpen = ref(false);
  const pendingFinalScore = ref(null);

  const handDraft = reactive({
    basePoints: null,
    tablePoints: null,
    handPoints: null,
    pozzettoStatus: 'taken'
  });

  /* =========================================================
     MANAGER
  ========================================================= */

  const editingMatchId = ref(null);
  const managerScoreDrafts = reactive({});

  /* =========================================================
     RESET
  ========================================================= */

  const resetModalOpen = ref(false);

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
      tournament.value.config
        ?.groupAssignmentMode;

    return (
      assignmentMode === 'manual' ||
      assignmentMode === 'fixed'
    );
  });

  const phoneHasError = computed(() =>
    /errore|non valido|non trovata|già|devi|persa|manca/i.test(
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
      tournament.value.state
        .activeGroupRound;

    return Number.isInteger(round)
      ? `Turno ${round}`
      : 'Nessuno';
  });

  const completedMatchesCount = computed(() =>
    tournament.value.state.groupMatches.filter(
      (match) => match.played
    ).length
  );

  const roundNumbers = computed(() => {
    const rounds =
      tournament.value.state.groupMatches.map(
        (match) => match.round
      );

    return [...new Set(rounds)].sort(
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
      tournament.value.config
        ?.pointsSystem || {
        win: 1,
        loss: 0
      };

    const matches = Array.isArray(
      tournament.value.state
        ?.groupMatches
    )
      ? tournament.value.state.groupMatches
      : [];

    ['G1', 'G2'].forEach((group) => {
      const teams =
        tournament.value.state
          ?.groups?.[group] || [];

      const stats = {};

      teams.forEach((team) => {
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
          (match) =>
            match.group === group &&
            match.played
        )
        .forEach((match) => {
          const home = stats[match.home];
          const away = stats[match.away];

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

          if (match.winner === match.home) {
            home.wins += 1;
            away.losses += 1;

            home.points +=
              pointsConfig.win;

            away.points +=
              pointsConfig.loss;
          }

          else if (
            match.winner === match.away
          ) {
            away.wins += 1;
            home.losses += 1;

            away.points +=
              pointsConfig.win;

            home.points +=
              pointsConfig.loss;
          }
        });

      standings[group] = Object.values(
        stats
      ).sort(
        (a, b) =>
          b.points - a.points ||
          b.difference - a.difference ||
          a.name.localeCompare(b.name)
      );
    });

    return standings;
  });

  /* =========================================================
     PARTITE PER GIRONE / TURNO
  ========================================================= */

  const groupedMatchesByGroup = computed(() => {
    const matches =
      tournament.value.state
        .groupMatches || [];

    function buildGroup(groupName) {
      const groupMatches = matches
        .filter(
          (match) =>
            match.group === groupName
        )
        .sort(
          (a, b) =>
            a.round - b.round
        );

      const map = new Map();

      groupMatches.forEach((match) => {
        if (!map.has(match.round)) {
          map.set(match.round, []);
        }

        map.get(match.round).push(match);
      });

      return Array.from(
        map.entries()
      ).map(
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
      .filter((match) => {
        const home = String(
          match.home || ''
        ).toLowerCase();

        const away = String(
          match.away || ''
        ).toLowerCase();

        return (
          home === currentTeam ||
          away === currentTeam
        );
      })
      .sort(
        (a, b) =>
          a.round - b.round
      );
  });

  const currentTeamMatch = computed(() => {
    const activeRound =
      tournament.value.state
        .activeGroupRound;

    if (!activeRound) {
      return null;
    }

    return (
      teamSchedule.value.find(
        (match) =>
          match.round === activeRound
      ) || null
    );
  });

  const nextScheduledMatch = computed(() =>
    teamSchedule.value.find(
      (match) => !match.played
    ) || null
  );

  /* =========================================================
     CONTEGGIO BURRACO
  ========================================================= */

  const groupTargetScore = computed(() => {
    const configured = Number(
      tournament.value.config
        ?.groupTargetScore
    );

    return (
      Number.isInteger(configured) &&
      configured > 0
    )
      ? configured
      : DEFAULT_GROUP_TARGET_SCORE;
  });

  function numericValue(value) {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return 0;
    }

    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : 0;
  }

  const currentPozzettoPenalty = computed(() => {
    return handDraft.pozzettoStatus ===
      'not_taken'
      ? 100
      : 0;
  });

  const currentHandTotal = computed(() =>
    numericValue(handDraft.basePoints) +
    numericValue(handDraft.tablePoints) -
    numericValue(handDraft.handPoints) -
    currentPozzettoPenalty.value
  );

  const handTotal = computed(() =>
    handScores.value.reduce(
      (total, hand) =>
        total + Number(hand.total || 0),
      0
    )
  );

  const scoreProgress = computed(() => {
    if (groupTargetScore.value <= 0) {
      return 0;
    }

    return Math.min(
      100,
      Math.max(
        0,
        (
          handTotal.value /
          groupTargetScore.value
        ) * 100
      )
    );
  });

  const targetReached = computed(() =>
    handTotal.value >=
    groupTargetScore.value
  );

  const opponentHasSubmitted = computed(() => {
    const match = currentTeamMatch.value;

    if (!match) {
      return false;
    }

    return opponentScore(match) !== null;
  });

  const matchFinishTriggered = computed(() => {
    const match = currentTeamMatch.value;

    return Boolean(
      match?.finishTriggered
    );
  });

  const finishHandCount = computed(() => {
    const value =
      currentTeamMatch.value
        ?.finishHandCount;

    return Number.isInteger(value)
      ? value
      : null;
  });

  const hasCompletedFinalHand = computed(() => {
    if (targetReached.value) {
      return true;
    }

    if (!matchFinishTriggered.value) {
      return false;
    }

    /*
     * Se la partita è stata conclusa tramite inserimento
     * manuale, il server non conosce il numero di mani.
     */
    if (finishHandCount.value === null) {
      return opponentHasSubmitted.value;
    }

    return (
      handScores.value.length ===
      finishHandCount.value
    );
  });

  const canSubmitHandTotal = computed(() => {
    if (handScores.value.length === 0) {
      return false;
    }

    if (targetReached.value) {
      return true;
    }

    if (!matchFinishTriggered.value) {
      return false;
    }

    if (finishHandCount.value !== null) {
      return (
        handScores.value.length ===
        finishHandCount.value
      );
    }

    return opponentHasSubmitted.value;
  });

  const handEntryLocked = computed(() => {
    if (editingHandId.value) {
      return false;
    }

    if (targetReached.value) {
      return true;
    }

    if (
      matchFinishTriggered.value &&
      finishHandCount.value !== null &&
      handScores.value.length >=
        finishHandCount.value
    ) {
      return true;
    }

    return false;
  });

  /* =========================================================
     NAVIGAZIONE
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
    const response = await fetch(
      url,
      options
    );

    let data;

    try {
      data = await response.json();
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
      const data = await apiRequest(
        '/api/tournament'
      );

      tournament.value = data;

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
      tournament.value = await apiRequest(
        '/api/tournament/settings',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            expectedTeams:
              expectedTeams.value
          })
        }
      );
    }

    catch (error) {
      alert(error.message);
    }
  }

  async function generateGroupMatches() {
    try {
      tournament.value = await apiRequest(
        '/api/tournament/group-matches/generate',
        {
          method: 'POST'
        }
      );
    }

    catch (error) {
      alert(error.message);
    }
  }

  async function startRound(round) {
    try {
      tournament.value = await apiRequest(
        `/api/tournament/group-rounds/${round}/start`,
        {
          method: 'POST'
        }
      );
    }

    catch (error) {
      alert(error.message);
    }
  }

  /* =========================================================
     RESET
  ========================================================= */

  function openResetModal() {
    resetModalOpen.value = true;
  }

  function closeResetModal() {
    resetModalOpen.value = false;
  }

  async function confirmResetTournament() {
    try {
      tournament.value = await apiRequest(
        '/api/tournament/reset',
        {
          method: 'POST'
        }
      );

      expectedTeams.value =
        DEFAULT_EXPECTED_TEAMS;

      editingMatchId.value = null;
      resetModalOpen.value = false;
    }

    catch (error) {
      alert(error.message);
    }
  }

  /* =========================================================
     MANAGER - TURNI
  ========================================================= */

  function isRoundComplete(round) {
    const matches =
      tournament.value.state.groupMatches.filter(
        (match) => match.round === round
      );

    return (
      matches.length > 0 &&
      matches.every(
        (match) => match.played
      )
    );
  }

  function isRoundCompleteForGroup(
    group,
    round
  ) {
    const matches =
      tournament.value.state.groupMatches.filter(
        (match) =>
          match.group === group &&
          match.round === round
      );

    return (
      matches.length > 0 &&
      matches.every(
        (match) => match.played
      )
    );
  }

  /* =========================================================
     MANAGER - MODIFICA PUNTEGGI
  ========================================================= */

  function beginManagerEdit(match) {
    editingMatchId.value = match.id;

    managerScoreDrafts[match.id] = {
      home: match.scoreHome ?? '',
      away: match.scoreAway ?? ''
    };
  }

  function cancelManagerEdit() {
    editingMatchId.value = null;
  }

  async function saveManagerScore(match) {
    const draft =
      managerScoreDrafts[match.id];

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

    const home = Number(draft.home);
    const away = Number(draft.away);

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
      tournament.value = await apiRequest(
        `/api/tournament/group-matches/${encodeURIComponent(
          match.id
        )}/score`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            scoreHome: home,
            scoreAway: away
          })
        }
      );

      editingMatchId.value = null;
    }

    catch (error) {
      alert(error.message);
    }
  }

  /* =========================================================
     SOCKET.IO
  ========================================================= */

  function connectSocket() {
    if (socket) {
      return;
    }

    manualDisconnect = false;
    socket = io();

    socket.on('connect', () => {
      if (
        mode.value === 'phone' &&
        !isPhoneConnected.value
      ) {
        tryAutoJoin();
      }
    });

    socket.on(
      'tournament:update',
      (nextTournament) => {
        tournament.value =
          nextTournament;
      }
    );

    socket.on('team:joined', (team) => {
      joinedTeamName.value = team.name;
      teamName.value = team.name;
      isPhoneConnected.value = true;

      statusMessage.value =
        `Connesso come ${team.name}`;

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          name: teamName.value,
          code: teamCode.value
        })
      );
    });

    socket.on(
      'team:join:error',
      (message) => {
        statusMessage.value = message;
      }
    );

    socket.on('team:left', () => {
      joinedTeamName.value = '';
      isPhoneConnected.value = false;
    });

    socket.on(
      'match:score:accepted',
      ({ score }) => {
        statusMessage.value =
          `Punteggio ${formatScore(score)} inviato.`;

        scoreInput.value = null;
        scoreConfirmOpen.value = false;
        pendingFinalScore.value = null;
      }
    );

    socket.on(
      'match:score:error',
      (message) => {
        statusMessage.value = message;
      }
    );

    socket.on('connect_error', () => {
      statusMessage.value =
        'Errore di connessione al server.';

      isPhoneConnected.value = false;
    });

    socket.on('disconnect', () => {
      isPhoneConnected.value = false;

      if (!manualDisconnect) {
        statusMessage.value =
          'Connessione persa. Riconnessione automatica...';
      }
    });
  }

  /* =========================================================
     LOGIN
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

    const name = teamName.value.trim();
    const code = teamCode.value.trim();

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

  function tryAutoJoin() {
    const raw = localStorage.getItem(
      STORAGE_KEY
    );

    if (
      !raw ||
      !socket?.connected
    ) {
      return;
    }

    try {
      const saved = JSON.parse(raw);

      if (
        !saved?.name ||
        !saved?.code
      ) {
        return;
      }

      teamName.value = saved.name;
      teamCode.value = saved.code;

      socket.emit(
        'team:join',
        {
          name: saved.name,
          code: saved.code
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

  function disconnectTeam() {
    const confirmed = window.confirm(
      'Vuoi uscire dalla squadra?'
    );

    if (!confirmed) {
      return;
    }

    manualDisconnect = true;

    localStorage.removeItem(
      STORAGE_KEY
    );

    joinedTeamName.value = '';
    teamName.value = '';
    teamCode.value = '';
    scoreInput.value = null;
    isPhoneConnected.value = false;
    statusMessage.value = 'Disconnesso.';

    if (socket?.connected) {
      socket.emit('team:leave');
    }

    manualDisconnect = false;
  }

  /* =========================================================
     ID LOCALE
  ========================================================= */

  function createLocalId() {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID ===
        'function'
    ) {
      return crypto.randomUUID();
    }

    return [
      Date.now(),
      Math.random()
        .toString(16)
        .slice(2)
    ].join('-');
  }

  /* =========================================================
     LOCAL STORAGE MANI
  ========================================================= */

  function getHandsStorageKey(
    match = currentTeamMatch.value
  ) {
    if (
      !match ||
      !joinedTeamName.value
    ) {
      return null;
    }

    const tournamentId =
      tournament.value.state
        ?.audit?.createdAt ||
      'default';

    return [
      'burraco-hands',
      tournamentId,
      joinedTeamName.value.toLowerCase(),
      match.id
    ].join(':');
  }

  function saveHandsForCurrentMatch() {
    const key = getHandsStorageKey();

    if (!key) {
      return;
    }

    localStorage.setItem(
      key,
      JSON.stringify(handScores.value)
    );
  }

  function loadHandsForCurrentMatch() {
    const key = getHandsStorageKey();

    if (!key) {
      handScores.value = [];
      return;
    }

    const raw = localStorage.getItem(key);

    if (!raw) {
      handScores.value = [];
      return;
    }

    try {
      const saved = JSON.parse(raw);

      if (!Array.isArray(saved)) {
        handScores.value = [];
        return;
      }

      handScores.value = saved
        .map((hand) => {
          if (
            Number.isInteger(
              Number(hand?.total)
            )
          ) {
            /*
             * Compatibilità con la vecchia opzione
             * "pozzetto preso ma non giocato":
             * viene inglobata nei punti in mano.
             */
            const legacyExtraHand =
              hand?.pozzettoStatus ===
              'taken_not_played'
                ? numericValue(
                    hand?.pozzettoPenalty ||
                    hand?.pozzettoPoints
                  )
                : 0;

            const normalizedStatus =
              hand?.pozzettoStatus ===
              'not_taken'
                ? 'not_taken'
                : 'taken';

            return {
              id:
                hand.id ||
                createLocalId(),

              basePoints:
                numericValue(
                  hand.basePoints
                ),

              tablePoints:
                numericValue(
                  hand.tablePoints
                ),

              handPoints:
                numericValue(
                  hand.handPoints
                ) + legacyExtraHand,

              pozzettoStatus:
                normalizedStatus,

              pozzettoPenalty:
                normalizedStatus ===
                'not_taken'
                  ? 100
                  : 0,

              total:
                Number(hand.total)
            };
          }

          if (
            Number.isInteger(
              Number(hand?.score)
            )
          ) {
            const oldScore =
              Number(hand.score);

            return {
              id:
                hand.id ||
                createLocalId(),
              basePoints: oldScore,
              tablePoints: 0,
              handPoints: 0,
              pozzettoStatus: 'taken',
              pozzettoPenalty: 0,
              total: oldScore
            };
          }

          return null;
        })
        .filter(Boolean);
    }

    catch {
      handScores.value = [];
      localStorage.removeItem(key);
    }
  }

  /* =========================================================
     DRAFT MANO
  ========================================================= */

  function resetHandDraft() {
    handDraft.basePoints = null;
    handDraft.tablePoints = null;
    handDraft.handPoints = null;
    handDraft.pozzettoStatus = 'taken';
    editingHandId.value = null;
  }

  function validateHandDraft() {
    const fields = [
      handDraft.basePoints,
      handDraft.tablePoints,
      handDraft.handPoints
    ];

    for (const value of fields) {
      if (
        value === null ||
        value === ''
      ) {
        continue;
      }

      const number = Number(value);

      if (
        !Number.isInteger(number) ||
        number < 0
      ) {
        statusMessage.value =
          'I valori della mano devono essere numeri interi maggiori o uguali a zero.';
        return false;
      }
    }

    return true;
  }

  /* =========================================================
     SINCRONIZZAZIONE FINE PARTITA
  ========================================================= */

  function signalTargetReached() {
    const match = currentTeamMatch.value;

    if (
      !match ||
      !socket?.connected ||
      !isPhoneConnected.value
    ) {
      return;
    }

    if (
      handTotal.value <
      groupTargetScore.value
    ) {
      return;
    }

    if (match.finishTriggered) {
      return;
    }

    socket.emit(
      'match:finish:trigger',
      {
        matchId: match.id,
        handCount:
          handScores.value.length,
        /*
         * Serve al server solo per verificare
         * che il target sia davvero raggiunto.
         * Non viene salvato come risultato ufficiale.
         */
        score: handTotal.value
      }
    );
  }

  function syncFinishAfterLocalChange() {
    const match = currentTeamMatch.value;

    if (
      !match ||
      !socket?.connected ||
      !isPhoneConnected.value
    ) {
      return;
    }

    if (
      handTotal.value >=
      groupTargetScore.value
    ) {
      signalTargetReached();
      return;
    }

    /*
     * Se siamo stati noi a dichiarare la fine ma
     * correggendo una mano torniamo sotto il target,
     * annulliamo il trigger finché nessun risultato
     * ufficiale è stato inviato.
     */
    if (
      match.finishTriggered &&
      String(
        match.finishTriggeredBy || ''
      ).toLowerCase() ===
        joinedTeamName.value.toLowerCase() &&
      myScore(match) === null &&
      opponentScore(match) === null
    ) {
      socket.emit(
        'match:finish:cancel',
        {
          matchId: match.id
        }
      );
    }
  }

  /* =========================================================
     AGGIUNGI / MODIFICA MANO
  ========================================================= */

  function saveCurrentHand() {
    if (!validateHandDraft()) {
      return;
    }

    if (
      !editingHandId.value &&
      handEntryLocked.value
    ) {
      statusMessage.value =
        'La partita è già arrivata alla mano finale.';
      return;
    }

    const hand = {
      id:
        editingHandId.value ||
        createLocalId(),

      basePoints:
        numericValue(
          handDraft.basePoints
        ),

      tablePoints:
        numericValue(
          handDraft.tablePoints
        ),

      handPoints:
        numericValue(
          handDraft.handPoints
        ),

      pozzettoStatus:
        handDraft.pozzettoStatus,

      pozzettoPenalty:
        currentPozzettoPenalty.value,

      total:
        currentHandTotal.value
    };

    if (editingHandId.value) {
      const index =
        handScores.value.findIndex(
          (item) =>
            item.id ===
            editingHandId.value
        );

      if (index !== -1) {
        handScores.value[index] = hand;
      }

      statusMessage.value =
        'Mano modificata.';
    }

    else {
      handScores.value.push(hand);
      statusMessage.value =
        'Mano aggiunta.';
    }

    saveHandsForCurrentMatch();
    syncFinishAfterLocalChange();
    resetHandDraft();
  }

  function startEditHand(hand) {
    editingHandId.value = hand.id;
    handDraft.basePoints = hand.basePoints;
    handDraft.tablePoints = hand.tablePoints;
    handDraft.handPoints = hand.handPoints;
    handDraft.pozzettoStatus =
      hand.pozzettoStatus || 'taken';
  }

  function cancelEditHand() {
    resetHandDraft();
  }

  /* =========================================================
     ELIMINA MANO
  ========================================================= */

  function requestDeleteHand(handId) {
    pendingDeleteHandId.value = handId;
  }

  function cancelDeleteHand() {
    pendingDeleteHandId.value = null;
  }

  function confirmDeleteHand(handId) {
    const index =
      handScores.value.findIndex(
        (hand) => hand.id === handId
      );

    if (index === -1) {
      return;
    }

    handScores.value.splice(index, 1);
    pendingDeleteHandId.value = null;

    if (
      editingHandId.value === handId
    ) {
      resetHandDraft();
    }

    saveHandsForCurrentMatch();
    syncFinishAfterLocalChange();

    statusMessage.value =
      'Mano eliminata.';
  }

  /* =========================================================
     AZZERA MANI
  ========================================================= */

  function requestClearHands() {
    if (handScores.value.length === 0) {
      return;
    }

    clearHandsConfirmOpen.value = true;
  }

  function cancelClearHands() {
    clearHandsConfirmOpen.value = false;
  }

  function confirmClearHands() {
    handScores.value = [];
    clearHandsConfirmOpen.value = false;
    pendingDeleteHandId.value = null;

    resetHandDraft();
    saveHandsForCurrentMatch();
    syncFinishAfterLocalChange();

    statusMessage.value =
      'Conteggio azzerato.';
  }

  /* =========================================================
     MODALITÀ PUNTEGGIO
  ========================================================= */

  function setScoreEntryMode(selectedMode) {
    if (
      selectedMode !== 'hands' &&
      selectedMode !== 'manual'
    ) {
      return;
    }

    scoreEntryMode.value = selectedMode;
  }

  /* =========================================================
     INVIO RISULTATO
  ========================================================= */

  function requestFinalScoreSubmission(score) {
    const match = currentTeamMatch.value;

    if (!match) {
      statusMessage.value =
        'Non hai una partita attiva.';
      return;
    }

    const numericScore = Number(score);

    if (!Number.isInteger(numericScore)) {
      statusMessage.value =
        'Inserisci un punteggio intero valido.';
      return;
    }

    if (
      numericScore <
      groupTargetScore.value
    ) {
      if (!matchFinishTriggered.value) {
        statusMessage.value =
          `La partita continua fino a ${formatScore(
            groupTargetScore.value
          )} punti.`;
        return;
      }

      if (
        scoreEntryMode.value === 'hands' &&
        finishHandCount.value !== null &&
        handScores.value.length !==
          finishHandCount.value
      ) {
        statusMessage.value =
          `La partita è terminata alla mano ${finishHandCount.value}. Devi registrare lo stesso numero di mani.`;
        return;
      }
    }

    pendingFinalScore.value = numericScore;
    scoreConfirmOpen.value = true;
  }

  function submitHandTotal() {
    if (handScores.value.length === 0) {
      statusMessage.value =
        'Inserisci almeno una mano.';
      return;
    }

    requestFinalScoreSubmission(
      handTotal.value
    );
  }

  function submitMyScore() {
    if (
      scoreInput.value === null ||
      scoreInput.value === ''
    ) {
      statusMessage.value =
        'Inserisci il tuo punteggio.';
      return;
    }

    requestFinalScoreSubmission(
      scoreInput.value
    );
  }

  function cancelScoreConfirmation() {
    scoreConfirmOpen.value = false;
    pendingFinalScore.value = null;
  }

  function confirmSubmitMyScore() {
    const match = currentTeamMatch.value;

    if (
      !match ||
      pendingFinalScore.value === null
    ) {
      return;
    }

    if (!socket?.connected) {
      statusMessage.value =
        'Connessione al server non disponibile.';
      return;
    }

    /*
     * Le singole mani NON vengono inviate.
     * handCount è solo un controllo di coerenza
     * e non viene salvato come storico delle mani.
     */
    socket.emit(
      'match:score:submit',
      {
        matchId: match.id,
        score: pendingFinalScore.value,
        handCount:
          scoreEntryMode.value === 'hands'
            ? handScores.value.length
            : null
      }
    );

    scoreConfirmOpen.value = false;
    pendingFinalScore.value = null;
    statusMessage.value =
      'Invio del punteggio...';
  }

  /* =========================================================
     HELPERS
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

    return isMyTeam(match.home)
      ? match.scoreHome
      : match.scoreAway;
  }

  function opponentScore(match) {
    if (!match) {
      return null;
    }

    return isMyTeam(match.home)
      ? match.scoreAway
      : match.scoreHome;
  }

  function opponentFor(match) {
    if (!match) {
      return '—';
    }

    return isMyTeam(match.home)
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

    return new Intl.NumberFormat(
      'it-IT'
    ).format(value);
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
      tournament.value.state
        .activeGroupRound
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
      tournament.value.state
        .activeGroupRound
    ) {
      return 'active';
    }

    return 'scheduled';
  }

  function phoneResultText(match) {
    const mine = myScore(match);
    const opponent = opponentScore(match);

    if (mine === opponent) {
      return 'Pareggio';
    }

    return mine > opponent
      ? 'Vittoria'
      : 'Sconfitta';
  }

  function phoneResultClass(match) {
    const mine = myScore(match);
    const opponent = opponentScore(match);

    if (mine === opponent) {
      return 'draw';
    }

    return mine > opponent
      ? 'win'
      : 'loss';
  }

  /* =========================================================
     WATCH PARTITA / MANI
  ========================================================= */

  watch(
    [
      () => currentTeamMatch.value?.id,
      () => joinedTeamName.value,
      () =>
        tournament.value.state
          ?.audit?.createdAt
    ],
    () => {
      resetHandDraft();
      pendingDeleteHandId.value = null;
      clearHandsConfirmOpen.value = false;
      scoreConfirmOpen.value = false;
      pendingFinalScore.value = null;
      scoreEntryMode.value = 'hands';

      loadHandsForCurrentMatch();
    },
    {
      immediate: true
    }
  );

  /*
   * Se dopo refresh/reconnect il telefono recupera
   * mani che superano già il target e il server non
   * ha ancora ricevuto il trigger, lo rispediamo.
   */
  watch(
    [
      () => targetReached.value,
      () => matchFinishTriggered.value,
      () => isPhoneConnected.value
    ],
    () => {
      if (
        targetReached.value &&
        !matchFinishTriggered.value &&
        isPhoneConnected.value
      ) {
        signalTargetReached();
      }
    }
  );

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

    socket = null;
  });

  /* =========================================================
     EXPORT
  ========================================================= */

  return {
    /* generale */
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

    /* computed generali */
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

    /* reset */
    resetModalOpen,
    openResetModal,
    closeResetModal,
    confirmResetTournament,

    /* turni */
    isRoundComplete,
    isRoundCompleteForGroup,

    /* risultati manager */
    beginManagerEdit,
    cancelManagerEdit,
    saveManagerScore,

    /* login telefono */
    joinTeam,
    disconnectTeam,

    /* modalità punteggio */
    scoreEntryMode,
    setScoreEntryMode,

    /* mani */
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

    /* risultato finale */
    submitMyScore,
    scoreConfirmOpen,
    pendingFinalScore,
    cancelScoreConfirmation,
    confirmSubmitMyScore,

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
